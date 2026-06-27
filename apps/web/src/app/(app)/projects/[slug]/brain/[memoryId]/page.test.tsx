import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/auth', () => ({ auth: h.auth }));
vi.mock('@/lib/db', () => ({ prisma: { brainMemory: { findUnique: h.findUnique } } }));
vi.mock('@/lib/i18n/server', () => ({
  getServerT: async () => (_es: unknown, en: unknown) => en,
}));
vi.mock('next/navigation', () => ({ notFound: h.notFound }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('remark-gfm', () => ({ default: () => {} }));
vi.mock('./MemoryActions', () => ({
  MemoryActions: () => <div data-testid="memory-actions" />,
}));

import Page from './page';

function fullMemory(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    type: 'DECISION',
    scope: 'PROJECT',
    status: 'ACTIVE',
    title: 'My Memory',
    body: 'This is a sufficiently long first sentence that becomes the deck text. More.',
    tags: ['auth', 'deploy'],
    authorId: 'u1',
    ownerUserId: 'u1',
    citationCount: 1,
    lastCitedAt: new Date('2024-01-01'),
    createdAt: new Date('2023-01-01'),
    updatedAt: new Date('2024-06-01'),
    author: { id: 'u1', name: 'Alice' },
    ownerUser: { id: 'u1', name: 'Alice' },
    sourceTask: { taskNumber: 7, title: 'Source task' },
    supersededBy: { id: 'm2', title: 'Newer' },
    supersedes: [{ id: 'm0', title: 'Older', createdAt: new Date('2022-01-01') }],
    citations: [
      {
        id: 'c1',
        context: 'used here',
        createdAt: new Date('2024-02-01'),
        citedInTask: { taskNumber: 9, title: 'Citing task' },
        citedByUser: { name: 'Bob' },
      },
    ],
    project: { slug: 'proj', members: [{ role: 'OWNER' }] },
    ...over,
  };
}

const params = (over: Record<string, string> = {}) =>
  Promise.resolve({ slug: 'proj', memoryId: 'm1', ...over });

describe('MemoryDetailPage', () => {
  beforeEach(() => {
    h.auth.mockReset();
    h.findUnique.mockReset();
    h.notFound.mockClear();
    h.auth.mockResolvedValue({ user: { id: 'u1' } });
  });

  it('returns null when not authenticated', async () => {
    h.auth.mockResolvedValue(null);
    const out = await Page({ params: params() });
    expect(out).toBeNull();
  });

  it('calls notFound when memory is missing', async () => {
    h.findUnique.mockResolvedValue(null);
    await expect(Page({ params: params() })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(h.notFound).toHaveBeenCalled();
  });

  it('calls notFound when slug mismatches', async () => {
    h.findUnique.mockResolvedValue(fullMemory({ project: { slug: 'other', members: [{ role: 'OWNER' }] } }));
    await expect(Page({ params: params() })).rejects.toThrow();
  });

  it('calls notFound when not a member', async () => {
    h.findUnique.mockResolvedValue(fullMemory({ project: { slug: 'proj', members: [] } }));
    await expect(Page({ params: params() })).rejects.toThrow();
  });

  it('calls notFound for a foreign local memory', async () => {
    h.findUnique.mockResolvedValue(
      fullMemory({
        scope: 'LOCAL',
        ownerUserId: 'someone-else',
        project: { slug: 'proj', members: [{ role: 'MEMBER' }] },
      }),
    );
    await expect(Page({ params: params() })).rejects.toThrow();
  });

  it('renders the full memory detail with actions', async () => {
    h.findUnique.mockResolvedValue(fullMemory());
    render(await Page({ params: params() }));
    expect(screen.getByRole('heading', { name: 'My Memory', level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('memory-actions')).toBeInTheDocument();
    expect(screen.getByText('Newer')).toBeInTheDocument(); // supersededBy
    expect(screen.getByText('Older')).toBeInTheDocument(); // supersedes
    expect(screen.getByText(/Citing task/)).toBeInTheDocument();
    expect(screen.getByText(/used here/)).toBeInTheDocument();
  });

  it('renders minimal memory (no deck, no citations, no source, no actions)', async () => {
    h.findUnique.mockResolvedValue(
      fullMemory({
        body: 'short',
        tags: [],
        status: 'DEPRECATED',
        sourceTask: null,
        supersededBy: null,
        supersedes: [],
        ownerUser: null,
        scope: 'LOCAL',
        lastCitedAt: null,
        citationCount: 0,
        citations: [],
        authorId: 'other',
        ownerUserId: 'u1',
        project: { slug: 'proj', members: [{ role: 'MEMBER' }] },
      }),
    );
    render(await Page({ params: params() }));
    expect(screen.getByText('No one has cited this entry yet.', { exact: false })).toBeInTheDocument();
    expect(screen.queryByTestId('memory-actions')).not.toBeInTheDocument();
    expect(screen.getByText('never cited')).toBeInTheDocument();
  });
});
