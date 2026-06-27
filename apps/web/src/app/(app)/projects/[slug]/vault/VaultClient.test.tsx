import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VaultClient, type CredentialMeta } from './VaultClient';

const { useVaultUnlock, lock } = vi.hoisted(() => {
  const lock = vi.fn();
  return {
    lock,
    useVaultUnlock: vi.fn(() => ({ vault: null, lock })),
  };
});
vi.mock('@/components/vault/UnlockContext', () => ({ useVaultUnlock }));
vi.mock('./UnlockPrompt', () => ({ UnlockPrompt: () => <div data-testid="unlock-prompt" /> }));
vi.mock('./CredentialRow', () => ({
  CredentialRow: ({ credential }: { credential: CredentialMeta }) => (
    <li data-testid="cred-row">{credential.name}</li>
  ),
}));
vi.mock('./NewCredentialForm', () => ({
  NewCredentialForm: ({ onCreated }: { onCreated: () => void }) => (
    <form data-testid="new-form">
      <button type="button" onClick={onCreated}>
        done
      </button>
    </form>
  ),
}));

const creds: CredentialMeta[] = [
  {
    id: 'c1',
    name: 'GitHub token',
    type: 'API_KEY',
    metadataPublic: null,
    createdAt: '2026-01-01',
    createdById: 'u1',
    needsRotation: false,
    access: [],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  useVaultUnlock.mockReturnValue({ vault: null, lock });
});

describe('VaultClient', () => {
  it('locked: shows UnlockPrompt and credentials list', () => {
    render(
      <VaultClient projectSlug="p" currentUserId="u1" isAdmin canCreate credentials={creds} />,
    );
    expect(screen.getByTestId('unlock-prompt')).toBeInTheDocument();
    expect(screen.getByText('Vault locked. Enter your passphrase to decrypt.')).toBeInTheDocument();
    expect(screen.getByTestId('cred-row')).toHaveTextContent('GitHub token');
    // no lock/new buttons while locked
    expect(screen.queryByText('🔒 Lock vault')).not.toBeInTheDocument();
  });

  it('locked + empty list shows empty message', () => {
    render(<VaultClient projectSlug="p" currentUserId="u1" isAdmin canCreate credentials={[]} />);
    expect(
      screen.getByText("You don’t have any accessible credentials in this project yet."),
    ).toBeInTheDocument();
  });

  it('unlocked: shows lock button and toggles new credential form', async () => {
    const user = userEvent.setup();
    useVaultUnlock.mockReturnValue({ vault: { publicKey: new Uint8Array(), privateKey: new Uint8Array() }, lock });
    render(
      <VaultClient projectSlug="p" currentUserId="u1" isAdmin canCreate credentials={creds} />,
    );
    expect(screen.getByText('Vault unlocked. Your private key lives only in memory.')).toBeInTheDocument();
    await user.click(screen.getByText('🔒 Lock vault'));
    expect(lock).toHaveBeenCalled();

    // toggle the new-credential form open and closed
    await user.click(screen.getByRole('button', { name: '+ New credential' }));
    expect(screen.getByTestId('new-form')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    // onCreated closes the form
    await user.click(screen.getByRole('button', { name: 'done' }));
    expect(screen.queryByTestId('new-form')).not.toBeInTheDocument();
  });

  it('unlocked but cannot create: no new button', () => {
    useVaultUnlock.mockReturnValue({ vault: { publicKey: new Uint8Array(), privateKey: new Uint8Array() }, lock });
    render(
      <VaultClient projectSlug="p" currentUserId="u1" isAdmin canCreate={false} credentials={creds} />,
    );
    expect(screen.queryByRole('button', { name: '+ New credential' })).not.toBeInTheDocument();
  });
});
