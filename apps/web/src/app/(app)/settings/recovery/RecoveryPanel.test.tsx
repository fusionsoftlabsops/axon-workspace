import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  vault: null as { privateKey: Uint8Array } | null,
  unlock: vi.fn(),
  lock: vi.fn(),
  getMaterial: vi.fn(),
  resetAction: vi.fn(),
  setRecoveryAction: vi.fn(),
  recoverPrivateKey: vi.fn(),
  generateRecoveryCode: vi.fn(),
  wrapWithPass: vi.fn(),
  wrapWithCode: vi.fn(),
  memzero: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock('@/components/vault/UnlockContext', () => ({
  useVaultUnlock: () => ({ vault: h.vault, unlock: h.unlock, lock: h.lock }),
}));
vi.mock('@/lib/actions/me', () => ({ getSelfRecoveryMaterial: h.getMaterial }));
vi.mock('@/lib/actions/recovery', () => ({
  resetPassphraseWithRecoveryAction: h.resetAction,
  setRecoveryCodeAction: h.setRecoveryAction,
}));
vi.mock('@/lib/crypto', () => ({
  generateRecoveryCode: h.generateRecoveryCode,
  memzero: h.memzero,
  recoverPrivateKey: h.recoverPrivateKey,
  recoveryCodeProof: (c: string) => `proof:${c}`,
  toBase64: () => 'b64',
  fromBase64: () => new Uint8Array([1]),
  wrapPrivateKeyWithPassphrase: h.wrapWithPass,
  wrapPrivateKeyWithRecoveryCode: h.wrapWithCode,
}));

import { RecoveryPanel } from './RecoveryPanel';

beforeEach(() => {
  vi.clearAllMocks();
  h.vault = { privateKey: new Uint8Array([9]) };
});

async function fillReset(code: string, pass: string, confirm: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Recovery code'), code);
  await user.type(screen.getByLabelText('New passphrase'), pass);
  await user.type(screen.getByLabelText('Confirm the passphrase'), confirm);
  await user.click(screen.getByRole('button', { name: 'Reset passphrase' }));
  return user;
}

describe('RecoveryPanel — ResetWithCode', () => {
  it('rejects a passphrase shorter than 12 chars', async () => {
    render(<RecoveryPanel hasRecovery />);
    await fillReset('CODE', 'short', 'short');
    expect(await screen.findByText(/at least 12 characters/)).toBeInTheDocument();
    expect(h.getMaterial).not.toHaveBeenCalled();
  });

  it('rejects mismatched passphrases', async () => {
    render(<RecoveryPanel hasRecovery />);
    await fillReset('CODE', 'longenoughpass', 'differentpass1');
    expect(await screen.findByText('The passphrases do not match')).toBeInTheDocument();
  });

  it('surfaces an error when recovery material cannot be fetched', async () => {
    h.getMaterial.mockResolvedValue({ ok: false, error: 'no material' });
    render(<RecoveryPanel hasRecovery />);
    await fillReset('CODE', 'longenoughpass', 'longenoughpass');
    expect(await screen.findByText('no material')).toBeInTheDocument();
  });

  it('resets the passphrase, locks the vault and shows confirmation', async () => {
    h.getMaterial.mockResolvedValue({
      ok: true,
      data: { encryptedPrivKeyRecovery: 'a', recoveryPrivKeyNonce: 'b', recoveryKdfSalt: 'c' },
    });
    h.recoverPrivateKey.mockReturnValue(new Uint8Array([5]));
    h.wrapWithPass.mockReturnValue({ encryptedPrivateKey: new Uint8Array(), encryptedPrivKeyNonce: new Uint8Array(), kdfSalt: new Uint8Array() });
    h.resetAction.mockResolvedValue({ ok: true });
    render(<RecoveryPanel hasRecovery />);
    await fillReset('CODE', 'longenoughpass', 'longenoughpass');
    expect(await screen.findByText('Passphrase reset')).toBeInTheDocument();
    expect(h.lock).toHaveBeenCalled();
    expect(h.memzero).toHaveBeenCalled();
  });

  it('shows the error returned by the reset action', async () => {
    h.getMaterial.mockResolvedValue({
      ok: true,
      data: { encryptedPrivKeyRecovery: 'a', recoveryPrivKeyNonce: 'b', recoveryKdfSalt: 'c' },
    });
    h.recoverPrivateKey.mockReturnValue(new Uint8Array([5]));
    h.wrapWithPass.mockReturnValue({ encryptedPrivateKey: new Uint8Array(), encryptedPrivKeyNonce: new Uint8Array(), kdfSalt: new Uint8Array() });
    h.resetAction.mockResolvedValue({ ok: false, error: 'wrong code' });
    render(<RecoveryPanel hasRecovery />);
    await fillReset('CODE', 'longenoughpass', 'longenoughpass');
    expect(await screen.findByText('wrong code')).toBeInTheDocument();
  });

  it('catches a crypto failure during recovery', async () => {
    h.getMaterial.mockResolvedValue({
      ok: true,
      data: { encryptedPrivKeyRecovery: 'a', recoveryPrivKeyNonce: 'b', recoveryKdfSalt: 'c' },
    });
    h.recoverPrivateKey.mockImplementation(() => {
      throw new Error('decrypt failed');
    });
    render(<RecoveryPanel hasRecovery />);
    await fillReset('CODE', 'longenoughpass', 'longenoughpass');
    expect(await screen.findByText('decrypt failed')).toBeInTheDocument();
  });
});

