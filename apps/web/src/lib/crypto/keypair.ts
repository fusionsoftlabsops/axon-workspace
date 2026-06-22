/**
 * User keypair lifecycle for zero-knowledge vault.
 *
 * Each user has an X25519 keypair. The public key is stored in the clear; the
 * private key is encrypted with a KEK derived from the user's passphrase via
 * argon2id, and the encrypted blob is what reaches the server. The server can
 * never recover the private key without the passphrase.
 */
import { sha256 } from '@noble/hashes/sha256';
import {
  deriveKdfKey,
  generateBoxKeyPair,
  KDF_SALT_BYTES,
  memzero,
  randomBytes,
  SECRETBOX_NONCE_BYTES,
  secretboxOpen,
  secretboxSeal,
} from './sodium';

export interface ProtectedKeypair {
  publicKey: Uint8Array;
  encryptedPrivateKey: Uint8Array;
  encryptedPrivKeyNonce: Uint8Array;
  kdfSalt: Uint8Array;
}

/** The private key sealed with a KEK derived from the recovery code. */
export interface RecoveryProtectedKey {
  encryptedPrivKeyRecovery: Uint8Array;
  recoveryPrivKeyNonce: Uint8Array;
  recoveryKdfSalt: Uint8Array;
}

type PassphraseProtected = Pick<
  ProtectedKeypair,
  'encryptedPrivateKey' | 'encryptedPrivKeyNonce' | 'kdfSalt'
>;

/**
 * Seal an existing private key with a KEK derived from `passphrase`. Reused by
 * signup and by the passphrase-reset flow (which re-seals the SAME key).
 */
export function wrapPrivateKeyWithPassphrase(
  privateKey: Uint8Array,
  passphrase: string,
): PassphraseProtected {
  if (passphrase.length < 12) {
    throw new Error('Passphrase must be at least 12 characters');
  }
  const salt = randomBytes(KDF_SALT_BYTES);
  const kek = deriveKdfKey(passphrase, salt);
  const nonce = randomBytes(SECRETBOX_NONCE_BYTES);
  const encryptedPrivateKey = secretboxSeal(privateKey, nonce, kek);
  memzero(kek);
  return { encryptedPrivateKey, encryptedPrivKeyNonce: nonce, kdfSalt: salt };
}

/**
 * Generate a fresh X25519 keypair and protect the private key with the user's
 * passphrase. The returned blob is what gets POSTed to the server on signup.
 */
export function generateProtectedKeypair(passphrase: string): ProtectedKeypair {
  const keypair = generateBoxKeyPair();
  const protected_ = wrapPrivateKeyWithPassphrase(keypair.secretKey, passphrase);
  memzero(keypair.secretKey);
  return { publicKey: keypair.publicKey, ...protected_ };
}

// ---------- Recovery code ----------

const RECOVERY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += RECOVERY_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += RECOVERY_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Generate a human-storable recovery code (~160 bits), grouped for legibility. */
export function generateRecoveryCode(): string {
  return base32(randomBytes(20)).match(/.{1,4}/g)!.join('-');
}

/** Canonical form used for KDF + proof: uppercase, only base32 chars. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, '');
}

/**
 * Proof of knowledge of the recovery code, stored server-side as `recoveryHash`.
 * SHA-256 of the normalized code — lets the server verify the user typed a valid
 * code WITHOUT being able to derive the KEK (which needs argon2id over the code
 * itself, not its hash). Preserves zero-knowledge: server never sees the code.
 */
export function recoveryCodeProof(code: string): string {
  const digest = sha256(new TextEncoder().encode(normalizeRecoveryCode(code)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Seal an existing private key with a KEK derived from the recovery code. */
export function wrapPrivateKeyWithRecoveryCode(
  privateKey: Uint8Array,
  recoveryCode: string,
): RecoveryProtectedKey {
  const salt = randomBytes(KDF_SALT_BYTES);
  const kek = deriveKdfKey(normalizeRecoveryCode(recoveryCode), salt);
  const nonce = randomBytes(SECRETBOX_NONCE_BYTES);
  const sealed = secretboxSeal(privateKey, nonce, kek);
  memzero(kek);
  return {
    encryptedPrivKeyRecovery: sealed,
    recoveryPrivKeyNonce: nonce,
    recoveryKdfSalt: salt,
  };
}

/** Recover the private key from the recovery code. Throws if the code is wrong. */
export function recoverPrivateKey(recoveryCode: string, blob: RecoveryProtectedKey): Uint8Array {
  const kek = deriveKdfKey(normalizeRecoveryCode(recoveryCode), blob.recoveryKdfSalt);
  try {
    return secretboxOpen(blob.encryptedPrivKeyRecovery, blob.recoveryPrivKeyNonce, kek);
  } catch {
    throw new Error('Código de recuperación incorrecto o datos corruptos');
  } finally {
    memzero(kek);
  }
}

export interface ProtectedKeypairWithRecovery extends ProtectedKeypair, RecoveryProtectedKey {
  /** Plaintext recovery code — show ONCE to the user, never persist server-side. */
  recoveryCode: string;
  /** SHA-256 proof stored as `recoveryHash`. */
  recoveryProof: string;
}

/**
 * Signup helper: generate a keypair, seal the private key both with the
 * passphrase AND with a fresh recovery code, and return everything the client
 * needs to POST (plus the recovery code to display once).
 */
export function generateProtectedKeypairWithRecovery(
  passphrase: string,
): ProtectedKeypairWithRecovery {
  const keypair = generateBoxKeyPair();
  const recoveryCode = generateRecoveryCode();
  const pass = wrapPrivateKeyWithPassphrase(keypair.secretKey, passphrase);
  const rec = wrapPrivateKeyWithRecoveryCode(keypair.secretKey, recoveryCode);
  memzero(keypair.secretKey);
  return {
    publicKey: keypair.publicKey,
    ...pass,
    ...rec,
    recoveryCode,
    recoveryProof: recoveryCodeProof(recoveryCode),
  };
}

/**
 * Decrypt the user's private key given the passphrase and the server-stored
 * encrypted blob. Throws if the passphrase is wrong (authenticated decryption).
 */
export function unlockPrivateKey(
  passphrase: string,
  protected_: Pick<ProtectedKeypair, 'encryptedPrivateKey' | 'encryptedPrivKeyNonce' | 'kdfSalt'>,
): Uint8Array {
  const kek = deriveKdfKey(passphrase, protected_.kdfSalt);
  try {
    return secretboxOpen(protected_.encryptedPrivateKey, protected_.encryptedPrivKeyNonce, kek);
  } catch {
    throw new Error('Passphrase incorrecta o datos corruptos');
  } finally {
    memzero(kek);
  }
}
