import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same idiom as fusion-client.test.ts: mock @/lib/env with a mutable config.
let envConfig: Record<string, unknown>;
vi.mock('@/lib/env', () => ({ env: () => envConfig }));

import { FusionError } from './fusion-client';
import { createModelToken, getExposedModels, isFusionConfigured } from './fusion-coding-tools';

const fetchMock = vi.fn();
const BASE = 'http://control-plane:3030/api';

function ok(data: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(data),
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
  envConfig = { FUSION_INFRA_URL: BASE, FUSION_INFRA_TOKEN: 'fapi_test', FUSION_INFRA_TEAM_ID: 't1' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('isFusionConfigured (re-export)', () => {
  it('true when URL + TOKEN set', () => {
    expect(isFusionConfigured()).toBe(true);
  });
  it('false when TOKEN missing', () => {
    envConfig = { FUSION_INFRA_URL: BASE };
    expect(isFusionConfigured()).toBe(false);
  });
});

describe('getExposedModels', () => {
  it('GETs /coding-tools/model with auth + x-team-id', async () => {
    const models = [{ appId: 'app1', name: 'vllm', url: 'https://vllm-api.test' }];
    fetchMock.mockResolvedValue(ok(models));
    const res = await getExposedModels();
    expect(res).toEqual(models);
    const c = callArgs();
    expect(c.url).toBe(`${BASE}/coding-tools/model`);
    expect(c.method).toBe('GET');
    expect(c.headers.authorization).toBe('Bearer fapi_test');
    expect(c.headers['x-team-id']).toBe('t1');
  });

  it('honors an explicit teamId over the env one', async () => {
    fetchMock.mockResolvedValue(ok([]));
    await getExposedModels('t9');
    expect(callArgs().headers['x-team-id']).toBe('t9');
  });
});

describe('createModelToken', () => {
  it('POSTs /applications/:id/tokens with the name and returns the one-time token', async () => {
    const minted = { id: 'mt1', name: 'Fusion Code – Ana – axon/p', createdAt: 'now', token: 'fsn_SECRET' };
    fetchMock.mockResolvedValue(ok(minted));
    const res = await createModelToken('app1', 'Fusion Code – Ana – axon/p');
    expect(res).toEqual(minted);
    const c = callArgs();
    expect(c.url).toBe(`${BASE}/applications/app1/tokens`);
    expect(c.method).toBe('POST');
    expect(c.headers['content-type']).toBe('application/json');
    expect(c.body).toEqual({ name: 'Fusion Code – Ana – axon/p' });
  });

  it('truncates the name to the control-plane 80-char cap', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'mt1', name: 'x', createdAt: 'now', token: 'fsn_x' }));
    await createModelToken('app1', 'x'.repeat(120));
    expect((callArgs().body as { name: string }).name).toHaveLength(80);
  });

  it('throws FusionError with the control-plane message on failure', async () => {
    fetchMock.mockResolvedValue(fail(400, { message: 'this resource is not exposed as an API' }));
    await expect(createModelToken('app1', 'n')).rejects.toThrowError(FusionError);
    await expect(createModelToken('app1', 'n')).rejects.toThrow(/400: this resource is not exposed/);
  });

  it('throws a config error when fusion-infra is unset', async () => {
    envConfig = {};
    await expect(createModelToken('app1', 'n')).rejects.toThrow(/no está configurado/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
