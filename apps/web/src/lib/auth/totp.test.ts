import { describe, expect, it } from 'vitest';
import { authenticator } from 'otplib';
import {
  buildOtpauthUri,
  generateTotpSecret,
  openTotpSecret,
  sealTotpSecret,
  verifyTotp,
} from './totp';

describe('totp', () => {
  it('seals and opens a TOTP secret with the server key (AUTH_TOTP_KEY)', () => {
    const secret = generateTotpSecret();
    const { ciphertext, nonce } = sealTotpSecret(secret);
    expect(openTotpSecret(ciphertext, nonce)).toBe(secret);
  });

  it('verifies a current code and rejects a wrong one', () => {
    const secret = generateTotpSecret();
    const code = authenticator.generate(secret);
    expect(verifyTotp(secret, code)).toBe(true);
    expect(verifyTotp(secret, '000000')).toBe(false);
    expect(verifyTotp(secret, 'abc')).toBe(false); // not 6 digits
  });

  it('builds an otpauth URI for the issuer', () => {
    const secret = generateTotpSecret();
    const uri = buildOtpauthUri(secret, 'user@example.com');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('admin_data_project');
  });
});
