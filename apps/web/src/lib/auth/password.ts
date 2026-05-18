/**
 * Login-password hashing with argon2id (via @node-rs/argon2).
 *
 * The login password is independent from the vault passphrase used to derive
 * the KEK. We hash it on the server with strong argon2id parameters so that
 * even a DB dump doesn't reveal credentials offline.
 */
import { hash, verify } from '@node-rs/argon2';

// argon2id is the default for @node-rs/argon2's hash() — we don't need to
// pass `algorithm` and avoid pulling in its ambient const enum.
const PARAMS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 12) {
    throw new Error('Login password must be at least 12 characters');
  }
  return hash(plain, PARAMS);
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain);
  } catch {
    // Malformed hash or other internal error → treat as auth failure.
    return false;
  }
}
