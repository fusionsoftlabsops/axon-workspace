import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const findMany = vi.fn();
const upsert = vi.fn();
const update = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    projectRepo: { findMany: (...a: unknown[]) => findMany(...a) },
    codeAnalysis: { upsert: (...a: unknown[]) => upsert(...a), update: (...a: unknown[]) => update(...a) },
  },
}));

vi.mock('@prisma/client', () => ({ Prisma: {} }));

let envConfig: Record<string, unknown>;
vi.mock('@/lib/env', () => ({ env: () => envConfig }));

const analyzeRepos = vi.fn();
const getProgress = vi.fn();
vi.mock('./graphify-client', () => ({
  analyzeRepos: (...a: unknown[]) => analyzeRepos(...a),
  getProgress: (...a: unknown[]) => getProgress(...a),
}));

const describeCodeGraph = vi.fn();
vi.mock('./describe', () => ({ describeCodeGraph: (...a: unknown[]) => describeCodeGraph(...a) }));

const seedBrainFromAnalysis = vi.fn();
vi.mock('./seed-brain', () => ({ seedBrainFromAnalysis: (...a: unknown[]) => seedBrainFromAnalysis(...a) }));

import { collectAnalyzableRepos, markAnalyzing, runProjectAnalysis } from './run';

beforeEach(() => {
  envConfig = { GITHUB_TOKEN: 'ghtok', GRAPHIFY_BACKEND: 'claude' };
  findMany.mockReset();
  upsert.mockReset().mockResolvedValue({});
  update.mockReset().mockResolvedValue({});
  analyzeRepos.mockReset();
  getProgress.mockReset();
  describeCodeGraph.mockReset();
  seedBrainFromAnalysis.mockReset().mockResolvedValue(1);
});

describe('collectAnalyzableRepos', () => {
  it('embeds the Axon token and uses githubFullName / url regex / default branch', async () => {
    findMany.mockResolvedValue([
      { name: 'api', kind: 'backend', url: null, githubFullName: 'org/api', defaultBranch: 'develop' },
      { name: 'web', kind: 'frontend', url: 'https://github.com/org/web.git', githubFullName: null, defaultBranch: null },
      { name: 'nope', kind: 'other', url: 'https://example.com/x', githubFullName: null, defaultBranch: null },
    ]);
    const { inputs, refs } = await collectAnalyzableRepos('p1');
    expect(inputs).toHaveLength(2); // the non-github repo is skipped
    expect(inputs[0]!.cloneUrl).toBe('https://x-access-token:ghtok@github.com/org/api.git');
    expect(inputs[0]!.branch).toBe('develop');
    expect(inputs[1]!.githubFullName).toBe('org/web'); // extracted from url
    expect(inputs[1]!.branch).toBe('main'); // default
    expect(refs.map((r) => r.name)).toEqual(['api', 'web']);
  });

  it('falls back to a plain clone url when no token is set', async () => {
    envConfig = {};
    findMany.mockResolvedValue([{ name: 'api', kind: 'backend', url: null, githubFullName: 'org/api', defaultBranch: 'main' }]);
    const { inputs } = await collectAnalyzableRepos('p1');
    expect(inputs[0]!.cloneUrl).toBe('https://github.com/org/api.git');
  });

  it('uses the existing url when no token and a url is present', async () => {
    envConfig = {};
    findMany.mockResolvedValue([{ name: 'web', kind: 'frontend', url: 'https://github.com/org/web', githubFullName: 'org/web', defaultBranch: 'main' }]);
    const { inputs } = await collectAnalyzableRepos('p1');
    expect(inputs[0]!.cloneUrl).toBe('https://github.com/org/web');
  });
});

describe('markAnalyzing', () => {
  it('upserts the CodeAnalysis row as ANALYZING', async () => {
    await markAnalyzing('p1');
    expect(upsert).toHaveBeenCalledWith({
      where: { projectId: 'p1' },
      create: { projectId: 'p1', status: 'ANALYZING' },
      update: { status: 'ANALYZING', error: null },
    });
  });
});

