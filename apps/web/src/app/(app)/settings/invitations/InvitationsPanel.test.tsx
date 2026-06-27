import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InvitationView } from '@/lib/actions/invitations';

const h = vi.hoisted(() => ({
  create: vi.fn(),
  revoke: vi.fn(),
  refresh: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock('@/lib/actions/invitations', () => ({
  createInvitationAction: h.create,
  revokeInvitationAction: h.revoke,
}));

import { InvitationsPanel } from './InvitationsPanel';

const baseInvite = (over: Partial<InvitationView> = {}): InvitationView => ({
  id: 'i1',
  email: 'x@y.com',
  invitedByName: null,
  expiresAt: new Date().toISOString(),
  acceptedAt: null,
  expired: false,
  createdAt: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('InvitationsPanel', () => {
  it('shows the empty state with no invitations', () => {
    render(<InvitationsPanel initial={[]} />);
    expect(screen.getByText('You have not generated any invitations yet.')).toBeInTheDocument();
  });

  it('renders status labels for accepted, expired and pending invites', () => {
    render(
      <InvitationsPanel
        initial={[
          baseInvite({ id: 'a', email: 'a@a.com', acceptedAt: new Date().toISOString() }),
          baseInvite({ id: 'b', email: 'b@b.com', expired: true }),
          baseInvite({ id: 'c', email: 'c@c.com' }),
        ]}
      />,
    );
    expect(screen.getByText(/Accepted/)).toBeInTheDocument();
    expect(screen.getByText(/Expired/)).toBeInTheDocument();
    expect(screen.getByText(/Pending/)).toBeInTheDocument();
    // Revoke button only for the two non-accepted invites.
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(2);
  });

  it('creates an invitation and shows the link (email sent)', async () => {
    h.create.mockResolvedValue({ ok: true, data: { email: 'new@x.com', token: 'TKN', emailSent: true } });
    const user = userEvent.setup();
    render(<InvitationsPanel initial={[]} />);
    await user.type(screen.getByPlaceholderText('persona@empresa.com'), 'new@x.com');
    await user.click(screen.getByRole('button', { name: 'Generate invitation' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ email: 'new@x.com' }));
    expect(await screen.findByText(/Invitation sent by email/)).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/signup?token=TKN`)).toBeInTheDocument();
    expect(h.refresh).toHaveBeenCalled();
    const clip = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(clip).toHaveBeenCalledWith(`${window.location.origin}/signup?token=TKN`);
  });

  it('shows the not-sent message when email delivery failed', async () => {
    h.create.mockResolvedValue({ ok: true, data: { email: 'new@x.com', token: 'T2', emailSent: false } });
    const user = userEvent.setup();
    render(<InvitationsPanel initial={[]} />);
    await user.type(screen.getByPlaceholderText('persona@empresa.com'), 'new@x.com');
    await user.click(screen.getByRole('button', { name: 'Generate invitation' }));
    expect(await screen.findByText(/Could not send the email/)).toBeInTheDocument();
  });

  it('surfaces a create error', async () => {
    h.create.mockResolvedValue({ ok: false, error: 'dup' });
    const user = userEvent.setup();
    render(<InvitationsPanel initial={[]} />);
    await user.type(screen.getByPlaceholderText('persona@empresa.com'), 'new@x.com');
    await user.click(screen.getByRole('button', { name: 'Generate invitation' }));
    expect(await screen.findByText('dup')).toBeInTheDocument();
  });

  it('revokes a pending invitation after confirmation', async () => {
    h.revoke.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<InvitationsPanel initial={[baseInvite()]} />);
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(h.revoke).toHaveBeenCalledWith('i1'));
    expect(h.refresh).toHaveBeenCalled();
  });

  it('does nothing when the revoke confirmation is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<InvitationsPanel initial={[baseInvite()]} />);
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(h.revoke).not.toHaveBeenCalled();
  });

  it('shows the error returned by a failed revoke', async () => {
    h.revoke.mockResolvedValue({ ok: false, error: 'revoke-fail' });
    const user = userEvent.setup();
    render(<InvitationsPanel initial={[baseInvite()]} />);
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('revoke-fail')).toBeInTheDocument();
  });
});
