import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mirror the graphify-client.test idiom: mock @/lib/env with a mutable config
// (env() caches in real life, so swapping the module out side-steps the cache).
let envConfig: Record<string, unknown>;
vi.mock('@/lib/env', () => ({ env: () => envConfig }));

import {
  isFusionConfigured,
  FusionError,
  teamOf,
  getContext,
  createProject,
  listEnvironments,
  createEnvironment,
  listApps,
  getApp,
  createApp,
  deleteApp,
  deployApp,
  redeployApp,
  stopApp,
  startApp,
  recreateApp,
  rollbackApp,
  setAppEnv,
  getAppEnvKeys,
  getDeployment,
  appDeployments,
  dbCatalog,
  createDatabase,
  getDbCredentials,
} from './fusion-client';

const fetchMock = vi.fn();
const BASE = 'http://control-plane:3030/api';

function ok(data: unknown, init: Partial<{ status: number; statusText: string }> = {}) {
  return {
    ok: true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    text: async () => (data === undefined ? '' : JSON.stringify(data)),
  };
}
function fail(status: number, body: unknown, statusText = 'Error') {
  return {
    ok: false,
    status,
    statusText,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/** url + parsed init from the Nth fetch call. */
function callArgs(n = 0): { url: string; method: string; headers: Record<string, string>; body: unknown } {
  const [url, init] = fetchMock.mock.calls[n]!;
  return {
    url,
    method: init.method,
    headers: init.headers,
    body: init.body === undefined ? undefined : JSON.parse(init.body),
  };
}

beforeEach(() => {
  envConfig = { FUSION_INFRA_URL: BASE, FUSION_INFRA_TOKEN: 'fapi_test' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('isFusionConfigured', () => {
  it('true when URL + TOKEN set', () => {
    expect(isFusionConfigured()).toBe(true);
  });
  it('false when TOKEN missing', () => {
    envConfig = { FUSION_INFRA_URL: BASE };
    expect(isFusionConfigured()).toBe(false);
  });
  it('false when URL missing', () => {
    envConfig = { FUSION_INFRA_TOKEN: 'fapi_test' };
    expect(isFusionConfigured()).toBe(false);
  });
});

describe('api headers / wiring (via thin methods)', () => {
  it('getContext: GET /context, auth header, no x-team-id, no content-type', async () => {
    const ctx = { defaultTeamId: 't1', servers: [], teams: [], projects: [], user: {} };
    fetchMock.mockResolvedValue(ok(ctx));
    const res = await getContext();
    expect(res).toEqual(ctx);
    const c = callArgs();
    expect(c.url).toBe(`${BASE}/context`);
    expect(c.method).toBe('GET');
    expect(c.headers.authorization).toBe('Bearer fapi_test');
    expect(c.headers['x-team-id']).toBeUndefined();
    expect(c.headers['content-type']).toBeUndefined();
  });

  it('trims trailing slashes from the base URL', async () => {
    envConfig = { FUSION_INFRA_URL: `${BASE}///`, FUSION_INFRA_TOKEN: 'fapi_test' };
    fetchMock.mockResolvedValue(ok({}));
    await getContext();
    expect(callArgs().url).toBe(`${BASE}/context`);
  });

  it('createProject: POST /projects with body + x-team-id + content-type', async () => {
    const proj = { id: 'p1', teamId: 't1', name: 'My App' };
    fetchMock.mockResolvedValue(ok(proj));
    const res = await createProject('My App', 't1');
    expect(res).toEqual(proj);
    const c = callArgs();
    expect(c.url).toBe(`${BASE}/projects`);
    expect(c.method).toBe('POST');
    expect(c.headers['x-team-id']).toBe('t1');
    expect(c.headers['content-type']).toBe('application/json');
    expect(c.body).toEqual({ name: 'My App' });
  });

  it('listEnvironments: GET /projects/:id/environments', async () => {
    fetchMock.mockResolvedValue(ok([{ id: 'e1', name: 'production' }]));
    const res = await listEnvironments('p1', 't1');
    expect(res).toEqual([{ id: 'e1', name: 'production' }]);
    const c = callArgs();
    expect(c.url).toBe(`${BASE}/projects/p1/environments`);
    expect(c.method).toBe('GET');
    expect(c.headers['x-team-id']).toBe('t1');
  });

  it('createEnvironment: POST /projects/:id/environments with body', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'e2', name: 'staging' }));
    await createEnvironment('p1', 'staging', 't1');
    const c = callArgs();
    expect(c.url).toBe(`${BASE}/projects/p1/environments`);
    expect(c.method).toBe('POST');
    expect(c.body).toEqual({ name: 'staging' });
  });

  it('listApps: GET /applications with encoded environmentId query', async () => {
    fetchMock.mockResolvedValue(ok([]));
    await listApps('env/with space', 't1');
    const c = callArgs();
    expect(c.url).toBe(`${BASE}/applications?environmentId=${encodeURIComponent('env/with space')}`);
    expect(c.method).toBe('GET');
    expect(c.headers['x-team-id']).toBe('t1');
  });

  it('getApp: GET /applications/:id', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'a1' }));
    await getApp('a1', 't1');
    expect(callArgs().url).toBe(`${BASE}/applications/a1`);
  });

  it('createApp: POST /applications with the input as body', async () => {
    const input = {
      name: 'web',
      environmentId: 'e1',
      serverId: 's1',
      buildPack: 'DOCKERFILE' as const,
      repository: 'https://github.com/o/r',
    };
    fetchMock.mockResolvedValue(ok({ id: 'a1' }));
    await createApp(input, 't1');
    const c = callArgs();
    expect(c.url).toBe(`${BASE}/applications`);
    expect(c.method).toBe('POST');
    expect(c.body).toEqual(input);
  });

  it('deleteApp: DELETE /applications/:id, empty body → null return', async () => {
    fetchMock.mockResolvedValue(ok(undefined));
    const res = await deleteApp('a1', 't1');
    expect(res).toBeNull();
    const c = callArgs();
    expect(c.url).toBe(`${BASE}/applications/a1`);
    expect(c.method).toBe('DELETE');
    expect(c.body).toBeUndefined();
  });

  it.each([
    ['deployApp', deployApp, 'deploy'],
    ['redeployApp', redeployApp, 'redeploy'],
    ['stopApp', stopApp, 'stop'],
    ['startApp', startApp, 'start'],
    ['recreateApp', recreateApp, 'recreate'],
  ] as const)('%s: POST /applications/:id/%s → ack', async (_name, fn, op) => {
    fetchMock.mockResolvedValue(ok({ deploymentId: 'd1' }));
    const res = await fn('a1', 't1');
    expect(res).toEqual({ deploymentId: 'd1' });
    const c = callArgs();
    expect(c.url).toBe(`${BASE}/applications/a1/${op}`);
    expect(c.method).toBe('POST');
    expect(c.headers['x-team-id']).toBe('t1');
  });

  it('rollbackApp: POST /applications/:id/rollback/:depId', async () => {
    fetchMock.mockResolvedValue(ok({ deploymentId: 'd2' }));
    const res = await rollbackApp('a1', 'fd9', 't1');
    expect(res).toEqual({ deploymentId: 'd2' });
    expect(callArgs().url).toBe(`${BASE}/applications/a1/rollback/fd9`);
  });

  it('setAppEnv: PATCH /applications/:id with the patch as body', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'a1' }));
    const patch = { envSet: { K: 'v' }, envUnset: ['OLD'] };
    await setAppEnv('a1', patch, 't1');
    const c = callArgs();
    expect(c.url).toBe(`${BASE}/applications/a1`);
    expect(c.method).toBe('PATCH');
    expect(c.body).toEqual(patch);
  });

  it('getAppEnvKeys: GET /applications/:id/env', async () => {
    fetchMock.mockResolvedValue(ok({ keys: ['A', 'B'] }));
    const res = await getAppEnvKeys('a1', 't1');
    expect(res).toEqual({ keys: ['A', 'B'] });
    expect(callArgs().url).toBe(`${BASE}/applications/a1/env`);
  });

  it('getDeployment: GET /deployments/:id', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'd1', logs: [] }));
    await getDeployment('d1', 't1');
    expect(callArgs().url).toBe(`${BASE}/deployments/d1`);
  });

  it('appDeployments: GET /applications/:id/deployments', async () => {
    fetchMock.mockResolvedValue(ok([]));
    await appDeployments('a1', 't1');
    expect(callArgs().url).toBe(`${BASE}/applications/a1/deployments`);
  });

  it('dbCatalog: GET /databases/catalog, no x-team-id', async () => {
    fetchMock.mockResolvedValue(ok([{ engine: 'POSTGRES', versions: ['16'], default_port: 5432 }]));
    const res = await dbCatalog();
    expect(res[0]!.engine).toBe('POSTGRES');
    const c = callArgs();
    expect(c.url).toBe(`${BASE}/databases/catalog`);
    expect(c.headers['x-team-id']).toBeUndefined();
  });

  it('createDatabase: POST /databases with body', async () => {
    const input = {
      name: 'db',
      environmentId: 'e1',
      serverId: 's1',
      engine: 'POSTGRES' as const,
      version: '16',
    };
    fetchMock.mockResolvedValue(ok({ id: 'db1' }));
    await createDatabase(input, 't1');
    const c = callArgs();
    expect(c.url).toBe(`${BASE}/databases`);
    expect(c.method).toBe('POST');
    expect(c.body).toEqual(input);
  });

  it('getDbCredentials: GET /applications/:id/credentials', async () => {
    fetchMock.mockResolvedValue(ok({ local: {} }));
    await getDbCredentials('a1', 't1');
    expect(callArgs().url).toBe(`${BASE}/applications/a1/credentials`);
  });
});

