/**
 * TOTP (RFC 6238) second factor.
 *
 * The TOTP secret is encrypted at rest with a SERVER-side AEAD key
 * (AUTH_TOTP_KEY), not with the user's passphrase-derived KEK. This is a
 * deliberate, narrow trade-off: TOTP is a 2nd factor that the server must
 * verify, so the server needs to read the secret. The vault itself remains
 * zero-knowledge.
 */
import { authenticator } from 'otplib';
import {
  fromBase64,
  randomBytes,
  SECRETBOX_NONCE_BYTES,
  secretboxOpen,
  secretboxSeal,
  toBase64,
} from '@/lib/crypto';
import { env } from '@/lib/env';

authenticator.options = { step: 30, window: 1 };

function getServerKey(): Uint8Array {
  const key = env().AUTH_TOTP_KEY;
  if (!key) throw new Error('AUTH_TOTP_KEY is not set');
  const bytes = fromBase64(key);
  if (bytes.length !== 32) {
    throw new Error('AUTH_TOTP_KEY must decode to exactly 32 bytes');
  }
  return bytes;
}

/** Generate a fresh TOTP secret. The QR/manual entry shows this base32 secret. */
export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

/** Build the otpauth:// URI that QR-code libraries render into a QR. */
export function buildOtpauthUri(secret: string, accountEmail: string): string {
  return authenticator.keyuri(accountEmail, 'admin_data_project', secret);
}

/** True iff `code` is the valid TOTP for `secret` in the current window. */
export function verifyTotp(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return authenticator.check(code, secret);
}

/** Encrypt a TOTP base32 secret with the server key for storage. */
export function sealTotpSecret(secret: string): { ciphertext: Uint8Array; nonce: Uint8Array } {
  const key = getServerKey();
  const nonce = randomBytes(SECRETBOX_NONCE_BYTES);
  const plaintext = new TextEncoder().encode(secret);
  const ciphertext = secretboxSeal(plaintext, nonce, key);
  return { ciphertext, nonce };
}

/** Decrypt a stored TOTP secret. Throws on tamper / wrong key. */
export function openTotpSecret(ciphertext: Uint8Array, nonce: Uint8Array): string {
  const key = getServerKey();
  const plain = secretboxOpen(ciphertext, nonce, key);
  return new TextDecoder().decode(plain);
}

export { toBase64 as totpToBase64 };
