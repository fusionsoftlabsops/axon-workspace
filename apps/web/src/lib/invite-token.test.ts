import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashInviteToken } from './invite-token';

describe('hashInviteToken', () => {
  it('returns the sha256 hex of the plaintext', () => {
    const plain = 'invite-abc-123';
    const expected = createHash('sha256').update(plain).digest('hex');
    expect(hashInviteToken(plain)).toBe(expected);
  });

  it('is deterministic for the same input', () => {
    expect(hashInviteToken('x')).toBe(hashInviteToken('x'));
  });

  it('produces a 64-char hex digest', () => {
    expect(hashInviteToken('anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different inputs', () => {
    expect(hashInviteToken('a')).not.toBe(hashInviteToken('b'));
  });
});
