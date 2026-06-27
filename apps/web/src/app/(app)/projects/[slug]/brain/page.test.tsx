import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  searchBrain: vi.fn(),
  projectFindUnique: vi.fn(),
  memCount: vi.fn(),
  memFindMany: vi.fn(),
  memberFindMany: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  lastProps: null as Record<string, unknown> | null,
}));
vi.mock('@/auth', () => ({ auth: h.auth }));
vi.mock('@/lib/brain', () => ({ searchBrain: h.searchBrain }));
vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: h.projectFindUnique },
    brainMemory: { count: h.memCount, findMany: h.memFindMany },
    projectMember: { findMany: h.memberFindMany },
  },
}));
vi.mock('next/navigation', () => ({ notFound: h.notFound }));
vi.mock('./BrainClient', () => ({
  BrainClient: (props: Record<string, unknown>) => {
    h.lastProps = props;
    return <div data-testid="brain-client" />;
  },
}));

import Page from './page';

const params = Promise.resolve({ slug: 'proj' });
const sp = (o: Record<string, string> = {}) => Promise.resolve(o);

describe('BrainPage', () => {
  beforeEach(() => {
    h.auth.mockReset();
    h.searchBrain.mockReset();
    h.projectFindUnique.mockReset();
    h.memCount.mockReset();
    h.memFindMany.mockReset();
    h.memberFindMany.mockReset();
    h.notFound.mockClear();
    h.lastProps = null;

    h.auth.mockResolvedValue({ user: { id: 'u1' } });
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'OWNER' }] });
    h.memCount.mockResolvedValue(0);
    h.memFindMany.mockResolvedValue([]);
    h.searchBrain.mockResolvedValue([]);
  });

  it('returns null when unauthenticated', async () => {
    h.auth.mockResolvedValue(null);
    expect(await Page({ params, searchParams: sp() })).toBeNull();
  });

  it('calls notFound when project missing', async () => {
    h.projectFindUnique.mockResolvedValue(null);
    await expect(Page({ params, searchParams: sp() })).rejects.toThrow();
    expect(h.notFound).toHaveBeenCalled();
  });

  it('calls notFound when not a member', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [] });
    await expect(Page({ params, searchParams: sp() })).rejects.toThrow();
  });

  it('renders the project tab and maps memories', async () => {
    h.searchBrain.mockResolvedValue([
      {
        id: 'm1',
        scope: 'PROJECT',
        type: 'DECISION',
        title: 'T',
        body: 'B',
        tags: ['a'],
        status: 'ACTIVE',
        authorName: 'Alice',
        ownerUserId: 'u1',
        sourceTaskNumber: 3,
        citationCount: 2,
        lastCitedAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-02-01'),
      },
      {
        id: 'm2',
        scope: 'LOCAL',
        type: 'NOTE',
        title: 'T2',
        body: 'B2',
        tags: [],
        status: 'ACTIVE',
        authorName: 'Bob',
        ownerUserId: null,
        sourceTaskNumber: null,
        citationCount: 0,
        lastCitedAt: null,
        updatedAt: new Date('2024-02-01'),
      },
    ]);
    render(await Page({ params, searchParams: sp({ type: 'DECISION', tag: 'a', stale: '1', orphans: '1', q: ' hi ' }) }));
    expect(screen.getByTestId('brain-client')).toBeInTheDocument();
    expect(h.lastProps?.activeTab).toBe('project');
    expect(h.lastProps?.typeFilter).toBe('DECISION');
    expect((h.lastProps?.memories as unknown[]).length).toBe(2);
    expect(h.searchBrain).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'hi', filters: expect.objectContaining({ staleOnly: true, orphansOnly: true }) }),
    );
  });

  it('falls back to project tab when a non-owner requests audit', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'MEMBER' }] });
    render(await Page({ params, searchParams: sp({ tab: 'audit' }) }));
    expect(h.lastProps?.activeTab).toBe('project');
    expect(h.lastProps?.isOwner).toBe(false);
  });

  it('renders the local tab', async () => {
    render(await Page({ params, searchParams: sp({ tab: 'local' }) }));
    expect(h.lastProps?.activeTab).toBe('local');
  });

  it('builds the audit summary for owners', async () => {
    h.memberFindMany.mockResolvedValue([
      { role: 'OWNER', user: { id: 'u1', name: 'Alice', email: 'a@x.com' } },
      { role: 'MEMBER', user: { id: 'u2', name: 'Bob', email: 'b@x.com' } },
    ]);
    h.memCount.mockResolvedValue(1);
    render(await Page({ params, searchParams: sp({ tab: 'audit' }) }));
    expect(h.lastProps?.activeTab).toBe('audit');
    expect((h.lastProps?.auditByAuthor as unknown[]).length).toBe(2);
    expect(h.memberFindMany).toHaveBeenCalled();
  });
});