describe('RecoveryPanel — RegenerateCode', () => {
  it('generates a new code when the vault is unlocked', async () => {
    h.generateRecoveryCode.mockReturnValue('NEW-RECOVERY-CODE');
    h.wrapWithCode.mockReturnValue({
      encryptedPrivKeyRecovery: new Uint8Array(),
      recoveryPrivKeyNonce: new Uint8Array(),
      recoveryKdfSalt: new Uint8Array(),
    });
    h.setRecoveryAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<RecoveryPanel hasRecovery />);
    expect(screen.getByRole('heading', { name: 'Regenerate recovery code' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Generate new code' }));
    expect(await screen.findByText('NEW-RECOVERY-CODE')).toBeInTheDocument();
    const clip = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(clip).toHaveBeenCalledWith('NEW-RECOVERY-CODE');
  });

  it('shows the error when regenerating fails', async () => {
    h.generateRecoveryCode.mockReturnValue('CODE');
    h.wrapWithCode.mockReturnValue({
      encryptedPrivKeyRecovery: new Uint8Array(),
      recoveryPrivKeyNonce: new Uint8Array(),
      recoveryKdfSalt: new Uint8Array(),
    });
    h.setRecoveryAction.mockResolvedValue({ ok: false, error: 'save failed' });
    const user = userEvent.setup();
    render(<RecoveryPanel hasRecovery />);
    await user.click(screen.getByRole('button', { name: 'Generate new code' }));
    expect(await screen.findByText('save failed')).toBeInTheDocument();
  });

  it('shows the set-up heading and unlock form when locked', async () => {
    h.vault = null;
    h.unlock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<RecoveryPanel hasRecovery={false} />);
    expect(screen.getByRole('heading', { name: 'Set up recovery code' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Unlock the vault to continue'), 'mypassphrase');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(h.unlock).toHaveBeenCalledWith('mypassphrase'));
  });

  it('surfaces an unlock error', async () => {
    h.vault = null;
    h.unlock.mockResolvedValue({ ok: false, error: 'bad passphrase' });
    const user = userEvent.setup();
    render(<RecoveryPanel hasRecovery={false} />);
    await user.type(screen.getByLabelText('Unlock the vault to continue'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('bad passphrase')).toBeInTheDocument();
  });
});
