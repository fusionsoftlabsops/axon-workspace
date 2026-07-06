import { describe, it, expect, vi } from 'vitest';
import {
  parseRepoRef,
  getGitProvider,
  gitConfigFromEnv,
  gitProviderFromEnv,
  GithubProvider,
  ForgejoProvider,
  type GitProviderConfig,
} from './provider';

const GH: GitProviderConfig = { provider: 'github', apiBaseUrl: 'https://api.github.com', host: 'github.com' };
const FJ: GitProviderConfig = {
  provider: 'forgejo',
  apiBaseUrl: 'https://git.fusion-soft-lab.com/api/v1',
  host: 'git.fusion-soft-lab.com',
};

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
function jsonRes(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}
function textRes(status: number, body: string) {
  return { status, ok: status >= 200 && status < 300, text: async () => body, json: async () => ({}) } as Response;
}

describe('parseRepoRef', () => {
  it('parsea host github (https/ssh/.git) y descarta otros hosts', () => {
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

describe('getGitProvider / env helpers', () => {
  it('elige la implementación por provider', () => {
    expect(getGitProvider(GH)).toBeInstanceOf(GithubProvider);
    expect(getGitProvider(FJ)).toBeInstanceOf(ForgejoProvider);
  });
  it('gitConfigFromEnv default github; gitProviderFromEnv construye el provider', () => {
    expect(gitConfigFromEnv()).toEqual({ provider: 'github', apiBaseUrl: 'https://api.github.com', host: 'github.com' });
    expect(gitProviderFromEnv()).toBeInstanceOf(GithubProvider);
  });
});

describe('resolveRef', () => {
  const p = getGitProvider(GH);
  it('acepta owner/repo, url y .git; rechaza lo inválido', () => {
    expect(p.resolveRef('o/r')).toMatchObject({ owner: 'o', repo: 'r' });
    expect(p.resolveRef('o/r.git')).toMatchObject({ owner: 'o', repo: 'r' });
    expect(p.resolveRef('https://github.com/o/r')).toMatchObject({ owner: 'o', repo: 'r' });
    expect(p.resolveRef('')).toBeNull();
    expect(p.resolveRef('https://gitlab.com/o/r')).toBeNull();
  });
  it('propaga error de repo inválido en las operaciones', async () => {
    await expect(p.getPrMeta({ repo: '', number: 1, token: 't' })).rejects.toThrow(/repo inválido/);
  });
});

describe('GithubProvider (shape github)', () => {
  it('listPrs mapea y pega a api.github.com', async () => {
    const f = vi.fn().mockResolvedValue(
      jsonRes(200, [
        { number: 1, title: 't', state: 'open', merged_at: null, html_url: 'u', created_at: 'c', user: { login: 'a' }, head: { ref: 'agent/hu-1' } },
      ]),
    );
    const p = getGitProvider(GH, f as unknown as typeof fetch);
    const prs = await p.listPrs({ repo: 'o/r', state: 'all', token: 't' });
    expect(f.mock.calls[0]![0]).toBe('https://api.github.com/repos/o/r/pulls?state=all&per_page=50&sort=updated&direction=desc');
    expect(prs[0]).toMatchObject({ number: 1, merged: false, headRef: 'agent/hu-1', author: 'a' });
  });

  it('getPrDiff pide el diff con Accept vnd.github.diff sobre /pulls/{n}', async () => {
    const f = vi.fn().mockResolvedValue(textRes(200, 'diff --git a b'));
    const p = getGitProvider(GH, f as unknown as typeof fetch);
    const diff = await p.getPrDiff({ repo: 'o/r', number: 5, token: 't' });
    expect(diff).toBe('diff --git a b');
    expect(f.mock.calls[0]![0]).toBe('https://api.github.com/repos/o/r/pulls/5');
    expect((f.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ accept: 'application/vnd.github.diff' });
  });

  it('getTree usa recursive=1 y filtra blobs/trees', async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(200, { tree: [{ path: 'a', type: 'blob', size: 3 }, { path: 'b', type: 'commit' }] }));
    const p = getGitProvider(GH, f as unknown as typeof fetch);
    const tree = await p.getTree({ repo: 'o/r', branch: 'main', token: 't' });
    expect(f.mock.calls[0]![0]).toContain('recursive=1');
    expect(tree).toEqual([{ path: 'a', type: 'blob', size: 3 }]);
  });

  it('getFileContent decodifica base64 y trunca', async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(200, { content: b64('x'.repeat(50)), encoding: 'base64' }));
    const p = getGitProvider(GH, f as unknown as typeof fetch);
    const r = await p.getFileContent({ repo: 'o/r', branch: 'main', path: 'a.ts', token: 't', maxBytes: 10 });
    expect(r.truncated).toBe(true);
    expect(r.content.length).toBe(10);
  });

  it('getFileContent lanza si no es base64', async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(200, { encoding: 'none' }));
    const p = getGitProvider(GH, f as unknown as typeof fetch);
    await expect(p.getFileContent({ repo: 'o/r', branch: 'main', path: 'a.ts', token: 't' })).rejects.toThrow();
  });

  it('getPrMeta mapea metadatos y propaga error de status', async () => {
    const ok = vi.fn().mockResolvedValue(jsonRes(200, { title: 'T', merged_at: 'x', additions: 2, changed_files: 1, head: { ref: 'h' }, html_url: 'u' }));
    const p = getGitProvider(GH, ok as unknown as typeof fetch);
    expect(await p.getPrMeta({ repo: 'o/r', number: 1, token: 't' })).toMatchObject({ title: 'T', merged: true, additions: 2, changedFiles: 1, headRef: 'h' });
    const bad = getGitProvider(GH, (vi.fn().mockResolvedValue(jsonRes(404, {})) as unknown) as typeof fetch);
    await expect(bad.getPrMeta({ repo: 'o/r', number: 1, token: 't' })).rejects.toThrow('git 404');
  });

  it('createRepo: 201, 422→existente vía currentLogin, y error', async () => {
    const created = vi.fn().mockResolvedValue(jsonRes(201, { full_name: 'me/w', html_url: 'u', default_branch: '' }));
    let p = getGitProvider(GH, created as unknown as typeof fetch);
    expect(await p.createRepo({ name: 'w', token: 't' })).toEqual({ fullName: 'me/w', htmlUrl: 'u', defaultBranch: 'main', existed: false });
    expect(created.mock.calls[0]![0]).toBe('https://api.github.com/user/repos');

    const existing = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(422, { message: 'exists' }))
      .mockResolvedValueOnce(jsonRes(200, { login: 'octo' }));
    p = getGitProvider(GH, existing as unknown as typeof fetch);
    expect(await p.createRepo({ name: 'w', token: 't' })).toMatchObject({ fullName: 'octo/w', htmlUrl: 'https://github.com/octo/w', existed: true });

    const err = getGitProvider(GH, (vi.fn().mockResolvedValue(jsonRes(500, { message: 'boom' })) as unknown) as typeof fetch);
    await expect(err.createRepo({ name: 'w', org: 'acme', token: 't' })).rejects.toThrow(/HTTP 500/);
  });

  it('getCollaboratorPermission: 404→none, permiso válido, y error', async () => {
    let p = getGitProvider(GH, (vi.fn().mockResolvedValue(jsonRes(404, {})) as unknown) as typeof fetch);
    expect(await p.getCollaboratorPermission({ repo: 'o/r', username: 'u', token: 't' })).toBe('none');
    p = getGitProvider(GH, (vi.fn().mockResolvedValue(jsonRes(200, { permission: 'admin' })) as unknown) as typeof fetch);
    expect(await p.getCollaboratorPermission({ repo: 'o/r', username: 'u', token: 't' })).toBe('admin');
    p = getGitProvider(GH, (vi.fn().mockResolvedValue(jsonRes(200, { permission: 'maintain' })) as unknown) as typeof fetch);
    expect(await p.getCollaboratorPermission({ repo: 'o/r', username: 'u', token: 't' })).toBe('none');
    p = getGitProvider(GH, (vi.fn().mockResolvedValue(jsonRes(403, {})) as unknown) as typeof fetch);
    await expect(p.getCollaboratorPermission({ repo: 'o/r', username: 'u', token: 't' })).rejects.toThrow(/HTTP 403/);
  });
});

