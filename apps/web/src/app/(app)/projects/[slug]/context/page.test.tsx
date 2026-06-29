import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  assertProjectMember: vi.fn(),
  buildProjectGraph: vi.fn(),
  graphSignature: vi.fn(() => 'sig-current'),
  isInfraLlmConfigured: vi.fn(() => true),
  summaryFindUnique: vi.fn(),
  codeAnalysisFindUnique: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  lastProps: null as Record<string, unknown> | null,
  analysisProps: null as Record<string, unknown> | null,
  codeGraphProps: null as Record<string, unknown> | null,
}));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: h.assertProjectMember }));
vi.mock('@/lib/graph/build', () => ({
  buildProjectGraph: h.buildProjectGraph,
  graphSignature: h.graphSignature,
}));
vi.mock('@/lib/ai/infra-llm', () => ({ isInfraLlmConfigured: h.isInfraLlmConfigured }));
vi.mock('@/lib/db', () => ({
  prisma: {
    contextSummary: { findUnique: h.summaryFindUnique },
    codeAnalysis: { findUnique: h.codeAnalysisFindUnique },
  },
}));
vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: unknown, en: unknown) => en }));
vi.mock('next/navigation', () => ({ notFound: h.notFound }));
vi.mock('./ContextGraphView', () => ({
  ContextGraphView: (props: Record<string, unknown>) => {
    h.lastProps = props;
    return <div data-testid="graph-view" />;
  },
}));
vi.mock('../plan/AnalysisPanel', () => ({
  AnalysisPanel: (props: Record<string, unknown>) => {
    h.analysisProps = props;
    return <div data-testid="analysis-panel" />;
  },
}));
vi.mock('./CodeGraphView', () => ({
  CodeGraphView: (props: Record<string, unknown>) => {
    h.codeGraphProps = props;
    return <div data-testid="code-graph" />;
  },
}));

import Page from './page';

const params = Promise.resolve({ slug: 'proj' });

describe('ContextPage', () => {
  beforeEach(() => {
    h.assertProjectMember.mockReset();
    h.buildProjectGraph.mockReset();
    h.summaryFindUnique.mockReset();
    h.isInfraLlmConfigured.mockReturnValue(true);
    h.graphSignature.mockReturnValue('sig-current');
    h.notFound.mockClear();
    h.lastProps = null;
    h.analysisProps = null;
    h.codeGraphProps = null;
    h.assertProjectMember.mockResolvedValue({ ok: true, projectId: 'p1', userId: 'u1', role: 'OWNER' });
    h.buildProjectGraph.mockResolvedValue({ nodes: [], edges: [] });
    h.summaryFindUnique.mockResolvedValue(null);
    h.codeAnalysisFindUnique.mockResolvedValue(null);
  });

  it('renders the code graph view when a READY analysis with a graph exists', async () => {
    h.codeAnalysisFindUnique.mockResolvedValue({
      status: 'READY',
      graph: {
        nodes: [
          { id: 'a', label: 'A', community: 0 },
          { id: 'b', label: 'B', community: 1 },
          { id: 'c', label: 'C', community: 0 },
        ],
        links: [
          { source: 'a', target: 'b' },
          { source: 'a', target: 'c' },
        ],
      },
    });
    render(await Page({ params }));
    expect(screen.getByTestId('code-graph')).toBeInTheDocument();
    const subset = h.codeGraphProps?.subset as { nodes: unknown[]; total: number };
    expect(subset.total).toBe(3);
    expect(subset.nodes.length).toBe(3);
  });

  it('omits the code graph when there is no READY analysis', async () => {
    h.codeAnalysisFindUnique.mockResolvedValue({ status: 'PENDING', graph: null });
    render(await Page({ params }));
    expect(screen.queryByTestId('code-graph')).not.toBeInTheDocument();
  });

  it('calls notFound when not a member', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: false, error: 'no' });
    await expect(Page({ params })).rejects.toThrow();
    expect(h.notFound).toHaveBeenCalled();
  });

  it('renders with no summary row (configured)', async () => {
    render(await Page({ params }));
    expect(screen.getByTestId('graph-view')).toBeInTheDocument();
    expect(screen.getByTestId('analysis-panel')).toBeInTheDocument();
    expect(h.analysisProps?.canWrite).toBe(true);
    expect((h.lastProps?.initialProjectSummary as Record<string, unknown>).body).toBeNull();
    expect((h.lastProps?.initialProjectSummary as Record<string, unknown>).stale).toBe(false);
    expect(h.lastProps?.canWrite).toBe(true);
  });

  it('marks summary stale when signature differs and respects viewer role', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: true, projectId: 'p1', userId: 'u1', role: 'VIEWER' });
    h.summaryFindUnique.mockResolvedValue({
      body: 'old summary',
      model: 'm',
      updatedAt: new Date('2024-01-01'),
      signature: 'sig-stale',
    });
    render(await Page({ params }));
    const s = h.lastProps?.initialProjectSummary as Record<string, unknown>;
    expect(s.body).toBe('old summary');
    expect(s.stale).toBe(true);
    expect(h.lastProps?.canWrite).toBe(false);
    expect(h.analysisProps?.canWrite).toBe(false);
  });
});
