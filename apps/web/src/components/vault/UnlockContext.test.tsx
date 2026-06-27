import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  getSelfKeyMaterial: vi.fn(),
  fromBase64: vi.fn((s: string) => new Uint8Array([s.length])),
  memzero: vi.fn(),
  unlockPrivateKey: vi.fn(() => new Uint8Array([9, 9, 9])),
}));

vi.mock('@/lib/actions/me', () => ({ getSelfKeyMaterial: h.getSelfKeyMaterial }));
vi.mock('@/lib/crypto', () => ({
  fromBase64: h.fromBase64,
  memzero: h.memzero,
  unlockPrivateKey: h.unlockPrivateKey,
}));
vi.mock('@/lib/i18n/i18n', () => ({
  useI18n: () => ({ t: (_es: unknown, en: unknown) => en }),
}));

import { VaultUnlockProvider, useVaultUnlock } from './UnlockContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <VaultUnlockProvider>{children}</VaultUnlockProvider>
);

const KEY_MATERIAL = {
  ok: true as const,
  data: {
    publicKey: 'pub',
    encryptedPrivateKey: 'epk',
    encryptedPrivKeyNonce: 'nonce',
    kdfSalt: 'salt',
  },
};

describe('UnlockContext', () => {
  beforeEach(() => {
    h.getSelfKeyMaterial.mockReset();
    h.memzero.mockClear();
    h.unlockPrivateKey.mockClear();
  });

  it('throws when useVaultUnlock is used outside the provider', () => {
    expect(() => renderHook(() => useVaultUnlock())).toThrow(/requires <VaultUnlockProvider>/);
  });

  it('unlocks successfully and exposes the vault', async () => {
    h.getSelfKeyMaterial.mockResolvedValue(KEY_MATERIAL);
    const { result } = renderHook(() => useVaultUnlock(), { wrapper });
    expect(result.current.vault).toBeNull();

    let res!: { ok: boolean };
    await act(async () => {
      res = await result.current.unlock('passphrase');
    });
    expect(res.ok).toBe(true);
    expect(result.current.vault).not.toBeNull();
    expect(h.unlockPrivateKey).toHaveBeenCalled();
  });

  it('locks and wipes the private key', async () => {
    h.getSelfKeyMaterial.mockResolvedValue(KEY_MATERIAL);
    const { result } = renderHook(() => useVaultUnlock(), { wrapper });
    await act(async () => { await result.current.unlock('p'); });
    expect(result.current.vault).not.toBeNull();
    act(() => result.current.lock());
    expect(result.current.vault).toBeNull();
    expect(h.memzero).toHaveBeenCalled();
  });

  it('lock is a no-op when already locked', () => {
    const { result } = renderHook(() => useVaultUnlock(), { wrapper });
    act(() => result.current.lock());
    expect(result.current.vault).toBeNull();
    expect(h.memzero).not.toHaveBeenCalled();
  });

  it('returns the server error when key material cannot be fetched', async () => {
    h.getSelfKeyMaterial.mockResolvedValue({ ok: false, error: 'no key' });
    const { result } = renderHook(() => useVaultUnlock(), { wrapper });
    let res!: { ok: boolean; error?: string };
    await act(async () => { res = await result.current.unlock('p'); });
    expect(res).toEqual({ ok: false, error: 'no key' });
  });

  it('returns an error when decryption throws', async () => {
    h.getSelfKeyMaterial.mockResolvedValue(KEY_MATERIAL);
    h.unlockPrivateKey.mockImplementationOnce(() => {
      throw new Error('bad passphrase');
    });
    const { result } = renderHook(() => useVaultUnlock(), { wrapper });
    let res!: { ok: boolean; error?: string };
    await act(async () => { res = await result.current.unlock('wrong'); });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('bad passphrase');
  });

  it('renders provider children', () => {
    h.getSelfKeyMaterial.mockResolvedValue(KEY_MATERIAL);
    render(<VaultUnlockProvider><span>child</span></VaultUnlockProvider>);
    expect(screen.getByText('child')).toBeInTheDocument();
  });
});
