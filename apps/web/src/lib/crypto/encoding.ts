/** UTF-8 + base64url helpers. Pure JS, identical in node and browser. */

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export function textToBytes(text: string): Uint8Array {
  return enc.encode(text);
}

export function bytesToText(bytes: Uint8Array): string {
  return dec.decode(bytes);
}

// Use Node Buffer ONLY when running on Node (not in a browser bundle that
// happens to polyfill a partial Buffer). Some bundlers ship a Buffer shim
// without 'base64url' support, which would throw "Unknown encoding".
const isNode =
  typeof process !== 'undefined' &&
  !!process.versions &&
  typeof process.versions.node === 'string';

/** base64url (RFC 4648 §5) without padding. */
export function toBase64(bytes: Uint8Array): string {
  if (isNode) {
    return Buffer.from(bytes).toString('base64url');
  }
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64(s: string): Uint8Array {
  if (isNode) {
    return new Uint8Array(Buffer.from(s, 'base64url'));
  }
  const normalized = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const bin = atob(normalized + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
