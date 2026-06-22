import { describe, expect, it } from 'vitest';
import {
  generateProtectedKeypairWithRecovery,
  generateRecoveryCode,
  normalizeRecoveryCode,
  recoverPrivateKey,
  recoveryCodeProof,
  unlockPrivateKey,
  wrapPrivateKeyWithPassphrase,
  wrapPrivateKeyWithRecoveryCode,
} from './keypair';

describe('recovery code', () => {
  it('generates a high-entropy, grouped, distinct code each time', () => {
    const a = generateRecoveryCode();
    const b = generateRecoveryCode();
    expect(a).not.toBe(b);
    expect(a).toContain('-');
    // 20 bytes → 32 base32 chars → 8 groups of 4
    expect(normalizeRecoveryCode(a)).toHaveLength(32);
  });

  it('normalizes formatting (case + separators) to a canonical form', () => {
    const code = generateRecoveryCode();
    const messy = code.toLowerCase().replace(/-/g, ' ');
    expect(normalizeRecoveryCode(messy)).toBe(normalizeRecoveryCode(code));
  });

  it('proof is deterministic over the normalized code and format-independent', () => {
    const code = generateRecoveryCode();
    expect(recoveryCodeProof(code)).toBe(recoveryCodeProof(code.toLowerCase()));
    expect(recoveryCodeProof(code)).toHaveLength(64); // sha256 hex
    expect(recoveryCodeProof('AAAA-BBBB')).not.toBe(recoveryCodeProof('AAAA-BBBC'));
  });
});

describe('private key recovery', () => {
  it('round-trips the private key through the recovery code', () => {
    const kp = generateProtectedKeypairWithRecovery('correct horse battery staple');

    // Unlock with passphrase (existing path) and with recovery code (new path)
    // must yield the SAME private key.
    const viaPass = unlockPrivateKey('correct horse battery staple', kp);
    const viaCode = recoverPrivateKey(kp.recoveryCode, kp);

    expect(Buffer.from(viaCode).equals(Buffer.from(viaPass))).toBe(true);
    expect(viaCode).toHaveLength(32);
  });

  it('rejects an incorrect recovery code', () => {
    const kp = generateProtectedKeypairWithRecovery('correct horse battery staple');
    expect(() => recoverPrivateKey('WRONG-CODE-HERE-2345', kp)).toThrow(/incorrecto|corruptos/);
  });

  it('supports passphrase reset: recover, re-seal under a new passphrase, unlock', () => {
    const kp = generateProtectedKeypairWithRecovery('old passphrase value');
    const sk = recoverPrivateKey(kp.recoveryCode, kp);

    const resealed = wrapPrivateKeyWithPassphrase(sk, 'a brand new passphrase');
    const unlocked = unlockPrivateKey('a brand new passphrase', {
      encryptedPrivateKey: resealed.encryptedPrivateKey,
      encryptedPrivKeyNonce: resealed.encryptedPrivKeyNonce,
      kdfSalt: resealed.kdfSalt,
    });
    expect(Buffer.from(unlocked).equals(Buffer.from(sk))).toBe(true);
    // Old passphrase must no longer open the re-sealed blob.
    expect(() =>
      unlockPrivateKey('old passphrase value', {
        encryptedPrivateKey: resealed.encryptedPrivateKey,
        encryptedPrivKeyNonce: resealed.encryptedPrivKeyNonce,
        kdfSalt: resealed.kdfSalt,
      }),
    ).toThrow();
  });

  it('supports regenerating the recovery code for an unlocked key', () => {
    const kp = generateProtectedKeypairWithRecovery('correct horse battery staple');
    const sk = unlockPrivateKey('correct horse battery staple', kp);

    const newCode = generateRecoveryCode();
    const newBlob = wrapPrivateKeyWithRecoveryCode(sk, newCode);

    expect(Buffer.from(recoverPrivateKey(newCode, newBlob)).equals(Buffer.from(sk))).toBe(true);
    // The old code must not open the new blob.
    expect(() => recoverPrivateKey(kp.recoveryCode, newBlob)).toThrow();
  });
});
