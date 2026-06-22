import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RepoReader, RepoAccessError, isPathWithinRoot, repoReaderFor } from './reader';

let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-reader-test-'));
  // Estructura:
  //   src/
  //     app.ts         "console.log('hi');"
  //     icon.png       <bytes con 0x00>
  //   docs/
  //     README.md      "# Hello"
  //   .git/
  //     HEAD           (debe ignorarse)
  //   node_modules/
  //     pkg/index.js   (debe ignorarse)
  await fs.mkdir(path.join(tmpRoot, 'src'), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, 'docs'), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, '.git'), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, 'node_modules', 'pkg'), { recursive: true });

  await fs.writeFile(path.join(tmpRoot, 'src', 'app.ts'), "console.log('hi');\n");
  await fs.writeFile(
    path.join(tmpRoot, 'src', 'icon.png'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]),
  );
  await fs.writeFile(path.join(tmpRoot, 'docs', 'README.md'), '# Hello\n');
  await fs.writeFile(path.join(tmpRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await fs.writeFile(path.join(tmpRoot, 'node_modules', 'pkg', 'index.js'), 'module.exports = {};\n');
});

afterAll(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('isPathWithinRoot (REPOS_ROOT confinement)', () => {
  // Path-only assertions (no filesystem access), so absolute literals are fine.
  const root = path.resolve(path.sep, 'srv', 'repos');

  it('accepts the root itself and paths inside it', () => {
    expect(isPathWithinRoot(root, root)).toBe(true);
    expect(isPathWithinRoot(root, path.join(root, 'proj'))).toBe(true);
    expect(isPathWithinRoot(root, path.join(root, 'a', 'b', 'c'))).toBe(true);
  });

  it('rejects paths outside the root, including .. escapes and sibling prefixes', () => {
    expect(isPathWithinRoot(root, path.join(root, '..', 'other'))).toBe(false);
    expect(isPathWithinRoot(root, `${root}-evil`)).toBe(false);
    expect(isPathWithinRoot(root, path.resolve(path.sep, 'etc', 'passwd'))).toBe(false);
  });
});

describe('RepoReader · REPOS_ROOT defense in depth', () => {
  it('throws when constructed with a path outside reposRoot', () => {
    const reposRoot = path.join(tmpRoot, 'allowed');
    expect(() => new RepoReader(path.join(tmpRoot, 'elsewhere'), reposRoot)).toThrowError(
      RepoAccessError,
    );
  });

  it('allows a path inside reposRoot', () => {
    // tmpRoot itself acts as the allowed root here.
    expect(() => new RepoReader(path.join(tmpRoot, 'src'), tmpRoot)).not.toThrow();
  });
});

describe('RepoReader · construction', () => {
  it('rechaza paths relativos en el constructor', () => {
    expect(() => new RepoReader('./relative')).toThrowError(RepoAccessError);
  });

  it('validate() rechaza un path inexistente', async () => {
    const r = new RepoReader(path.join(tmpRoot, 'no-existe'));
    await expect(r.validate()).rejects.toThrowError(RepoAccessError);
  });

  it('validate() rechaza un archivo (no-dir)', async () => {
    const filePath = path.join(tmpRoot, 'src', 'app.ts');
    const r = new RepoReader(filePath);
    await expect(r.validate()).rejects.toThrowError(RepoAccessError);
  });
});

describe('RepoReader · security guards', () => {
  it('rechaza tokens .. en readFiles', async () => {
    const r = new RepoReader(tmpRoot);
    await r.validate();
    await expect(r.readFiles(['../etc/passwd'])).rejects.toThrowError(/'..'/);
  });

  it('rechaza paths absolutos', async () => {
    const r = new RepoReader(tmpRoot);
    await r.validate();
    await expect(r.readFiles(['/etc/passwd'])).rejects.toThrowError(/absoluto/);
  });

  it('rechaza paths que escapan tras resolver', async () => {
    const r = new RepoReader(tmpRoot);
    await r.validate();
    // construido sin '..' pero terminaría afuera del root
    await expect(r.tree({ root: 'src/../../../etc' })).rejects.toThrowError();
  });
});

describe('RepoReader · tree', () => {
  it('omite .git, node_modules, y archivos binarios', async () => {
    const r = new RepoReader(tmpRoot);
    const tree = await r.tree({ maxDepth: 2 });
    const names = tree.map((n) => n.name);
    expect(names).not.toContain('.git');
    expect(names).not.toContain('node_modules');
    expect(names).toContain('src');
    expect(names).toContain('docs');

    const srcNode = tree.find((n) => n.name === 'src');
    expect(srcNode?.children?.map((c) => c.name)).toContain('app.ts');
    // icon.png debe quedar fuera por extensión binaria
    expect(srcNode?.children?.map((c) => c.name)).not.toContain('icon.png');
  });
});

describe('RepoReader · readFiles', () => {
  it('lee archivos de texto bajo el límite', async () => {
    const r = new RepoReader(tmpRoot);
    const result = await r.readFiles(['src/app.ts', 'docs/README.md']);
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual(['docs/README.md', 'src/app.ts']);
    expect(result.files.find((f) => f.path === 'src/app.ts')?.content).toContain("console.log");
    expect(result.files.find((f) => f.path === 'src/app.ts')?.language).toBe('typescript');
  });

  it('expande directorios a sus archivos', async () => {
    const r = new RepoReader(tmpRoot);
    const result = await r.readFiles(['src']);
    expect(result.files.map((f) => f.path)).toEqual(['src/app.ts']);
  });

  it('respeta maxBytesTotal y marca truncated', async () => {
    const r = new RepoReader(tmpRoot);
    const result = await r.readFiles(['src/app.ts', 'docs/README.md'], { maxBytesTotal: 10 });
    expect(result.truncated).toBe(true);
  });
});

describe('RepoReader · grep', () => {
  it('encuentra patrones en archivos de texto, ignora binarios', async () => {
    const r = new RepoReader(tmpRoot);
    const hits = await r.grep('console');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.path).toBe('src/app.ts');
    expect(hits[0]?.line).toBe(1);
  });

  it('respeta scope', async () => {
    const r = new RepoReader(tmpRoot);
    const hits = await r.grep('Hello', ['docs']);
    expect(hits.every((h) => h.path.startsWith('docs/'))).toBe(true);
  });
});

describe('repoReaderFor factory', () => {
  it('retorna null si repoPath es null', async () => {
    const r = await repoReaderFor({ repoPath: null });
    expect(r).toBeNull();
  });

  it('retorna null si el path no existe', async () => {
    const r = await repoReaderFor({ repoPath: path.join(tmpRoot, 'inexistente') });
    expect(r).toBeNull();
  });

  it('retorna un RepoReader válido para un repoPath correcto', async () => {
    const r = await repoReaderFor({ repoPath: tmpRoot });
    expect(r).not.toBeNull();
    const tree = await r!.tree();
    expect(tree.length).toBeGreaterThan(0);
  });
});
