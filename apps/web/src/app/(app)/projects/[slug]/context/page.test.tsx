import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  assertProjectMember: vi.fn(),
  buildProjectGraph: vi.fn(),
  graphSignature: vi.fn(() => 'sig-current'),
  isInfraLlmConfigured: vi.fn(() => true),
  summaryFindUnique: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  lastProps: null as Record<string, unknown> | null,
}));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: h.assertProjectMember }));
vi.mock('@/lib/graph/build', () => ({
  buildProjectGraph: h.buildProjectGraph,
  graphSignature: h.graphSignature,
}));
vi.mock('@/lib/ai/infra-llm', () => ({ isInfraLlmConfigured: h.isInfraLlmConfigured }));
vi.mock('@/lib/db', () => ({ prisma: { contextSummary: { findUnique: h.summaryFindUnique } } }));
vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: unknown, en: unknown) => en }));
vi.mock('next/navigation', () => ({ notFound: h.notFound }));
vi.mock('./ContextGraphView', () => ({
  ContextGraphView: (props: Record<string, unknown>) => {
    h.lastProps = props;
    return <div data-testid="graph-view" />;
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
    h.assertProjectMember.mockResolvedValue({ ok: true, projectId: 'p1', userId: 'u1', role: 'OWNER' });
    h.buildProjectGraph.mockResolvedValue({ nodes: [], edges: [] });
    h.summaryFindUnique.mockResolvedValue(null);
  });

  it('calls notFound when not a member', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: false, error: 'no' });
    await expect(Page({ params })).rejects.toThrow();
    expect(h.notFound).toHaveBeenCalled();
  });

  it('renders with no summary row (configured)', async () => {
    render(await Page({ params }));
    expect(screen.getByTestId('graph-view')).toBeInTheDocument();
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
  });
});
