import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  auditMock,
  assertMock,
  isConfiguredMock,
  markAnalyzingMock,
  runProjectAnalysisMock,
  collectReposMock,
  revalidateMock,
} = vi.hoisted(() => ({
  prismaMock: { codeAnalysis: { findUnique: vi.fn() } },
  auditMock: vi.fn(),
  assertMock: vi.fn(),
  isConfiguredMock: vi.fn(),
  markAnalyzingMock: vi.fn(),
  runProjectAnalysisMock: vi.fn(),
  collectReposMock: vi.fn(),
  revalidateMock: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: assertMock }));
vi.mock('@/lib/analysis/graphify-client', () => ({ isGraphifyConfigured: isConfiguredMock }));
vi.mock('@/lib/analysis/run', () => ({
  markAnalyzing: markAnalyzingMock,
  runProjectAnalysis: runProjectAnalysisMock,
  collectAnalyzableRepos: collectReposMock,
}));

import { getAnalysisAction, analyzeProjectAction } from './analysis';

const okCtx = { ok: true, userId: 'u1', projectId: 'p1', role: 'OWNER' as const };
const row = {
  status: 'READY',
  summary: 's',
  godNodes: [{ id: 'n' }],
  stats: { a: 1 },
  backend: 'be',
  error: null,
  updatedAt: new Date('2020-01-01T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  isConfiguredMock.mockReturnValue(true);
  collectReposMock.mockResolvedValue({ inputs: [{ repo: 'r' }] });
});

describe('getAnalysisAction', () => {
  it('returns the membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'nope' });
    const res = await getAnalysisAction('slug');
    expect(res).toEqual({ ok: false, error: 'nope' });
  });

  it('loads the view from the persisted row', async () => {
    assertMock.mockResolvedValue(okCtx);
    prismaMock.codeAnalysis.findUnique.mockResolvedValue(row);
    const res = await getAnalysisAction('slug');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.status).toBe('READY');
      expect(res.data.analyzableRepoCount).toBe(1);
      expect(res.data.configured).toBe(true);
      expect(res.data.updatedAt).toBe('2020-01-01T00:00:00.000Z');
    }
  });

  it('defaults the view when no row exists', async () => {
    assertMock.mockResolvedValue(okCtx);
    prismaMock.codeAnalysis.findUnique.mockResolvedValue(null);
    const res = await getAnalysisAction('slug');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.status).toBe('NONE');
      expect(res.data.godNodes).toEqual([]);
      expect(res.data.updatedAt).toBeNull();
    }
  });
});

describe('analyzeProjectAction', () => {
  it('returns membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await analyzeProjectAction('slug')).toEqual({ ok: false, error: 'nope' });
  });

  it('rejects non OWNER/ADMIN', async () => {
    assertMock.mockResolvedValue({ ...okCtx, role: 'MEMBER' });
    const res = await analyzeProjectAction('slug');
    expect(res.ok).toBe(false);
  });

  it('rejects when graphify is not configured', async () => {
    assertMock.mockResolvedValue(okCtx);
    isConfiguredMock.mockReturnValue(false);
    const res = await analyzeProjectAction('slug');
    expect(res).toMatchObject({ ok: false });
  });

  it('rejects when an analysis is already in progress', async () => {
    assertMock.mockResolvedValue(okCtx);
    prismaMock.codeAnalysis.findUnique.mockResolvedValue({ status: 'ANALYZING' });
    const res = await analyzeProjectAction('slug');
    expect(res).toEqual({ ok: false, error: 'Ya hay un análisis en curso' });
  });

  it('rejects when there are no analyzable repos', async () => {
    assertMock.mockResolvedValue(okCtx);
    prismaMock.codeAnalysis.findUnique.mockResolvedValue({ status: 'NONE' });
    collectReposMock.mockResolvedValue({ inputs: [] });
    const res = await analyzeProjectAction('slug');
    expect(res).toMatchObject({ ok: false });
  });

  it('starts the analysis, audits, revalidates and returns the view', async () => {
    assertMock.mockResolvedValue(okCtx);
    prismaMock.codeAnalysis.findUnique
      .mockResolvedValueOnce({ status: 'READY' }) // status guard
      .mockResolvedValue(row); // loadView
    runProjectAnalysisMock.mockResolvedValue(undefined);
    const res = await analyzeProjectAction('slug');
    expect(markAnalyzingMock).toHaveBeenCalledWith('p1');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'analysis.start' }));
    expect(revalidateMock).toHaveBeenCalledWith('/projects/slug/plan');
    expect(res.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(runProjectAnalysisMock).toHaveBeenCalled();
  });

  it('swallows a background run failure', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    assertMock.mockResolvedValue(okCtx);
    prismaMock.codeAnalysis.findUnique
      .mockResolvedValueOnce({ status: 'NONE' })
      .mockResolvedValue(row);
    runProjectAnalysisMock.mockRejectedValue(new Error('bg fail'));
    await analyzeProjectAction('slug');
    await new Promise((r) => setTimeout(r, 0));
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
