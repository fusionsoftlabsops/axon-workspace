import { describe, it, expect, vi, beforeEach } from 'vitest';

let envConfig: Record<string, unknown>;
vi.mock('@/lib/env', () => ({ env: () => envConfig }));

import { isGraphifyConfigured, analyzeRepos, getProgress, graphifyHealthy } from './graphify-client';

const fetchMock = vi.fn();

beforeEach(() => {
  envConfig = { GRAPHIFY_URL: 'http://graphify.internal/', GRAPHIFY_BACKEND: 'claude', GRAPHIFY_AUTH_TOKEN: 'tok' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('isGraphifyConfigured', () => {
  it('reflects whether GRAPHIFY_URL is set', () => {
    expect(isGraphifyConfigured()).toBe(true);
    envConfig = {};
    expect(isGraphifyConfigured()).toBe(false);
  });
});

describe('analyzeRepos', () => {
  const repos = [{ name: 'api', githubFullName: 'org/api' }];

  it('posts to /analyze with auth + backend + jobId and returns the result', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ graph: { nodes: [] }, stats: { nodes: 0 }, backend: 'claude' }) });
    const res = await analyzeRepos(repos, { jobId: 'job-1' });
    expect(res.backend).toBe('claude');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://graphify.internal/analyze'); // trailing slash trimmed
    expect(init.headers.authorization).toBe('Bearer tok');
    const body = JSON.parse(init.body);
    expect(body.backend).toBe('claude');
    expect(body.jobId).toBe('job-1');
    expect(body.repos).toEqual(repos);
  });

  it('omits backend/jobId/auth when not configured/provided', async () => {
    envConfig = { GRAPHIFY_URL: 'http://g/' };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await analyzeRepos(repos);
    const init = fetchMock.mock.calls[0]![1];
    expect(init.headers.authorization).toBeUndefined();
    const body = JSON.parse(init.body);
    expect(body.backend).toBeUndefined();
    expect(body.jobId).toBeUndefined();
  });

  it('honors an explicit backend override', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await analyzeRepos(repos, { backend: 'deepseek' });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).backend).toBe('deepseek');
  });

  it('throws when GRAPHIFY_URL is unset', async () => {
    envConfig = {};
    await expect(analyzeRepos(repos)).rejects.toThrow('GRAPHIFY_URL');
  });

  it('throws with the truncated detail on a non-ok response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    await expect(analyzeRepos(repos)).rejects.toThrow('graphify-svc 500: boom');
  });

  it('tolerates a failing error-body read', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => { throw new Error('no body'); } });
    await expect(analyzeRepos(repos)).rejects.toThrow('graphify-svc 503');
  });
});

describe('getProgress', () => {
  it('returns null when not configured', async () => {
    envConfig = {};
    expect(await getProgress('j')).toBeNull();
  });

  it('returns the progress payload on success (with auth header)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ phase: 'building', percent: 42 }) });
    const p = await getProgress('job-9');
    expect(p).toEqual({ phase: 'building', percent: 42 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://graphify.internal/progress/job-9');
    expect(init.headers.authorization).toBe('Bearer tok');
  });

  it('returns null on a non-ok response or a thrown fetch', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    expect(await getProgress('j')).toBeNull();
    fetchMock.mockRejectedValue(new Error('network'));
    expect(await getProgress('j')).toBeNull();
  });
});

describe('graphifyHealthy', () => {
  it('false when unset; true on ok; false on throw', async () => {
    envConfig = {};
    expect(await graphifyHealthy()).toBe(false);
    envConfig = { GRAPHIFY_URL: 'http://g/' };
    fetchMock.mockResolvedValue({ ok: true });
    expect(await graphifyHealthy()).toBe(true);
    fetchMock.mockRejectedValue(new Error('down'));
    expect(await graphifyHealthy()).toBe(false);
  });
});
