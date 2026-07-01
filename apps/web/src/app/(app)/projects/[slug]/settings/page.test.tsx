import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  invitationFindMany: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/auth', () => ({ auth: m.auth }));
vi.mock('@/lib/db', () => ({
  prisma: { project: { findUnique: m.findUnique }, invitation: { findMany: m.invitationFindMany } },
}));
vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: string, en: string) => en }));
vi.mock('next/navigation', () => ({ notFound: m.notFound }));
vi.mock('./MembersPanel', () => ({ MembersPanel: () => <div>members-panel</div> }));
vi.mock('./RepoSettingsPanel', () => ({ RepoSettingsPanel: () => <div>repo-panel</div> }));
vi.mock('./ProjectLifecyclePanel', () => ({ ProjectLifecyclePanel: () => <div>lifecycle-panel</div> }));

import Page from './page';

const params = (slug = 'p') => Promise.resolve({ slug });

function project(over: Record<string, unknown> = {}) {
  return {
    id: 'pr',
    name: 'Proj',
    ownerId: 'owner',
    status: 'ACTIVE',
    repoPath: null,
    repoUrl: null,
    repoDefaultBranch: 'main',
    members: [
      {
        id: 'm1',
        userId: 'u1',
        role: 'OWNER',
        seniority: null,
        joinedAt: new Date('2024-01-01'),
        user: { id: 'u1', name: 'Me', email: 'me@x.com' },
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  Object.values(m).forEach((fn) => (fn as any).mockReset?.());
  m.invitationFindMany.mockResolvedValue([]);
  m.notFound.mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND');
  });
});

describe('ProjectSettingsPage', () => {
  it('returns null without a session', async () => {
    m.auth.mockResolvedValue(null);
    expect(await Page({ params: params() })).toBeNull();
  });

  it('calls notFound when the project is missing', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue(null);
    await expect(Page({ params: params() })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('calls notFound when the user is not a member', async () => {
    m.auth.mockResolvedValue({ user: { id: 'other' } });
    m.findUnique.mockResolvedValue(project());
    await expect(Page({ params: params() })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('calls notFound when the member lacks OWNER/ADMIN role', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue(
      project({
        members: [
          {
            id: 'm1',
            userId: 'u1',
            role: 'MEMBER',
            seniority: null,
            joinedAt: new Date('2024-01-01'),
            user: { id: 'u1', name: 'Me', email: 'me@x.com' },
          },
        ],
      }),
    );
    await expect(Page({ params: params() })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders all panels for an owner', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue(project());
    render(await Page({ params: params() }));
    expect(screen.getByText('members-panel')).toBeInTheDocument();
    expect(screen.getByText('repo-panel')).toBeInTheDocument();
    expect(screen.getByText('lifecycle-panel')).toBeInTheDocument();
  });
});
