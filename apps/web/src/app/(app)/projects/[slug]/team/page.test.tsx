import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  listTeamChatAction: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/auth', () => ({ auth: m.auth }));
vi.mock('@/lib/db', () => ({ prisma: { project: { findUnique: m.findUnique } } }));
vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: string, en: string) => en }));
vi.mock('next/navigation', () => ({ notFound: m.notFound }));
vi.mock('@/lib/actions/team-chat', () => ({ listTeamChatAction: m.listTeamChatAction }));
vi.mock('./TeamChatClient', () => ({
  TeamChatClient: ({ canWrite }: { canWrite: boolean }) => <div>teamchat:{canWrite ? 'rw' : 'ro'}</div>,
}));

import Page from './page';

const params = (slug = 'p') => Promise.resolve({ slug });

beforeEach(() => {
  Object.values(m).forEach((fn) => (fn as any).mockReset?.());
  m.notFound.mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND');
  });
});

describe('TeamPage', () => {
  it('returns null when there is no session', async () => {
    m.auth.mockResolvedValue(null);
    const ui = await Page({ params: params() });
    expect(ui).toBeNull();
  });

  it('calls notFound when the project is missing', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue(null);
    await expect(Page({ params: params() })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(m.notFound).toHaveBeenCalled();
  });

  it('calls notFound when the user is not a member', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({ members: [] });
    await expect(Page({ params: params() })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders TeamChatClient with write access for a non-viewer', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({ members: [{ role: 'ADMIN' }] });
    m.listTeamChatAction.mockResolvedValue({ ok: true, data: [] });
    render(await Page({ params: params() }));
    expect(screen.getByText('teamchat:rw')).toBeInTheDocument();
  });

  it('renders TeamChatClient read-only for a viewer', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({ members: [{ role: 'VIEWER' }] });
    m.listTeamChatAction.mockResolvedValue({ ok: true, data: [] });
    render(await Page({ params: params() }));
    expect(screen.getByText('teamchat:ro')).toBeInTheDocument();
  });

  it('falls back to an empty thread when the action fails', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({ members: [{ role: 'ADMIN' }] });
    m.listTeamChatAction.mockResolvedValue({ ok: false, error: 'boom' });
    const ui = render(await Page({ params: params() }));
    expect(ui.container.textContent).toContain('teamchat:rw');
  });
});
