import { createHash } from 'node:crypto';

/** sha256 hex of a plaintext invite token. Only the hash is stored. */
export function hashInviteToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}
