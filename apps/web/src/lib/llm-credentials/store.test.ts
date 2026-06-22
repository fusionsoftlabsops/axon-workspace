import { describe, expect, it } from 'vitest';
import {
  fromBase64,
  randomBytes,
  SECRETBOX_NONCE_BYTES,
  secretboxSeal,
  textToBytes,
} from '@/lib/crypto';
import { decryptLlmCredentialKey } from './store';

/**
 * Verifies the LLM credential store seals/opens with AUTH_LLM_KEY (the
 * dedicated key from WS1b). We seal a payload with AUTH_LLM_KEY directly and
 * confirm decryptLlmCredentialKey (which reads the env key) recovers it.
 */
describe('llm-credentials store', () => {
  it('decrypts a key sealed under AUTH_LLM_KEY', () => {
    const serverKey = fromBase64(process.env.AUTH_LLM_KEY as string);
    const nonce = randomBytes(SECRETBOX_NONCE_BYTES);
    const plain = 'sk-test-abc123-secret-key';
    const ciphertext = secretboxSeal(textToBytes(plain), nonce, serverKey);

    const recovered = decryptLlmCredentialKey({
      encryptedKey: Buffer.from(ciphertext),
      nonce: Buffer.from(nonce),
    });
    expect(recovered).toBe(plain);
  });

  it('fails to decrypt a tampered ciphertext', () => {
    const serverKey = fromBase64(process.env.AUTH_LLM_KEY as string);
    const nonce = randomBytes(SECRETBOX_NONCE_BYTES);
    const ciphertext = secretboxSeal(textToBytes('secret'), nonce, serverKey);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff; // tamper

    expect(() =>
      decryptLlmCredentialKey({ encryptedKey: Buffer.from(ciphertext), nonce: Buffer.from(nonce) }),
    ).toThrow();
  });
});