describe('runProjectAnalysis', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('marks FAILED when there are no analyzable repos', async () => {
    findMany.mockResolvedValue([]);
    await runProjectAnalysis({ projectId: 'p1', authorId: 'u1' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: 'p1' }, data: expect.objectContaining({ status: 'FAILED' }) }));
    expect(analyzeRepos).not.toHaveBeenCalled();
  });

  it('runs the pipeline: polls progress, persists READY, and seeds the brain', async () => {
    findMany.mockResolvedValue([{ name: 'api', kind: 'backend', url: null, githubFullName: 'org/api', defaultBranch: 'main' }]);
    getProgress.mockResolvedValue({ phase: 'building', percent: 50 });
    analyzeRepos.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5000));
      return { graph: { nodes: [] }, stats: { nodes: 1 }, backend: 'claude', repos: ['api'] };
    });
    describeCodeGraph.mockReturnValue({ summary: 'resumen', godNodes: [{ id: 'a', label: 'A', degree: 2, community: '0' }] });

    const p = runProjectAnalysis({ projectId: 'p1', authorId: 'u1', backend: 'claude' });
    await vi.advanceTimersByTimeAsync(10_000);
    await p;

    expect(getProgress).toHaveBeenCalled();
    // a progress update + the final READY update both went through codeAnalysis.update
    const ready = update.mock.calls.find((c) => (c[0] as { data: { status?: string } }).data.status === 'READY');
    expect(ready).toBeTruthy();
    expect((ready![0] as { data: { summary: string } }).data.summary).toBe('resumen');
    expect(seedBrainFromAnalysis).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', authorId: 'u1', summary: 'resumen' }));
  });

  it('skips the progress update when the phase is unknown', async () => {
    findMany.mockResolvedValue([{ name: 'api', kind: 'backend', url: null, githubFullName: 'org/api', defaultBranch: 'main' }]);
    getProgress.mockResolvedValue({ phase: 'unknown', percent: 0 });
    analyzeRepos.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5000));
      return { graph: { nodes: [] }, stats: {}, backend: 'claude', repos: [] };
    });
    describeCodeGraph.mockReturnValue({ summary: 's', godNodes: [] });

    const p = runProjectAnalysis({ projectId: 'p1', authorId: 'u1' });
    await vi.advanceTimersByTimeAsync(10_000);
    await p;

    const progressUpdate = update.mock.calls.find((c) => (c[0] as { data: { stats?: { progress?: boolean } } }).data?.stats?.progress);
    expect(progressUpdate).toBeUndefined();
  });

  it('records FAILED with the error message when analysis throws', async () => {
    findMany.mockResolvedValue([{ name: 'api', kind: 'backend', url: null, githubFullName: 'org/api', defaultBranch: 'main' }]);
    getProgress.mockResolvedValue(null);
    analyzeRepos.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5000));
      throw new Error('graphify down');
    });

    const p = runProjectAnalysis({ projectId: 'p1', authorId: 'u1' });
    await vi.advanceTimersByTimeAsync(10_000);
    await p;

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', error: 'graphify down' }) }));
  });

  it('still succeeds (READY) when brain seeding fails (best-effort)', async () => {
    findMany.mockResolvedValue([{ name: 'api', kind: 'backend', url: null, githubFullName: 'org/api', defaultBranch: 'main' }]);
    getProgress.mockResolvedValue(null);
    analyzeRepos.mockResolvedValue({ graph: { nodes: [] }, stats: {}, backend: 'claude', repos: [] });
    describeCodeGraph.mockReturnValue({ summary: 's', godNodes: [] });
    seedBrainFromAnalysis.mockRejectedValue(new Error('seed boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const p = runProjectAnalysis({ projectId: 'p1', authorId: 'u1' });
    await vi.advanceTimersByTimeAsync(10_000);
    await p;

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'READY' }) }));
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('handles a thrown non-Error with a generic message', async () => {
    findMany.mockResolvedValue([{ name: 'api', kind: 'backend', url: null, githubFullName: 'org/api', defaultBranch: 'main' }]);
    getProgress.mockResolvedValue(null);
    analyzeRepos.mockRejectedValue('weird');

    const p = runProjectAnalysis({ projectId: 'p1', authorId: 'u1' });
    await vi.advanceTimersByTimeAsync(10_000);
    await p;

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', error: 'Error desconocido en el análisis' }) }));
  });
});
