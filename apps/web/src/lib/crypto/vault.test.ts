import { describe, expect, it } from 'vitest';
import { generateProtectedKeypair, unlockPrivateKey } from './keypair';
import {
  decryptCredentialText,
  encryptAndShareCredential,
  encryptCredentialText,
  unwrapDek,
  wrapDekForRecipient,
} from './vault';

function makeUser(name: string) {
  const passphrase = `${name}-passphrase-min12`;
  const protected_ = generateProtectedKeypair(passphrase);
  const privateKey = unlockPrivateKey(passphrase, protected_);
  return { name, publicKey: protected_.publicKey, privateKey };
}

describe('vault', () => {
  it('encrypts a credential and the owner can decrypt it', () => {
    const owner = makeUser('owner');
    const secret = 'aws-secret-access-key-AKIA-very-confidential';

    const { ciphertext, nonce, dek } = encryptCredentialText(secret);
    const wrapped = wrapDekForRecipient(dek, owner.publicKey);

    const unwrapped = unwrapDek(wrapped, owner.publicKey, owner.privateKey);
    const decrypted = decryptCredentialText(ciphertext, nonce, unwrapped);

    expect(decrypted).toBe(secret);
  });

  it('shares a credential with multiple users via sealed boxes', () => {
    const alice = makeUser('alice');
    const bob = makeUser('bob');
    const eve = makeUser('eve');

    const secret = 'gh_pat_abc123_def456_ghi789';
    const { ciphertext, nonce, access } = encryptAndShareCredential(secret, [
      { userId: 'alice', publicKey: alice.publicKey },
      { userId: 'bob', publicKey: bob.publicKey },
    ]);

    expect(access).toHaveLength(2);

    const aliceWrap = access.find((a) => a.userId === 'alice')!;
    const aliceDek = unwrapDek(aliceWrap.wrappedDek, alice.publicKey, alice.privateKey);
    expect(decryptCredentialText(ciphertext, nonce, aliceDek)).toBe(secret);

    const bobWrap = access.find((a) => a.userId === 'bob')!;
    const bobDek = unwrapDek(bobWrap.wrappedDek, bob.publicKey, bob.privateKey);
    expect(decryptCredentialText(ciphertext, nonce, bobDek)).toBe(secret);

    // Eve was not granted access.
    expect(() => unwrapDek(aliceWrap.wrappedDek, eve.publicKey, eve.privateKey)).toThrow();
    expect(() => unwrapDek(bobWrap.wrappedDek, eve.publicKey, eve.privateKey)).toThrow();
  });

  it('detects ciphertext tampering on decryption', () => {
    const user = makeUser('user');
    const { ciphertext, nonce, dek } = encryptCredentialText('hello');
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;
    const wrapped = wrapDekForRecipient(dek, user.publicKey);
    const unwrapped = unwrapDek(wrapped, user.publicKey, user.privateKey);
    expect(() => decryptCredentialText(ciphertext, nonce, unwrapped)).toThrow();
  });

  it('refuses encryption with empty recipient list', () => {
    expect(() => encryptAndShareCredential('x', [])).toThrow();
  });
});
