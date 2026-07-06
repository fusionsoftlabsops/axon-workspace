import { describe, it, expect, vi } from 'vitest';
import {
  getGitProvider,
  parseRepoRef,
  GithubProvider,
  ForgejoProvider,
  type GitProviderConfig,
} from '../src/git/provider.js';

const GH: GitProviderConfig = { provider: 'github', apiBaseUrl: 'https://api.github.com', host: 'github.com' };
const FJ: GitProviderConfig = {
  provider: 'forgejo',
  apiBaseUrl: 'https://git.fusion-soft-lab.com/api/v1',
  host: 'git.fusion-soft-lab.com',
};

describe('parseRepoRef', () => {
  it('parsea https/ssh/.git del host github', () => {
    expect(parseRepoRef('https://github.com/o/r', 'github.com')).toEqual({ owner: 'o', repo: 'r', host: 'github.com' });
    expect(parseRepoRef('https://github.com/o/r.git', 'github.com')).toMatchObject({ owner: 'o', repo: 'r' });
    expect(parseRepoRef('git@github.com:o/r.git', 'github.com')).toMatchObject({ owner: 'o', repo: 'r' });
    expect(parseRepoRef('https://gitlab.com/o/r', 'github.com')).toBeNull();
  });
  it('parsea el host forgejo configurado', () => {
    expect(parseRepoRef('https://git.fusion-soft-lab.com/o/r', 'git.fusion-soft-lab.com')).toEqual({
      owner: 'o',
      repo: 'r',
      host: 'git.fusion-soft-lab.com',
    });
  });
});

describe('getGitProvider', () => {
  it('elige la implementación por provider', () => {
    expect(getGitProvider(GH)).toBeInstanceOf(GithubProvider);
    expect(getGitProvider(FJ)).toBeInstanceOf(ForgejoProvider);
  });
});

describe('GithubProvider.openPr', () => {
  it('POST a api.github.com con Bearer + Accept github', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 201, json: async () => ({ html_url: 'https://github.com/o/r/pull/1' }) });
    const p = getGitProvider(GH, fetchMock as unknown as typeof fetch);
    const url = await p.openPr({
      repoUrl: 'https://github.com/o/r',
      head: 'agent/hu-1',
      base: 'main',
      title: 't',
      body: 'b',
      token: 'ghp_x',
    });
    expect(url).toBe('https://github.com/o/r/pull/1');
    const [apiUrl, init] = fetchMock.mock.calls[0]!;
    expect(apiUrl).toBe('https://api.github.com/repos/o/r/pulls');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer ghp_x');
    expect(headers.accept).toBe('application/vnd.github+json');
  });
});

describe('ForgejoProvider.openPr', () => {
  it('POST a la base Gitea con auth token + Accept json', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 201, json: async () => ({ html_url: 'https://git.fusion-soft-lab.com/o/r/pulls/7' }) });
    const p = getGitProvider(FJ, fetchMock as unknown as typeof fetch);
    const url = await p.openPr({
      repoUrl: 'https://git.fusion-soft-lab.com/o/r',
      head: 'agent/hu-7',
      base: 'main',
      title: 't',
      body: 'b',
      token: 'fj_tok',
    });
    expect(url).toBe('https://git.fusion-soft-lab.com/o/r/pulls/7');
    const [apiUrl, init] = fetchMock.mock.calls[0]!;
    expect(apiUrl).toBe('https://git.fusion-soft-lab.com/api/v1/repos/o/r/pulls');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('token fj_tok');
    expect(headers.accept).toBe('application/json');
  });

  it('reusa el PR existente cuando la rama ya tiene uno (409)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ message: 'already exists' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ html_url: 'https://git.fusion-soft-lab.com/o/r/pulls/9' }] });
    const p = getGitProvider(FJ, fetchMock as unknown as typeof fetch);
    const url = await p.openPr({
      repoUrl: 'https://git.fusion-soft-lab.com/o/r',
      head: 'agent/hu-9',
      base: 'main',
      title: 't',
      body: 'b',
      token: 'fj_tok',
    });
    expect(url).toBe('https://git.fusion-soft-lab.com/o/r/pulls/9');
    expect(fetchMock.mock.calls[1]![0]).toContain('/pulls?head=o:agent/hu-9&state=open');
  });

  it('falla claro si el repoUrl no es del host del proveedor', async () => {
    const p = getGitProvider(FJ, vi.fn() as unknown as typeof fetch);
    await expect(
      p.openPr({ repoUrl: 'https://github.com/o/r', head: 'h', base: 'main', title: 't', body: 'b' }),
    ).rejects.toThrow('no es de Forgejo');
  });
});
