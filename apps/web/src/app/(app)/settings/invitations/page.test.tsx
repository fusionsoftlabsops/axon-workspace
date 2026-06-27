import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  list: vi.fn(),
  redirect: vi.fn((p: string) => {
    throw new Error(`REDIRECT:${p}`);
  }),
}));

vi.mock('@/auth', () => ({ auth: h.auth }));
vi.mock('next/navigation', () => ({ redirect: h.redirect }));
vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: string, en: string) => en }));
vi.mock('@/lib/actions/invitations', () => ({ listInvitationsAction: h.list }));
vi.mock('./InvitationsPanel', () => ({
  InvitationsPanel: ({ initial }: { initial: unknown[] }) => (
    <div data-testid="panel">{initial.length}</div>
  ),
}));

import InvitationsPage from './page';

beforeEach(() => vi.clearAllMocks());

describe('InvitationsPage', () => {
  it('redirects unauthenticated users to /login', async () => {
    h.auth.mockResolvedValue(null);
    await expect(InvitationsPage()).rejects.toThrow('REDIRECT:/login');
    expect(h.redirect).toHaveBeenCalledWith('/login');
  });

  it('redirects non-master users to /projects', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', isMasterUser: false } });
    await expect(InvitationsPage()).rejects.toThrow('REDIRECT:/projects');
  });

  it('renders the panel with fetched invitations for the master user', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', isMasterUser: true } });
    h.list.mockResolvedValue({ ok: true, data: [{ id: 'a' }, { id: 'b' }] });
    render(await InvitationsPage());
    expect(screen.getByTestId('panel')).toHaveTextContent('2');
  });

  it('falls back to an empty list when the action fails', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', isMasterUser: true } });
    h.list.mockResolvedValue({ ok: false, error: 'x' });
    render(await InvitationsPage());
    expect(screen.getByTestId('panel')).toHaveTextContent('0');
  });
});
