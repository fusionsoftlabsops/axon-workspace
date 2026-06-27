import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../src/api-client.js';

function mockFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(impl as never);
  vi.stubGlobal('fetch', fn);
  return fn;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('ApiClient', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('builds URL, method, headers and JSON body for POST', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ ok: true }));
    const client = new ApiClient('https://api.example.com', 'tok_123');

    const result = await client.post<{ ok: boolean }>('/things', { a: 1 });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/things');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok_123',
      'Content-Type': 'application/json',
      'User-Agent': 'admin-mcp/0.1.0',
    });
  });

  it('strips a single trailing slash from baseUrl', async () => {
    const fetchMock = mockFetch(() => jsonResponse({}));
    const client = new ApiClient('https://api.example.com/', 'tok');

    await client.get('/x');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://api.example.com/x');
  });

  it('GET sends no body', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ items: [] }));
    const client = new ApiClient('https://api.example.com', 'tok');

    await client.get('/tasks');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('PATCH delegates with method and body', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ updated: true }));
    const client = new ApiClient('https://api.example.com', 'tok');

    const out = await client.patch<{ updated: boolean }>('/p', { toState: 'Done' });

    expect(out).toEqual({ updated: true });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ toState: 'Done' }));
  });

  it('returns undefined for 204 No Content (no json parse)', async () => {
    const json = vi.fn();
    mockFetch(
      () =>
        ({
          ok: true,
          status: 204,
          json,
          text: async () => '',
        }) as unknown as Response,
    );
    const client = new ApiClient('https://api.example.com', 'tok');

    const out = await client.get('/noop');

    expect(out).toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it('throws ApiError on non-2xx with sliced body', async () => {
    const longBody = 'E'.repeat(600);
    mockFetch(
      () =>
        ({
          ok: false,
          status: 500,
          json: async () => ({}),
          text: async () => longBody,
        }) as unknown as Response,
    );
    const client = new ApiClient('https://api.example.com', 'tok');

    await expect(client.get('/boom')).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      endpoint: 'GET /boom',
    });
    try {
      await client.get('/boom');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const e = err as ApiError;
      // body is sliced to 500 chars
      expect(e.message).toContain('E'.repeat(500));
      expect(e.message.length).toBeLessThan(600 + 40);
    }
  });

  it('falls back to "<no body>" when reading the error body fails', async () => {
    mockFetch(
      () =>
        ({
          ok: false,
          status: 502,
          json: async () => ({}),
          text: async () => {
            throw new Error('stream closed');
          },
        }) as unknown as Response,
    );
    const client = new ApiClient('https://api.example.com', 'tok');

    await expect(client.post('/x', { a: 1 })).rejects.toThrow('<no body>');
  });
});
