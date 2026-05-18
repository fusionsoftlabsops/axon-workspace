/**
 * User keypair lifecycle for zero-knowledge vault.
 *
 * Each user has an X25519 keypair. The public key is stored in the clear; the
 * private key is encrypted with a KEK derived from the user's passphrase via
 * argon2id, and the encrypted blob is what reaches the server. The server can
 * never recover the private key without the passphrase.
 */
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

/**
 * Generate a fresh X25519 keypair and protect the private key with the user's
 * passphrase. The returned blob is what gets POSTed to the server on signup.
 */
export function generateProtectedKeypair(passphrase: string): ProtectedKeypair {
  if (passphrase.length < 12) {
    throw new Error('Passphrase must be at least 12 characters');
  }

  const keypair = generateBoxKeyPair();
  const salt = randomBytes(KDF_SALT_BYTES);
  const kek = deriveKdfKey(passphrase, salt);

  const nonce = randomBytes(SECRETBOX_NONCE_BYTES);
  const encryptedPrivateKey = secretboxSeal(keypair.secretKey, nonce, kek);

  memzero(kek);
  memzero(keypair.secretKey);

  return {
    publicKey: keypair.publicKey,
    encryptedPrivateKey,
    encryptedPrivKeyNonce: nonce,
    kdfSalt: salt,
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
