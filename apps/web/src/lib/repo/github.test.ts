import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  repoSlug,
  githubGrounding,
  githubTreeNodes,
  githubText,
  githubRepoTree,
  githubFileContent,
  type GithubTreeEntry,
} from './github';

describe('repoSlug', () => {
  it('prefiere githubFullName y cae a parsear la url', () => {
    expect(repoSlug({ githubFullName: 'acme/app' })).toBe('acme/app');
    expect(repoSlug({ url: 'https://github.com/acme/app.git' })).toBe('acme/app');
    expect(repoSlug({ url: 'https://github.com/acme/app' })).toBe('acme/app');
    expect(repoSlug({ url: 'https://gitlab.com/acme/app' })).toBeNull();
    expect(repoSlug({})).toBeNull();
  });
});

describe('githubTreeNodes', () => {
  const entries: GithubTreeEntry[] = [
    { path: 'apps', type: 'tree' },
    { path: 'apps/web', type: 'tree' },
    { path: 'apps/web/index.ts', type: 'blob', size: 10 },
    { path: 'apps/web/deep', type: 'tree' },
    { path: 'apps/web/deep/x.ts', type: 'blob' },
    { path: 'README.md', type: 'blob' },
  ];
  it('arma el árbol jerárquico respetando root y depth', () => {
    const root = githubTreeNodes(entries, '.', 1);
    expect(root.map((n) => n.name).sort()).toEqual(['README.md', 'apps']);
    const apps = root.find((n) => n.name === 'apps')!;
    expect(apps.kind).toBe('dir');
    expect(apps.children).toBeUndefined(); // depth 1 corta

    const sub = githubTreeNodes(entries, 'apps/web', 1);
    expect(sub.map((n) => n.name).sort()).toEqual(['deep', 'index.ts']);
    const idx = sub.find((n) => n.name === 'index.ts')!;
    expect(idx).toMatchObject({ kind: 'file', size: 10 });
  });
  it('ordena dirs antes que files', () => {
    const nodes = githubTreeNodes(entries, 'apps/web', 2);
    expect(nodes[0]!.kind).toBe('dir');
  });
});

describe('githubText / githubRepoTree / githubFileContent', () => {
  const tf = vi.fn();
  const orig = globalThis.fetch;
  beforeEach(() => {
    tf.mockReset();
    globalThis.fetch = tf as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = orig;
  });
  it('githubText devuelve el texto crudo y propaga el status de error', async () => {
    tf.mockResolvedValue({ ok: true, status: 200, text: async () => 'raw-diff' });
    expect(await githubText('https://x/pulls/1', 't', 'application/vnd.github.diff')).toBe('raw-diff');
    tf.mockResolvedValue({ ok: false, status: 404, text: async () => '' });
    await expect(githubText('https://x/pulls/2', 't', 'a')).rejects.toThrow('github 404');
  });
  it('githubRepoTree filtra solo blobs/trees', async () => {
    tf.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ tree: [{ path: 'a', type: 'blob' }, { path: 'b', type: 'commit' }] }),
    });
    const t = await githubRepoTree('o/r', 'main', 'tok');
    expect(t).toEqual([{ path: 'a', type: 'blob' }]);
  });
  it('githubFileContent decodifica base64 y marca truncado', async () => {
    const big = 'x'.repeat(50);
    tf.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: Buffer.from(big, 'utf8').toString('base64'), encoding: 'base64' }),
    });
    const r = await githubFileContent('o/r', 'main', 'a.ts', 'tok', 10);
    expect(r.truncated).toBe(true);
    expect(r.content.length).toBe(10);
    tf.mockResolvedValue({ ok: true, status: 200, json: async () => ({ encoding: 'none' }) });
    await expect(githubFileContent('o/r', 'main', 'a.ts', 'tok')).rejects.toThrow();
  });
});

const fetchMock = vi.fn();
const realFetch = globalThis.fetch;
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function treeResp(paths: string[]) {
  return { ok: true, status: 200, json: async () => ({ tree: paths.map((p) => ({ path: p, type: 'blob' })) }) };
}
function contentResp(text: string) {
  return { ok: true, status: 200, json: async () => ({ content: b64(text), encoding: 'base64' }) };
}

describe('githubGrounding', () => {
  it('arma outline (filtra binarios/locks) y trae candidatos por keyword', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/git/trees/')) {
        return Promise.resolve(
          treeResp([
            'apps/web/src/board/StoryCard.tsx',
            'apps/web/src/board/Sidebar.tsx',
            'pnpm-lock.yaml',
            'logo.png',
          ]),
        );
      }
      return Promise.resolve(contentResp('export const StoryCard = () => null;'));
    });

    const g = await githubGrounding({ fullName: 'acme/app', branch: 'main', token: 't', keywords: ['storycard', 'board'] });
    // outline incluye los .tsx pero NO el lock ni la imagen
    expect(g.outline).toContain('StoryCard.tsx');
    expect(g.outline).not.toContain('pnpm-lock.yaml');
    expect(g.outline).not.toContain('logo.png');
    // candidatos por keyword → StoryCard leído
    const paths = g.files.map((f) => f.path);
    expect(paths).toContain('apps/web/src/board/StoryCard.tsx');
    expect(g.files[0]!.content).toContain('StoryCard');
  });

  it('degrada a vacío si el árbol falla', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const g = await githubGrounding({ fullName: 'acme/app', branch: 'main', token: 't', keywords: ['x'] });
    expect(g).toEqual({ outline: '', files: [] });
  });

  it('sin keyword-match, cae a los archivos más superficiales', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/git/trees/')) return Promise.resolve(treeResp(['a.ts', 'deep/x/y/z.ts']));
      return Promise.resolve(contentResp('code'));
    });
    const g = await githubGrounding({ fullName: 'acme/app', branch: 'main', token: 't', keywords: ['zzz'] });
    expect(g.files.map((f) => f.path)).toContain('a.ts'); // el más superficial
  });
});
