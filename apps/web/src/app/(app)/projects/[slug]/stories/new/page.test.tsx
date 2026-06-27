import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import NewStoryPage from './page';

const { auth, findProject, findCreds, notFound, redirect, repoReaderFor, listProviders } =
  vi.hoisted(() => ({
    auth: vi.fn(),
    findProject: vi.fn(),
    findCreds: vi.fn(),
    notFound: vi.fn(() => {
      throw new Error('NOT_FOUND');
    }),
    redirect: vi.fn(() => {
      throw new Error('REDIRECT');
    }),
    repoReaderFor: vi.fn(),
    listProviders: vi.fn(() => [{ name: 'ANTHROPIC' }]),
  }));

vi.mock('next/navigation', () => ({ notFound, redirect }));
vi.mock('@/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: findProject },
    llmCredential: { findMany: findCreds },
  },
}));
vi.mock('@/lib/repo/reader', () => ({ repoReaderFor }));
vi.mock('@/lib/ai/providers/registry', () => ({ listProviders }));
vi.mock('@/lib/i18n/server', () => ({
  getServerT: async () => (_es: unknown, en: unknown) => en,
}));
vi.mock('@/components/ui', () => ({
  PageHeader: ({ title }: { title: unknown }) => <h1>{title as string}</h1>,
  Eyebrow: ({ children }: { children: unknown }) => <span>{children as string}</span>,
}));
vi.mock('./Composer', () => ({
  Composer: (props: { hasRepo: boolean; repoTree: unknown[]; providers: unknown[] }) => (
    <div data-testid="composer">
      hasRepo:{String(props.hasRepo)} tree:{props.repoTree.length} providers:
      {props.providers.length}
    </div>
  ),
}));

const params = (slug = 'p') => Promise.resolve({ slug });

beforeEach(() => vi.clearAllMocks());

describe('NewStoryPage', () => {
  it('returns null when unauthenticated', async () => {
    auth.mockResolvedValue(null);
    expect(await NewStoryPage({ params: params() })).toBeNull();
  });

  it('notFound when project missing or not a member', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    findProject.mockResolvedValue(null);
    await expect(NewStoryPage({ params: params() })).rejects.toThrow('NOT_FOUND');

    findProject.mockResolvedValue({ id: 'pj', name: 'P', repoPath: null, members: [] });
    await expect(NewStoryPage({ params: params() })).rejects.toThrow('NOT_FOUND');
  });

  it('redirects VIEWER to stories list', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    findProject.mockResolvedValue({
      id: 'pj',
      name: 'P',
      repoPath: null,
      members: [{ role: 'VIEWER' }],
    });
    await expect(NewStoryPage({ params: params() })).rejects.toThrow('REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/projects/p/stories');
  });

  it('renders Composer without repo', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    findProject.mockResolvedValue({
      id: 'pj',
      name: 'P',
      repoPath: null,
      members: [{ role: 'EDITOR' }],
    });
    findCreds.mockResolvedValue([{ id: 'c1', provider: 'ANTHROPIC', label: 'l', modelDefault: null, keyPrefix: 'k' }]);
    render(await NewStoryPage({ params: params() }));
    const composer = screen.getByTestId('composer');
    expect(composer).toHaveTextContent('hasRepo:false');
    expect(composer).toHaveTextContent('tree:0');
    expect(composer).toHaveTextContent('providers:1');
    expect(repoReaderFor).not.toHaveBeenCalled();
  });

  it('reads repo tree when repoPath set and reader available', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    findProject.mockResolvedValue({
      id: 'pj',
      name: 'P',
      repoPath: '/repo',
      members: [{ role: 'OWNER' }],
    });
    findCreds.mockResolvedValue([]);
    repoReaderFor.mockResolvedValue({
      tree: vi.fn().mockResolvedValue([{ name: 'src', path: 'src', kind: 'dir' }]),
    });
    render(await NewStoryPage({ params: params() }));
    expect(screen.getByTestId('composer')).toHaveTextContent('hasRepo:true');
    expect(screen.getByTestId('composer')).toHaveTextContent('tree:1');
    expect(repoReaderFor).toHaveBeenCalledWith({ repoPath: '/repo' });
  });

  it('handles repoPath set but reader unavailable', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    findProject.mockResolvedValue({
      id: 'pj',
      name: 'P',
      repoPath: '/repo',
      members: [{ role: 'OWNER' }],
    });
    findCreds.mockResolvedValue([]);
    repoReaderFor.mockResolvedValue(null);
    render(await NewStoryPage({ params: params() }));
    expect(screen.getByTestId('composer')).toHaveTextContent('tree:0');
  });
});
