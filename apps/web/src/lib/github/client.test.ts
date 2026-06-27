import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Controllable env: the github client reads GITHUB_TOKEN / GITHUB_ORG via env().
const envState = vi.hoisted(() => ({
  value: { GITHUB_TOKEN: 'ghp_test', GITHUB_ORG: 'acme' } as Record<string, unknown>,
}));
vi.mock('@/lib/env', () => ({ env: () => envState.value }));

import {
  isGithubConfigured,
  githubOrg,
  parseRepoFullName,
  createRepo,
  getCollaboratorPermission,
} from './client';

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  envState.value = { GITHUB_TOKEN: 'ghp_test', GITHUB_ORG: 'acme' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isGithubConfigured / githubOrg', () => {
  it('reports configured when a token is present', () => {
    expect(isGithubConfigured()).toBe(true);
    expect(githubOrg()).toBe('acme');
  });

  it('reports not-configured and no org when env is empty', () => {
    envState.value = { GITHUB_TOKEN: '', GITHUB_ORG: '' };
    expect(isGithubConfigured()).toBe(false);
    expect(githubOrg()).toBeUndefined();
  });
});

describe('parseRepoFullName', () => {
  it.each([
    ['owner/repo', 'owner/repo'],
    ['owner/repo.git', 'owner/repo'],
    ['https://github.com/acme/widgets', 'acme/widgets'],
    ['https://github.com/acme/widgets.git', 'acme/widgets'],
    ['git@github.com:acme/widgets.git', 'acme/widgets'],
    ['https://github.com/acme/widgets/', 'acme/widgets'],
  ])('%s -> %s', (input, expected) => {
    expect(parseRepoFullName(input)).toBe(expected);
  });

  it('returns null for empty or unparseable input', () => {
    expect(parseRepoFullName('')).toBeNull();
    expect(parseRepoFullName('   ')).toBeNull();
    expect(parseRepoFullName('https://example.com/not-a-repo')).toBeNull();
  });
});

describe('createRepo', () => {
  it('throws when github is not configured', async () => {
    envState.value = { GITHUB_TOKEN: '' };
    await expect(createRepo('x')).rejects.toThrow(/no está configurado/);
  });

  it('creates a repo under the org on 201', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        full_name: 'acme/widgets',
        html_url: 'https://github.com/acme/widgets',
        default_branch: 'main',
      }),
    );
    const r = await createRepo('widgets', { description: 'd', private: false });
    expect(r).toEqual({
      fullName: 'acme/widgets',
      htmlUrl: 'https://github.com/acme/widgets',
      defaultBranch: 'main',
      existed: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/orgs/acme/repos',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('falls back to default branch "main" when 201 omits it', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { full_name: 'acme/w', html_url: 'u', default_branch: '' }),
    );
    const r = await createRepo('w');
    expect(r.defaultBranch).toBe('main');
  });

  it('creates under /user/repos when no org is set', async () => {
    envState.value = { GITHUB_TOKEN: 'ghp_test', GITHUB_ORG: '' };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { full_name: 'me/w', html_url: 'u', default_branch: 'main' }),
    );
    await createRepo('w');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/user/repos',
      expect.anything(),
    );
  });

  it('treats 422 as an existing repo (org owner)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(422, { message: 'already exists' }));
    const r = await createRepo('widgets');
    expect(r).toEqual({
      fullName: 'acme/widgets',
      htmlUrl: 'https://github.com/acme/widgets',
      defaultBranch: 'main',
      existed: true,
    });
  });

  it('on 422 without org, resolves owner from currentLogin()', async () => {
    envState.value = { GITHUB_TOKEN: 'ghp_test', GITHUB_ORG: '' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(422, { message: 'exists' }))
      .mockResolvedValueOnce(jsonResponse(200, { login: 'octo' }));
    const r = await createRepo('widgets');
    expect(r.existed).toBe(true);
    expect(r.fullName).toBe('octo/widgets');
  });

  it('throws on 422 without org when currentLogin fails', async () => {
    envState.value = { GITHUB_TOKEN: 'ghp_test', GITHUB_ORG: '' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(422, { message: 'exists' }))
      .mockResolvedValueOnce(jsonResponse(500, {}));
    await expect(createRepo('widgets')).rejects.toThrow(/HTTP 422/);
  });

  it('throws on other error statuses including the body excerpt', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { message: 'boom' }));
    await expect(createRepo('widgets')).rejects.toThrow(/HTTP 500/);
  });
});

describe('getCollaboratorPermission', () => {
  it('throws when github is not configured', async () => {
    envState.value = { GITHUB_TOKEN: '' };
    await expect(getCollaboratorPermission('a/b', 'u')).rejects.toThrow(/no está configurado/);
  });

  it('maps 404 to "none"', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));
    expect(await getCollaboratorPermission('acme/w', 'octo')).toBe('none');
  });

  it.each(['admin', 'write', 'read'])('returns "%s" permission', async (perm) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { permission: perm }));
    expect(await getCollaboratorPermission('acme/w', 'octo')).toBe(perm);
  });

  it('normalizes an unknown permission to "none"', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { permission: 'maintain' }));
    expect(await getCollaboratorPermission('acme/w', 'octo')).toBe('none');
  });

  it('defaults to "none" when permission field is absent', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    expect(await getCollaboratorPermission('acme/w', 'octo')).toBe('none');
  });

  it('throws on non-404 error statuses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, {}));
    await expect(getCollaboratorPermission('acme/w', 'octo')).rejects.toThrow(/HTTP 403/);
  });
});