describe('api error handling', () => {
  it('throws FusionError with body.message', async () => {
    fetchMock.mockResolvedValue(fail(400, { message: 'bad input' }));
    await expect(getContext()).rejects.toMatchObject({
      name: 'FusionError',
      status: 400,
    });
    await expect(getContext()).rejects.toThrow('fusion-infra 400: bad input');
  });

  it('falls back to the raw text when there is no message field', async () => {
    fetchMock.mockResolvedValue(fail(500, 'internal boom'));
    await expect(getContext()).rejects.toThrow('fusion-infra 500: internal boom');
  });

  it('falls back to statusText when the body is empty', async () => {
    fetchMock.mockResolvedValue(fail(502, '', 'Bad Gateway'));
    await expect(getContext()).rejects.toThrow('fusion-infra 502: Bad Gateway');
  });

  it('handles a non-JSON error body (safeJson returns the string)', async () => {
    fetchMock.mockResolvedValue(fail(503, '<html>down</html>'));
    await expect(getContext()).rejects.toThrow('fusion-infra 503: <html>down</html>');
  });

  it('truncates very long messages to 300 chars', async () => {
    const long = 'x'.repeat(500);
    fetchMock.mockResolvedValue(fail(400, { message: long }));
    await expect(getContext()).rejects.toThrow(`fusion-infra 400: ${'x'.repeat(300)}`);
  });

  it('FusionError is an Error subclass carrying status', () => {
    const e = new FusionError(418, 'teapot');
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(418);
    expect(e.message).toBe('teapot');
    expect(e.name).toBe('FusionError');
  });

  it('throws "no está configurado" when URL/TOKEN missing', async () => {
    envConfig = {};
    await expect(getContext()).rejects.toThrow('fusion-infra no está configurado');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('teamOf', () => {
  it('returns an explicit teamId without calling the API', async () => {
    expect(await teamOf('explicit')).toBe('explicit');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses FUSION_INFRA_TEAM_ID override when no explicit id', async () => {
    envConfig = { ...envConfig, FUSION_INFRA_TEAM_ID: 'env-team' };
    expect(await teamOf()).toBe('env-team');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to GET /context defaultTeamId', async () => {
    fetchMock.mockResolvedValue(ok({ defaultTeamId: 'ctx-team' }));
    expect(await teamOf()).toBe('ctx-team');
    expect(callArgs().url).toBe(`${BASE}/context`);
  });

  it('throws when context has no defaultTeamId', async () => {
    fetchMock.mockResolvedValue(ok({ defaultTeamId: null }));
    await expect(teamOf()).rejects.toThrow('sin team por defecto');
  });
});
