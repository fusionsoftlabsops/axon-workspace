import { describe, expect, it } from 'vitest';
import { generateProtectedKeypair, unlockPrivateKey } from './keypair';

describe('keypair', () => {
  it('round-trips a keypair through encrypt/decrypt with the correct passphrase', () => {
    const pass = 'correct horse battery staple';
    const protected_ = generateProtectedKeypair(pass);

    expect(protected_.publicKey).toHaveLength(32);
    expect(protected_.encryptedPrivateKey.length).toBeGreaterThan(32);

    const sk = unlockPrivateKey(pass, protected_);
    expect(sk).toHaveLength(32);
  });

  it('rejects an incorrect passphrase with a clear error', () => {
    const protected_ = generateProtectedKeypair('correct horse battery staple');
    expect(() => unlockPrivateKey('wrong passphrase x', protected_)).toThrow(
      /incorrecta|corruptos/,
    );
  });

  it('refuses passphrases shorter than 12 chars', () => {
    expect(() => generateProtectedKeypair('shortpass')).toThrow(/12 characters/);
  });

  it('produces a different salt/nonce on each generation', () => {
    const a = generateProtectedKeypair('correct horse battery staple');
    const b = generateProtectedKeypair('correct horse battery staple');
    expect(Buffer.from(a.kdfSalt).equals(Buffer.from(b.kdfSalt))).toBe(false);
    expect(
      Buffer.from(a.encryptedPrivKeyNonce).equals(Buffer.from(b.encryptedPrivKeyNonce)),
    ).toBe(false);
  });
});
