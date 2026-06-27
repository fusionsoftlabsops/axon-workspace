import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CredentialRow } from './CredentialRow';
import type { CredentialMeta } from './VaultClient';

const { useVaultUnlock, refresh } = vi.hoisted(() => {
  const refresh = vi.fn();
  return { refresh, useVaultUnlock: vi.fn() };
});
vi.mock('@/components/vault/UnlockContext', () => ({ useVaultUnlock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const crypto = vi.hoisted(() => ({
  decryptCredentialText: vi.fn(),
  encryptCredentialText: vi.fn(),
  unwrapDek: vi.fn(),
  wrapDekForRecipient: vi.fn(),
}));
vi.mock('@/lib/crypto', () => ({
  decryptCredentialText: crypto.decryptCredentialText,
  encryptCredentialText: crypto.encryptCredentialText,
  unwrapDek: crypto.unwrapDek,
  wrapDekForRecipient: crypto.wrapDekForRecipient,
  fromBase64: (s: string) => new Uint8Array([s.length]),
  toBase64: () => 'b64',
}));

const actions = vi.hoisted(() => ({
  deleteCredentialAction: vi.fn(),
  getCredentialAction: vi.fn(),
  getProjectMemberKeys: vi.fn(),
  revokeCredentialAccessAction: vi.fn(),
  rotateCredentialAction: vi.fn(),
  shareCredentialAction: vi.fn(),
}));
vi.mock('@/lib/actions/credentials', () => actions);

const unlockedVault = {
  vault: { publicKey: new Uint8Array([1]), privateKey: new Uint8Array([2]) },
};

function makeCred(over: Partial<CredentialMeta> = {}): CredentialMeta {
  return {
    id: 'c1',
    name: 'GitHub',
    type: 'API_KEY',
    metadataPublic: { username: 'octocat' },
    createdAt: '2026-01-01',
    createdById: 'u1',
    needsRotation: false,
    access: [{ userId: 'u1', name: 'Me', email: 'me@x.com' }],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useVaultUnlock.mockReturnValue(unlockedVault);
  crypto.unwrapDek.mockReturnValue(new Uint8Array([9]));
  crypto.decryptCredentialText.mockReturnValue('the-secret');
  crypto.encryptCredentialText.mockReturnValue({
    ciphertext: new Uint8Array([1]),
    nonce: new Uint8Array([2]),
    dek: new Uint8Array([3]),
  });
  crypto.wrapDekForRecipient.mockReturnValue(new Uint8Array([4]));
  actions.getCredentialAction.mockResolvedValue({
    ok: true,
    data: { wrappedDek: 'wd', ciphertext: 'ct', nonce: 'nc' },
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

function renderRow(over: Partial<CredentialMeta> = {}, props: Record<string, unknown> = {}) {
  return render(
    <ul>
      <CredentialRow
        projectSlug="p"
        credential={makeCred(over)}
        currentUserId="u1"
        isAdmin={false}
        {...props}
      />
    </ul>,
  );
}

describe('CredentialRow', () => {
  it('shows locked notice when vault is locked', () => {
    useVaultUnlock.mockReturnValue({ vault: null });
    renderRow();
    expect(screen.getByText('🔒 unlock the vault')).toBeInTheDocument();
    expect(screen.queryByText('Reveal secret')).not.toBeInTheDocument();
    expect(screen.getByText('octocat')).toBeInTheDocument();
  });

  it('reveals, copies and hides the secret', async () => {
    const user = userEvent.setup();
    // userEvent.setup() installs its own clipboard stub; spy on it after setup.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    renderRow();
    await user.click(screen.getByRole('button', { name: 'Reveal secret' }));
    expect(await screen.findByText('the-secret')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('the-secret');
    await user.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('the-secret')).not.toBeInTheDocument();
  });

  it('shows error when reveal fetch fails', async () => {
    const user = userEvent.setup();
    actions.getCredentialAction.mockResolvedValue({ ok: false, error: 'fetch fail' });
    renderRow();
    await user.click(screen.getByRole('button', { name: 'Reveal secret' }));
    expect(await screen.findByText('fetch fail')).toBeInTheDocument();
  });

  it('shows error when decrypt throws', async () => {
    const user = userEvent.setup();
    crypto.unwrapDek.mockImplementation(() => {
      throw new Error('decrypt fail');
    });
    renderRow();
    await user.click(screen.getByRole('button', { name: 'Reveal secret' }));
    expect(await screen.findByText('decrypt fail')).toBeInTheDocument();
  });

  it('opens share controls, lists members and shares with another', async () => {
    const user = userEvent.setup();
    actions.getProjectMemberKeys.mockResolvedValue({
      ok: true,
      data: [
        { userId: 'u1', name: 'Me', email: 'me@x.com', publicKey: 'pk1' },
        { userId: 'u2', name: 'Other', email: 'o@x.com', publicKey: 'pk2' },
      ],
    });
    actions.shareCredentialAction.mockResolvedValue({ ok: true });
    renderRow();
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('Share with:')).toBeInTheDocument();
    expect(screen.getByText('With access:')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ access' }));
    await waitFor(() =>
      expect(actions.shareCredentialAction).toHaveBeenCalledWith('p', 'c1', 'u2', 'b64'),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // toggle closed
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Share with:')).not.toBeInTheDocument();
  });

  it('share surfaces a fetch error', async () => {
    const user = userEvent.setup();
    actions.getProjectMemberKeys.mockResolvedValue({
      ok: true,
      data: [
        { userId: 'u1', name: 'Me', email: 'me@x.com', publicKey: 'pk1' },
        { userId: 'u2', name: 'Other', email: 'o@x.com', publicKey: 'pk2' },
      ],
    });
    actions.getCredentialAction.mockResolvedValueOnce({ ok: false, error: 'share fetch fail' });
    renderRow();
    await user.click(screen.getByRole('button', { name: 'Share' }));
    await user.click(await screen.findByRole('button', { name: '+ access' }));
    expect(await screen.findByText('share fetch fail')).toBeInTheDocument();
  });

  it('revokes access for another member when admin', async () => {
    const user = userEvent.setup();
    actions.getProjectMemberKeys.mockResolvedValue({
      ok: true,
      data: [
        { userId: 'u1', name: 'Me', email: 'me@x.com', publicKey: 'pk1' },
        { userId: 'u3', name: 'Third', email: 't@x.com', publicKey: 'pk3' },
      ],
    });
    actions.revokeCredentialAccessAction.mockResolvedValue({ ok: true });
    renderRow(
      {
        access: [
          { userId: 'u1', name: 'Me', email: 'me@x.com' },
          { userId: 'u3', name: 'Third', email: 't@x.com' },
        ],
      },
      { isAdmin: true },
    );
    await user.click(screen.getByRole('button', { name: 'Share' }));
    await screen.findByText('With access:');
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(actions.revokeCredentialAccessAction).toHaveBeenCalledWith('p', 'c1', 'u3'),
    );
  });

  it('does not revoke when confirm is cancelled', async () => {
    const user = userEvent.setup();
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);
    actions.getProjectMemberKeys.mockResolvedValue({
      ok: true,
      data: [{ userId: 'u1', name: 'Me', email: 'me@x.com', publicKey: 'pk1' }],
    });
    renderRow(
      {
        access: [
          { userId: 'u1', name: 'Me', email: 'me@x.com' },
          { userId: 'u3', name: 'Third', email: 't@x.com' },
        ],
      },
      { isAdmin: true },
    );
    await user.click(screen.getByRole('button', { name: 'Share' }));
    await screen.findByText('With access:');
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(actions.revokeCredentialAccessAction).not.toHaveBeenCalled();
  });

  it('rotates a credential needing rotation', async () => {
    const user = userEvent.setup();
    actions.getProjectMemberKeys.mockResolvedValue({
      ok: true,
      data: [{ userId: 'u1', name: 'Me', email: 'me@x.com', publicKey: 'pk1' }],
    });
    actions.rotateCredentialAction.mockResolvedValue({ ok: true });
    renderRow({ needsRotation: true });
    expect(screen.getByText(/Rotation pending/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rotate now' }));
    await waitFor(() => expect(actions.rotateCredentialAction).toHaveBeenCalled());
    const arg = actions.rotateCredentialAction.mock.calls[0][2];
    expect(arg.access).toEqual([{ userId: 'u1', wrappedDek: 'b64' }]);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('rotate surfaces member-keys error', async () => {
    const user = userEvent.setup();
    actions.getProjectMemberKeys.mockResolvedValue({ ok: false, error: 'keys fail' });
    renderRow({ needsRotation: true });
    await user.click(screen.getByRole('button', { name: 'Rotate now' }));
    expect(await screen.findByText('keys fail')).toBeInTheDocument();
    expect(actions.rotateCredentialAction).not.toHaveBeenCalled();
  });

  it('rotate aborts when confirm cancelled', async () => {
    const user = userEvent.setup();
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);
    renderRow({ needsRotation: true });
    await user.click(screen.getByRole('button', { name: 'Rotate now' }));
    expect(actions.getCredentialAction).not.toHaveBeenCalled();
  });

  it('deletes a credential when admin', async () => {
    const user = userEvent.setup();
    actions.deleteCredentialAction.mockResolvedValue({ ok: true });
    renderRow({}, { isAdmin: true });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(actions.deleteCredentialAction).toHaveBeenCalledWith('p', 'c1'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('delete shows error on failure', async () => {
    const user = userEvent.setup();
    actions.deleteCredentialAction.mockResolvedValue({ ok: false, error: 'del fail' });
    renderRow({}, { isAdmin: true });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('del fail')).toBeInTheDocument();
  });
});
