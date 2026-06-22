import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('hashes and verifies a correct password', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).not.toContain('correct horse battery'); // not plaintext
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword(hash, 'wrong password value')).toBe(false);
  });

  it('produces distinct hashes (salted) for the same input', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).not.toBe(b);
  });

  it('refuses passwords shorter than 12 chars', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/12 characters/);
  });

  it('treats a malformed stored hash as a failed verification', async () => {
    expect(await verifyPassword('not-a-valid-argon2-hash', 'whatever value')).toBe(false);
  });
});
