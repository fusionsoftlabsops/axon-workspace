import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }));
const h = vi.hoisted(() => ({
  inviteMemberAction: vi.fn(),
  removeMemberAction: vi.fn(),
  updateMemberRoleAction: vi.fn(),
  setMemberSeniorityAction: vi.fn(),
  resendInvitationAction: vi.fn(),
  transferOwnershipAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/actions/projects', () => ({
  inviteMemberAction: h.inviteMemberAction,
  removeMemberAction: h.removeMemberAction,
  updateMemberRoleAction: h.updateMemberRoleAction,
  setMemberSeniorityAction: h.setMemberSeniorityAction,
  resendInvitationAction: h.resendInvitationAction,
  transferOwnershipAction: h.transferOwnershipAction,
}));

import { MembersPanel } from './MembersPanel';

function member(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    userId: 'u1',
    role: 'MEMBER',
    seniority: null,
    name: 'Ann',
    email: 'ann@x.com',
    joinedAt: '2024-01-01',
    ...over,
  };
}

function props(over: Record<string, unknown> = {}) {
  return {
    projectSlug: 'p',
    currentUserId: 'me',
    ownerId: 'owner',
    members: [
      member({ id: 'mo', userId: 'owner', name: 'Owner', role: 'OWNER' }),
      member({ id: 'mm', userId: 'me', name: 'Me', role: 'ADMIN' }),
      member({ id: 'm1', userId: 'u1', name: 'Ann', role: 'MEMBER', seniority: 'JUNIOR' }),
    ],
    ...over,
  } as never;
}

beforeEach(() => {
  router.refresh.mockReset();
  Object.values(h).forEach((fn) => fn.mockReset());
});

