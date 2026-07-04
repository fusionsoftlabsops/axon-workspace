import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { repoSlug, githubGrounding } from './github';

describe('repoSlug', () => {
  it('prefiere githubFullName y cae a parsear la url', () => {
    expect(repoSlug({ githubFullName: 'acme/app' })).toBe('acme/app');
    expect(repoSlug({ url: 'https://github.com/acme/app.git' })).toBe('acme/app');
    expect(repoSlug({ url: 'https://github.com/acme/app' })).toBe('acme/app');
    expect(repoSlug({ url: 'https://gitlab.com/acme/app' })).toBeNull();
    expect(repoSlug({})).toBeNull();
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
