import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import StoriesIndex from './page';

const { auth, findProject, draftFindMany, draftCount, credCount, notFound } = vi.hoisted(() => ({
  auth: vi.fn(),
  findProject: vi.fn(),
  draftFindMany: vi.fn(),
  draftCount: vi.fn(),
  credCount: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));

vi.mock('next/navigation', () => ({ notFound }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) => (
    <a href={href}>{children as string}</a>
  ),
}));
vi.mock('@/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: findProject },
    storyDraft: { findMany: draftFindMany, count: draftCount },
    llmCredential: { count: credCount },
  },
}));
vi.mock('@/lib/i18n/server', () => ({
  getServerT: async () => (_es: unknown, en: unknown) => en,
  getServerLang: async () => 'en',
}));
vi.mock('@/components/ui', () => ({
  PageHeader: ({ title }: { title: unknown }) => <h1>{title as string}</h1>,
  Eyebrow: ({ children }: { children: unknown }) => <span>{children as string}</span>,
  Tag: ({ children }: { children: unknown }) => <span>{children as string}</span>,
  Stat: ({ label, value }: { label: string; value: unknown }) => (
    <div>
      {label}:{String(value)}
    </div>
  ),
}));

const params = (slug = 'p') => Promise.resolve({ slug });

beforeEach(() => vi.clearAllMocks());

describe('StoriesIndex', () => {
  it('returns null when unauthenticated', async () => {
    auth.mockResolvedValue(null);
    expect(await StoriesIndex({ params: params() })).toBeNull();
  });

  it('notFound when project missing or not a member', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    findProject.mockResolvedValue(null);
    await expect(StoriesIndex({ params: params() })).rejects.toThrow('NOT_FOUND');

    findProject.mockResolvedValue({ id: 'pj', name: 'P', repoPath: null, members: [] });
    await expect(StoriesIndex({ params: params() })).rejects.toThrow('NOT_FOUND');
  });

  it('renders empty state + setup pending when no creds and no repo', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    findProject.mockResolvedValue({
      id: 'pj',
      name: 'P',
      repoPath: null,
      members: [{ role: 'OWNER' }],
    });
    draftFindMany.mockResolvedValue([]);
    credCount.mockResolvedValue(0);
    draftCount.mockResolvedValue(0);
    render(await StoriesIndex({ params: params() }));
    expect(screen.getByText('Setup pending')).toBeInTheDocument();
    expect(screen.getByText(/Configure at least one LLM credential/)).toBeInTheDocument();
    expect(screen.getByText(/Configure the repository path/)).toBeInTheDocument();
    expect(screen.getByText(/No drafts yet/)).toBeInTheDocument();
    expect(screen.getByText('Repo:—')).toBeInTheDocument();
  });

  it('renders drafts list with all status tones and meta', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    findProject.mockResolvedValue({
      id: 'pj',
      name: 'P',
      repoPath: '/repo',
      members: [{ role: 'OWNER' }],
    });
    const mkDraft = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
      id,
      provider: 'ANTHROPIC',
      model: 'opus',
      status,
      summary: status === 'READY' ? 'A summary' : null,
      rawInput: 'raw input fallback',
      taskId: status === 'PUBLISHED' ? 't1' : null,
      estimatedCostUsd: { toString: () => '0.10' },
      createdAt: new Date('2026-01-02T00:00:00Z'),
      ...extra,
    });
    draftFindMany.mockResolvedValue([
      mkDraft('d1', 'GENERATING'),
      mkDraft('d2', 'READY'),
      mkDraft('d3', 'PUBLISHED'),
      mkDraft('d4', 'ERRORED'),
      mkDraft('d5', 'UNKNOWN'),
    ]);
    credCount.mockResolvedValue(2);
    draftCount.mockResolvedValueOnce(5).mockResolvedValueOnce(1);
    render(await StoriesIndex({ params: params() }));
    expect(screen.getByText('A summary')).toBeInTheDocument();
    // every non-READY draft (GENERATING/PUBLISHED/ERRORED/UNKNOWN) has null summary -> rawInput
    expect(screen.getAllByText('raw input fallback')).toHaveLength(4);
    expect(screen.getByText('→ Published as task')).toBeInTheDocument();
    expect(screen.getByText('GENERATING')).toBeInTheDocument();
    expect(screen.getByText('UNKNOWN')).toBeInTheDocument();
    expect(screen.getByText('Repo:✓')).toBeInTheDocument();
    // no setup-pending aside when creds + repo present
    expect(screen.queryByText('Setup pending')).not.toBeInTheDocument();
  });
});
