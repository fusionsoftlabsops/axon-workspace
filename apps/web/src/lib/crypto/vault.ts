/**
 * Vault primitives: per-credential DEK + sealed-box DEK wrapping.
 *
 * Each credential is encrypted with its own random Data Encryption Key (DEK)
 * using authenticated symmetric encryption (XSalsa20-Poly1305). The DEK is
 * then wrapped (encrypted) for each authorized recipient using their X25519
 * public key via libsodium-compatible sealed boxes — recipients can unwrap
 * with their private key alone, while observers (including the server) learn
 * nothing.
 *
 * Sharing == compute a new wrapped DEK for the new recipient.
 * Revoking == delete a wrapped DEK row + rotate the credential.
 */
import { bytesToText, textToBytes } from './encoding';
import {
  memzero,
  randomBytes,
  sealedBoxOpen,
  sealedBoxSeal,
  SECRETBOX_KEY_BYTES,
  SECRETBOX_NONCE_BYTES,
  secretboxOpen,
  secretboxSeal,
} from './sodium';

export interface EncryptedCredential {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  /** Random 32-byte DEK. Caller wraps this for each authorized recipient. */
  dek: Uint8Array;
}

/**
 * Encrypt a credential plaintext (string) with a fresh DEK.
 * The DEK must be wrapped for each recipient via {@link wrapDekForRecipient}
 * before being persisted (server never sees the unwrapped DEK).
 */
export function encryptCredentialText(plaintext: string): EncryptedCredential {
  const dek = randomBytes(SECRETBOX_KEY_BYTES);
  const nonce = randomBytes(SECRETBOX_NONCE_BYTES);
  const ciphertext = secretboxSeal(textToBytes(plaintext), nonce, dek);
  return { ciphertext, nonce, dek };
}

/** Decrypt a credential given the unwrapped DEK. Returns plaintext as a string. */
export function decryptCredentialText(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  dek: Uint8Array,
): string {
  return bytesToText(secretboxOpen(ciphertext, nonce, dek));
}

/**
 * Wrap a DEK for a specific recipient using their X25519 public key.
 * Uses a sealed box — the recipient decrypts with their private key alone;
 * the same DEK can be wrapped independently for many recipients.
 */
export function wrapDekForRecipient(
  dek: Uint8Array,
  recipientPublicKey: Uint8Array,
): Uint8Array {
  return sealedBoxSeal(dek, recipientPublicKey);
}

/** Unwrap a DEK that was wrapped for `me`. Throws on tamper / wrong key. */
export function unwrapDek(
  wrappedDek: Uint8Array,
  myPublicKey: Uint8Array,
  myPrivateKey: Uint8Array,
): Uint8Array {
  return sealedBoxOpen(wrappedDek, myPublicKey, myPrivateKey);
}

/**
 * High-level helper: given a plaintext and recipients, return the encrypted
 * credential and per-recipient wrapped DEKs ready to persist as
 * `CredentialAccess` rows.
 */
export function encryptAndShareCredential(
  plaintext: string,
  recipients: ReadonlyArray<{ userId: string; publicKey: Uint8Array }>,
): {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  access: Array<{ userId: string; wrappedDek: Uint8Array }>;
} {
  if (recipients.length === 0) {
    throw new Error('Al menos un recipient es requerido');
  }
  const { ciphertext, nonce, dek } = encryptCredentialText(plaintext);
  const access = recipients.map((r) => ({
    userId: r.userId,
    wrappedDek: wrapDekForRecipient(dek, r.publicKey),
  }));
  memzero(dek);
  return { ciphertext, nonce, access };
}
