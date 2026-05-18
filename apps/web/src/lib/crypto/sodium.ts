/**
 * Pure-JS crypto primitives shared by the vault.
 *
 * - tweetnacl                  → box keypair, secretbox (XSalsa20-Poly1305), random bytes
 * - tweetnacl-sealedbox-js     → X25519 sealed boxes (DEK wrapping)
 * - @noble/hashes/argon2id     → password-based KDF for the user passphrase
 *
 * All implementations are pure JavaScript with no native or WASM dependencies,
 * so the same code path runs identically in the browser and on Node.
 */
import nacl from 'tweetnacl';
import sealedbox from 'tweetnacl-sealedbox-js';
import { argon2id } from '@noble/hashes/argon2';

export const SECRETBOX_KEY_BYTES = 32;
export const SECRETBOX_NONCE_BYTES = 24;
export const BOX_PUBLIC_KEY_BYTES = 32;
export const BOX_SECRET_KEY_BYTES = 32;
export const KDF_SALT_BYTES = 16;
export const KDF_OUTPUT_BYTES = 32; // matches SECRETBOX_KEY_BYTES so output IS a KEK

// argon2id parameters: ~256 MB, 3 iterations, 1 lane.
// Roughly OWASP-recommended for password-derived key wrapping in a browser.
// Adjust here if profiling shows it's painful on low-end devices.
export const KDF_PARAMS = { t: 3, m: 65536, p: 1, dkLen: KDF_OUTPUT_BYTES } as const;

export function randomBytes(n: number): Uint8Array {
  return nacl.randomBytes(n);
}

export function generateBoxKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
  return nacl.box.keyPair();
}

/** XSalsa20-Poly1305 authenticated symmetric encryption. */
export function secretboxSeal(plaintext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array {
  return nacl.secretbox(plaintext, nonce, key);
}

/**
 * XSalsa20-Poly1305 authenticated symmetric decryption.
 * Throws if the ciphertext is forged or the key is wrong.
 */
export function secretboxOpen(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  key: Uint8Array,
): Uint8Array {
  const plain = nacl.secretbox.open(ciphertext, nonce, key);
  if (plain === null) {
    throw new Error('secretbox: authentication failed (wrong key or corrupted ciphertext)');
  }
  return plain;
}

/** Anonymous (sealed) encryption to a recipient's X25519 public key. */
export function sealedBoxSeal(plaintext: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  return sealedbox.seal(plaintext, recipientPublicKey);
}

/**
 * Open a sealed box. Throws if the box wasn't addressed to this keypair or
 * was tampered with.
 */
export function sealedBoxOpen(
  ciphertext: Uint8Array,
  publicKey: Uint8Array,
  secretKey: Uint8Array,
): Uint8Array {
  const opened = sealedbox.open(ciphertext, publicKey, secretKey);
  if (opened === null || opened === false || !(opened instanceof Uint8Array)) {
    throw new Error('sealedbox: authentication failed');
  }
  return opened;
}

/**
 * Derive a 32-byte Key Encryption Key from a user passphrase + salt using
 * argon2id. The output is suitable as a secretbox key (32 bytes).
 */
export function deriveKdfKey(passphrase: string, salt: Uint8Array): Uint8Array {
  return argon2id(passphrase, salt, KDF_PARAMS);
}

/** Overwrite a Uint8Array in place with zeros. Best-effort key wiping. */
export function memzero(buf: Uint8Array): void {
  buf.fill(0);
}
