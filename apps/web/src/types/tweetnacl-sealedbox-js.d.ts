declare module 'tweetnacl-sealedbox-js' {
  /**
   * Anonymous (sealed) encryption to a recipient's X25519 public key.
   * Output format: `ephemeral_pk(32) || box_ciphertext`.
   */
  export function seal(message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array;

  /**
   * Open a sealed box. Returns the plaintext, or `false`/`null` on failure.
   */
  export function open(
    ciphertext: Uint8Array,
    recipientPublicKey: Uint8Array,
    recipientSecretKey: Uint8Array,
  ): Uint8Array | null | false;

  const _default: { seal: typeof seal; open: typeof open };
  export default _default;
}
