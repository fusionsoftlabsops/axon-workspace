import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoTools } from '../src/tools/repo.js';
import type { ToolDef } from '../src/runtime/types.js';

let root: string;
let tools: ToolDef[];
const byName = (name: string) => tools.find((t) => t.name === name)!;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'repo-tools-'));
  await mkdir(join(root, 'src', 'roles'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'x'), { recursive: true });
  await writeFile(join(root, 'src', 'roles', 'sm.ts'), 'export const SM = 1;\n// asigna HUs\n');
  await writeFile(join(root, 'src', 'index.ts'), 'console.log("boot");\n');
  await writeFile(join(root, 'node_modules', 'x', 'ignored.js'), 'ignorado');
  tools = repoTools(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('repoTools', () => {
  it('read_file lee rutas relativas y bloquea escapes del sandbox', async () => {
    expect(await byName('read_file').execute({ path: 'src/index.ts' })).toContain('boot');
    await expect(byName('read_file').execute({ path: '../fuera.txt' })).rejects.toThrow('fuera del workspace');
    await expect(byName('read_file').execute({ path: '/etc/passwd' })).rejects.toThrow('fuera del workspace');
  });

  it('list_files filtra por subcadena e ignora node_modules', async () => {
    const all = (await byName('list_files').execute({})) as string;
    expect(all).toContain('src/index.ts');
    expect(all).not.toContain('node_modules');
    const filtered = (await byName('list_files').execute({ filter: 'roles' })) as string;
    expect(filtered.trim()).toBe('src/roles/sm.ts');
  });

  it('search_files devuelve path:línea y tolera regex inválidas (literal)', async () => {
    const hits = (await byName('search_files').execute({ pattern: 'asigna' })) as string;
    expect(hits).toContain('src/roles/sm.ts:2:');
    const literal = (await byName('search_files').execute({ pattern: 'log("boot' })) as string;
    expect(literal).toContain('src/index.ts:1:');
    expect(await byName('search_files').execute({ pattern: 'inexistente-xyz' })).toBe('(sin coincidencias)');
  });

  it('write_file crea directorios intermedios y respeta el sandbox', async () => {
    const out = await byName('write_file').execute({ path: 'src/nuevo/archivo.ts', content: 'export {};\n' });
    expect(out).toContain('escrito src/nuevo/archivo.ts');
    expect(await readFile(join(root, 'src', 'nuevo', 'archivo.ts'), 'utf8')).toBe('export {};\n');
    await expect(byName('write_file').execute({ path: '../../pwn.txt', content: 'x' })).rejects.toThrow(
      'fuera del workspace',
    );
  });
});
