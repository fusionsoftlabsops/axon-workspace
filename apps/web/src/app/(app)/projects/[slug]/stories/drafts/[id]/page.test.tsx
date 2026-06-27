import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DraftPage from './page';

const { auth, findProject, findDraft, notFound } = vi.hoisted(() => ({
  auth: vi.fn(),
  findProject: vi.fn(),
  findDraft: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));

vi.mock('next/navigation', () => ({ notFound }));
vi.mock('@/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: findProject },
    storyDraft: { findUnique: findDraft },
  },
}));
vi.mock('@/lib/i18n/server', () => ({
  getServerT: async () => (_es: unknown, en: unknown) => en,
  getServerLang: async () => 'en',
}));
vi.mock('@/components/ui', () => ({
  PageHeader: ({ title, eyebrow }: { title: unknown; eyebrow: unknown }) => (
    <div>
      <div data-testid="eyebrow">{eyebrow}</div>
      <h1>{title as string}</h1>
    </div>
  ),
  Eyebrow: ({ children }: { children: unknown }) => <span>{children as string}</span>,
}));
vi.mock('./DraftView', () => ({
  DraftView: (props: { canPublish: boolean; states: unknown[] }) => (
    <div data-testid="draftview">
      canPublish:{String(props.canPublish)} states:{props.states.length}
    </div>
  ),
}));

const params = (slug = 'p', id = 'd1') => Promise.resolve({ slug, id });

beforeEach(() => vi.clearAllMocks());

describe('DraftPage', () => {
  it('returns null when unauthenticated', async () => {
    auth.mockResolvedValue(null);
    const out = await DraftPage({ params: params() });
    expect(out).toBeNull();
  });

  it('calls notFound when project missing', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    findProject.mockResolvedValue(null);
    await expect(DraftPage({ params: params() })).rejects.toThrow('NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('calls notFound when user not a member', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    findProject.mockResolvedValue({ id: 'pj', members: [], workflows: [] });
    await expect(DraftPage({ params: params() })).rejects.toThrow('NOT_FOUND');
  });

  it('calls notFound when draft missing or not owned', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    findProject.mockResolvedValue({
      id: 'pj',
      members: [{ role: 'OWNER' }],
      workflows: [{ states: [] }],
    });
    findDraft.mockResolvedValue(null);
    await expect(DraftPage({ params: params() })).rejects.toThrow('NOT_FOUND');

    findDraft.mockResolvedValue({ projectId: 'OTHER', authorId: 'u1' });
    await expect(DraftPage({ params: params() })).rejects.toThrow('NOT_FOUND');
  });

  it('renders header + DraftView for a valid owned draft', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    findProject.mockResolvedValue({
      id: 'pj',
      members: [{ role: 'OWNER' }],
      workflows: [{ states: [{ id: 's1', name: 'Todo', color: '#fff' }] }],
    });
    findDraft.mockResolvedValue({
      id: 'd1',
      projectId: 'pj',
      authorId: 'u1',
      status: 'READY',
      errorMessage: null,
      provider: 'ANTHROPIC',
      model: 'opus',
      rawInput: 'r',
      summary: 'My summary line\nsecond',
      acceptanceCriteria: 'ac',
      technicalContext: 'tc',
      subtaskBreakdown: null,
      filesToTouch: null,
      risks: null,
      inputTokens: 1,
      outputTokens: 2,
      estimatedCostUsd: { toString: () => '0.10' },
      durationMs: 10,
      taskId: null,
      citedMemoryIds: [],
      createdAt: new Date('2026-01-02T00:00:00Z'),
    });
    render(await DraftPage({ params: params() }));
    expect(screen.getByRole('heading', { name: 'My summary line' })).toBeInTheDocument();
    expect(screen.getByTestId('draftview')).toHaveTextContent('canPublish:true');
    expect(screen.getByTestId('draftview')).toHaveTextContent('states:1');
    expect(screen.getByText(/Draft/)).toBeInTheDocument();
  });

  it('uses fallback title and VIEWER cannot publish; es locale', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    findProject.mockResolvedValue({
      id: 'pj',
      members: [{ role: 'VIEWER' }],
      workflows: [],
    });
    findDraft.mockResolvedValue({
      id: 'd1',
      projectId: 'pj',
      authorId: 'u1',
      status: 'GENERATING',
      errorMessage: null,
      provider: 'ANTHROPIC',
      model: 'opus',
      rawInput: 'r',
      summary: null,
      acceptanceCriteria: null,
      technicalContext: null,
      subtaskBreakdown: null,
      filesToTouch: null,
      risks: null,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: { toString: () => '0' },
      durationMs: 0,
      taskId: null,
      citedMemoryIds: [],
      createdAt: new Date('2026-01-02T00:00:00Z'),
    });
    render(await DraftPage({ params: params() }));
    expect(screen.getByRole('heading', { name: 'Story in progress' })).toBeInTheDocument();
    expect(screen.getByTestId('draftview')).toHaveTextContent('canPublish:false');
    expect(screen.getByTestId('draftview')).toHaveTextContent('states:0');
  });
});
