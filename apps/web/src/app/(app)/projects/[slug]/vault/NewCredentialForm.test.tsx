import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewCredentialForm } from './NewCredentialForm';

const { useVaultUnlock, refresh } = vi.hoisted(() => {
  const refresh = vi.fn();
  return { refresh, useVaultUnlock: vi.fn() };
});
vi.mock('@/components/vault/UnlockContext', () => ({ useVaultUnlock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { encryptAndShareCredential, getProjectMemberKeys, createCredentialAction } = vi.hoisted(
  () => ({
    encryptAndShareCredential: vi.fn(),
    getProjectMemberKeys: vi.fn(),
    createCredentialAction: vi.fn(),
  }),
);
vi.mock('@/lib/crypto', () => ({
  encryptAndShareCredential,
  fromBase64: (s: string) => new Uint8Array([s.length]),
  toBase64: () => 'b64',
}));
vi.mock('@/lib/actions/credentials', () => ({ getProjectMemberKeys, createCredentialAction }));

const vaultVal = { vault: { publicKey: new Uint8Array(), privateKey: new Uint8Array() } };

beforeEach(() => {
  vi.clearAllMocks();
  useVaultUnlock.mockReturnValue(vaultVal);
  getProjectMemberKeys.mockResolvedValue({ ok: true, data: [] });
  encryptAndShareCredential.mockReturnValue({
    ciphertext: new Uint8Array([1]),
    nonce: new Uint8Array([2]),
    access: [{ userId: 'u1', wrappedDek: new Uint8Array([3]) }],
  });
});

const members = [
  { userId: 'u1', name: 'Me', email: 'me@x.com', publicKey: 'pkme' },
  { userId: 'u2', name: 'Other', email: 'o@x.com', publicKey: 'pko' },
];

describe('NewCredentialForm', () => {
  it('renders nothing when vault is locked', () => {
    useVaultUnlock.mockReturnValue({ vault: null });
    const { container } = render(
      <NewCredentialForm projectSlug="p" currentUserId="u1" onCreated={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('loads members and shows them with self disabled', async () => {
    getProjectMemberKeys.mockResolvedValue({ ok: true, data: members });
    render(<NewCredentialForm projectSlug="p" currentUserId="u1" onCreated={vi.fn()} />);
    expect(await screen.findByText(/Me/)).toBeInTheDocument();
    const checkboxes = screen.getAllByRole('checkbox');
    // self checkbox (u1) checked + disabled
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[0]).toBeDisabled();
    expect(checkboxes[1]).not.toBeChecked();
  });

  it('shows error when loading members fails', async () => {
    getProjectMemberKeys.mockResolvedValue({ ok: false, error: 'no members' });
    render(<NewCredentialForm projectSlug="p" currentUserId="u1" onCreated={vi.fn()} />);
    expect(await screen.findByText('no members')).toBeInTheDocument();
  });

  it('submits, encrypts, creates credential, resets and calls onCreated', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    getProjectMemberKeys.mockResolvedValue({ ok: true, data: members });
    createCredentialAction.mockResolvedValue({ ok: true });
    render(<NewCredentialForm projectSlug="p" currentUserId="u1" onCreated={onCreated} />);
    await screen.findByText(/Me/);

    await user.type(screen.getByLabelText('Name'), 'My cred');
    await user.selectOptions(screen.getByLabelText('Type'), 'API_KEY');
    await user.type(screen.getByLabelText(/Username/), 'bob');
    await user.type(screen.getByLabelText(/URL/), 'http://x');
    await user.type(screen.getByLabelText(/Secret/), 'sekret');
    // share with other member too
    await user.click(screen.getAllByRole('checkbox')[1]);

    await user.click(screen.getByRole('button', { name: 'Create credential' }));

    await waitFor(() => expect(createCredentialAction).toHaveBeenCalled());
    const arg = createCredentialAction.mock.calls[0][1];
    expect(arg.name).toBe('My cred');
    expect(arg.type).toBe('API_KEY');
    expect(arg.metadataPublic).toEqual({ username: 'bob', url: 'http://x' });
    expect(encryptAndShareCredential).toHaveBeenCalledWith(
      'sekret',
      expect.arrayContaining([expect.objectContaining({ userId: 'u1' })]),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });

  it('shows error when createCredentialAction fails', async () => {
    const user = userEvent.setup();
    getProjectMemberKeys.mockResolvedValue({ ok: true, data: members });
    createCredentialAction.mockResolvedValue({ ok: false, error: 'create boom' });
    render(<NewCredentialForm projectSlug="p" currentUserId="u1" onCreated={vi.fn()} />);
    await screen.findByText(/Me/);
    await user.type(screen.getByLabelText('Name'), 'X');
    await user.type(screen.getByLabelText(/Secret/), 'y');
    await user.click(screen.getByRole('button', { name: 'Create credential' }));
    expect(await screen.findByText('create boom')).toBeInTheDocument();
  });

  it('errors when no recipients selected (self not a member)', async () => {
    const user = userEvent.setup();
    // currentUserId u9 not present in members -> recipients empty
    getProjectMemberKeys.mockResolvedValue({ ok: true, data: members });
    render(<NewCredentialForm projectSlug="p" currentUserId="u9" onCreated={vi.fn()} />);
    await screen.findByText(/Me/);
    await user.type(screen.getByLabelText('Name'), 'X');
    await user.type(screen.getByLabelText(/Secret/), 'y');
    // ensure no members are selected (initial shareWith only has u9, not in list)
    await user.click(screen.getByRole('button', { name: 'Create credential' }));
    expect(
      await screen.findByText('You must at least share with yourself'),
    ).toBeInTheDocument();
    expect(createCredentialAction).not.toHaveBeenCalled();
  });

  it('toggles a member share on and off', async () => {
    const user = userEvent.setup();
    getProjectMemberKeys.mockResolvedValue({ ok: true, data: members });
    render(<NewCredentialForm projectSlug="p" currentUserId="u1" onCreated={vi.fn()} />);
    await screen.findByText(/Me/);
    const other = screen.getAllByRole('checkbox')[1];
    await user.click(other);
    expect(other).toBeChecked();
    await user.click(other);
    expect(other).not.toBeChecked();
    // clicking self does nothing (guarded)
    const self = screen.getAllByRole('checkbox')[0];
    await user.click(self);
    expect(self).toBeChecked();
  });
});
