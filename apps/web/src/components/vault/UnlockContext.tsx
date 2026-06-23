'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { fromBase64, memzero, unlockPrivateKey } from '@/lib/crypto';
import { getSelfKeyMaterial } from '@/lib/actions/me';
import { useI18n } from '@/lib/i18n/i18n';

interface UnlockedVault {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

interface UnlockContextValue {
  vault: UnlockedVault | null;
  unlock: (passphrase: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  lock: () => void;
}

const Ctx = createContext<UnlockContextValue | null>(null);

export function VaultUnlockProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [vault, setVault] = useState<UnlockedVault | null>(null);
  // Hold a ref so we can wipe the bytes on lock without depending on stale closures.
  const ref = useRef<UnlockedVault | null>(null);

  const unlock = useCallback(async (passphrase: string) => {
    const r = await getSelfKeyMaterial();
    if (!r.ok) return { ok: false as const, error: r.error };
    try {
      const publicKey = fromBase64(r.data.publicKey);
      const privateKey = unlockPrivateKey(passphrase, {
        encryptedPrivateKey: fromBase64(r.data.encryptedPrivateKey),
        encryptedPrivKeyNonce: fromBase64(r.data.encryptedPrivKeyNonce),
        kdfSalt: fromBase64(r.data.kdfSalt),
      });
      const v: UnlockedVault = { publicKey, privateKey };
      ref.current = v;
      setVault(v);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : t('No se pudo desbloquear', 'Could not unlock') };
    }
  }, [t]);

  const lock = useCallback(() => {
    if (ref.current) memzero(ref.current.privateKey);
    ref.current = null;
    setVault(null);
  }, []);

  const value = useMemo(() => ({ vault, unlock, lock }), [vault, unlock, lock]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVaultUnlock(): UnlockContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useVaultUnlock requires <VaultUnlockProvider>');
  return v;
}