describe('MembersPanel', () => {
  it('renders members, owner badge and remove buttons only for others', () => {
    render(<MembersPanel {...props()} />);
    expect(screen.getByText('OWNER')).toBeInTheDocument();
    // owner + self have no Remove button; only Ann does
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
  });

  it('invites a member who already has an account', async () => {
    const user = userEvent.setup();
    h.inviteMemberAction.mockResolvedValue({ ok: true, data: { pending: false } });
    render(<MembersPanel {...props()} />);
    await user.type(screen.getByPlaceholderText(/email@domain/i), 'new@x.com');
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'VIEWER');
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    expect(h.inviteMemberAction).toHaveBeenCalledWith('p', { email: 'new@x.com', role: 'VIEWER' });
    expect(router.refresh).toHaveBeenCalled();
  });

  it('shows the invite link for a pending invitation and copies it', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    h.inviteMemberAction.mockResolvedValue({
      ok: true,
      data: { pending: true, token: 'tok', email: 'new@x.com', emailSent: false },
    });
    render(<MembersPanel {...props()} />);
    await user.type(screen.getByPlaceholderText(/email@domain/i), 'new@x.com');
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    expect(await screen.findByText(/Share this link/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalled();
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });

  it('shows the emailed-link note when the invite email was sent', async () => {
    const user = userEvent.setup();
    h.inviteMemberAction.mockResolvedValue({
      ok: true,
      data: { pending: true, token: 'tok', email: 'new@x.com', emailSent: true },
    });
    render(<MembersPanel {...props()} />);
    await user.type(screen.getByPlaceholderText(/email@domain/i), 'new@x.com');
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    expect(await screen.findByText(/We emailed them the link/i)).toBeInTheDocument();
  });

  it('shows an error when inviting fails', async () => {
    const user = userEvent.setup();
    h.inviteMemberAction.mockResolvedValue({ ok: false, error: 'bad email' });
    render(<MembersPanel {...props()} />);
    await user.type(screen.getByPlaceholderText(/email@domain/i), 'new@x.com');
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    expect(await screen.findByText('bad email')).toBeInTheDocument();
  });

  it('changes a member role and refreshes', async () => {
    const user = userEvent.setup();
    h.updateMemberRoleAction.mockResolvedValue({ ok: true });
    render(<MembersPanel {...props()} />);
    // Ann's role select is the one with value MEMBER among row selects
    const annRow = screen.getByText('Ann').closest('tr')!;
    const roleSelect = annRow.querySelectorAll('select')[0] as HTMLSelectElement;
    await user.selectOptions(roleSelect, 'ADMIN');
    expect(h.updateMemberRoleAction).toHaveBeenCalledWith('p', 'u1', 'ADMIN');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('shows an error when changing a role fails', async () => {
    const user = userEvent.setup();
    h.updateMemberRoleAction.mockResolvedValue({ ok: false, error: 'role err' });
    render(<MembersPanel {...props()} />);
    const annRow = screen.getByText('Ann').closest('tr')!;
    await user.selectOptions(annRow.querySelectorAll('select')[0] as HTMLSelectElement, 'ADMIN');
    expect(await screen.findByText('role err')).toBeInTheDocument();
  });

  it('changes a member seniority', async () => {
    const user = userEvent.setup();
    h.setMemberSeniorityAction.mockResolvedValue({ ok: true });
    render(<MembersPanel {...props()} />);
    const annRow = screen.getByText('Ann').closest('tr')!;
    const senSelect = annRow.querySelectorAll('select')[1] as HTMLSelectElement;
    await user.selectOptions(senSelect, 'SENIOR');
    expect(h.setMemberSeniorityAction).toHaveBeenCalledWith('p', 'u1', 'SENIOR');
  });

  it('clears seniority (empty value -> null) and shows error on failure', async () => {
    const user = userEvent.setup();
    h.setMemberSeniorityAction.mockResolvedValue({ ok: false, error: 'sen err' });
    render(<MembersPanel {...props()} />);
    const annRow = screen.getByText('Ann').closest('tr')!;
    const senSelect = annRow.querySelectorAll('select')[1] as HTMLSelectElement;
    await user.selectOptions(senSelect, '');
    expect(h.setMemberSeniorityAction).toHaveBeenCalledWith('p', 'u1', null);
    expect(await screen.findByText('sen err')).toBeInTheDocument();
  });

  it('removes a member after confirmation', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    h.removeMemberAction.mockResolvedValue({ ok: true });
    render(<MembersPanel {...props()} />);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(h.removeMemberAction).toHaveBeenCalledWith('p', 'u1');
  });

  it('does not remove a member when confirmation is declined', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<MembersPanel {...props()} />);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(h.removeMemberAction).not.toHaveBeenCalled();
  });

  it('surfaces an error when removing a member fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    h.removeMemberAction.mockResolvedValue({ ok: false, error: 'rm err' });
    render(<MembersPanel {...props()} />);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('rm err')).toBeInTheDocument();
  });

  it('invites with an explicit seniority', async () => {
    const user = userEvent.setup();
    h.inviteMemberAction.mockResolvedValue({ ok: true, data: { pending: false, email: 'new@x.com', emailSent: true } });
    render(<MembersPanel {...props()} />);
    await user.type(screen.getByPlaceholderText(/email@domain/i), 'new@x.com');
    // form-level selects: [0] role, [1] seniority
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'SENIOR');
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    expect(h.inviteMemberAction).toHaveBeenCalledWith('p', expect.objectContaining({ email: 'new@x.com', seniority: 'SENIOR' }));
    expect(await screen.findByText(/notified by email/i)).toBeInTheDocument();
  });

  it('lists and resends a pending invitation', async () => {
    const user = userEvent.setup();
    h.resendInvitationAction.mockResolvedValue({ ok: true, data: { emailSent: true, token: 'tok', email: 'p@x.com' } });
    render(
      <MembersPanel
        {...props({
          pendingInvites: [{ id: 'inv1', email: 'p@x.com', role: 'MEMBER', seniority: 'JUNIOR', expiresAt: '2030-01-01' }],
        })}
      />,
    );
    expect(screen.getByText('p@x.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resend' }));
    expect(h.resendInvitationAction).toHaveBeenCalledWith('p', 'inv1');
    expect(await screen.findByText(/resent by email/i)).toBeInTheDocument();
  });

  it('lets the owner transfer ownership and hides it for non-owners', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    h.transferOwnershipAction.mockResolvedValue({ ok: true });
    // Owner viewing: currentUserId === ownerId
    const ownerProps = props({ currentUserId: 'owner' });
    const { unmount } = render(<MembersPanel {...ownerProps} />);
    expect(screen.getByText(/Transfer ownership/i)).toBeInTheDocument();
    const selects = screen.getAllByRole('combobox');
    const transferSelect = selects[selects.length - 1];
    await user.selectOptions(transferSelect, 'u1');
    await user.click(screen.getByRole('button', { name: 'Transfer' }));
    expect(h.transferOwnershipAction).toHaveBeenCalledWith('p', 'u1');
    unmount();

    render(<MembersPanel {...props({ currentUserId: 'me' })} />);
    expect(screen.queryByText(/Transfer ownership/i)).toBeNull();
  });
});