describe('ForgejoProvider (shape gitea)', () => {
  it('getPrDiff usa el sufijo .diff (sin Accept especial) sobre la base gitea', async () => {
    const f = vi.fn().mockResolvedValue(textRes(200, 'diff'));
    const p = getGitProvider(FJ, f as unknown as typeof fetch);
    await p.getPrDiff({ repo: 'o/r', number: 7, token: 'fj' });
    expect(f.mock.calls[0]![0]).toBe('https://git.fusion-soft-lab.com/api/v1/repos/o/r/pulls/7.diff');
    expect((f.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
      authorization: 'token fj',
      accept: 'application/json',
    });
  });

  it('getTree usa recursive=true', async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(200, { tree: [{ path: 'a', type: 'blob' }] }));
    const p = getGitProvider(FJ, f as unknown as typeof fetch);
    await p.getTree({ repo: 'o/r', branch: 'main', token: 'fj' });
    expect(f.mock.calls[0]![0]).toContain('recursive=true');
  });

  it('createRepo trata 409 como existente y arma htmlUrl con el host forgejo', async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(409, { message: 'exists' }));
    const p = getGitProvider(FJ, f as unknown as typeof fetch);
    expect(await p.createRepo({ name: 'w', org: 'acme', token: 'fj' })).toEqual({
      fullName: 'acme/w',
      htmlUrl: 'https://git.fusion-soft-lab.com/acme/w',
      defaultBranch: 'main',
      existed: true,
    });
    expect(f.mock.calls[0]![0]).toBe('https://git.fusion-soft-lab.com/api/v1/orgs/acme/repos');
  });
});
