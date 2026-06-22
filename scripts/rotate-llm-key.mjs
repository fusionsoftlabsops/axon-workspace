#!/usr/bin/env node
/**
 * One-shot migration: re-seal every LlmCredential from AUTH_TOTP_KEY (the old
 * shared key) to AUTH_LLM_KEY (the new dedicated key).
 *
 * Run once after you set AUTH_LLM_KEY in .env, then the app reads only
 * AUTH_LLM_KEY for LLM credentials (AUTH_TOTP_KEY stays for TOTP only).
 *
 * Usage (from repo root, with .env loaded):
 *   node --env-file=.env scripts/rotate-llm-key.mjs            # dry-run
 *   node --env-file=.env scripts/rotate-llm-key.mjs --apply    # write changes
 *
 * Requires DATABASE_URL, AUTH_TOTP_KEY (old) and AUTH_LLM_KEY (new) in env.
 * Idempotency: credentials already readable with AUTH_LLM_KEY are skipped.
 */
import { createRequire } from 'node:module';

// Resolve deps from the web app so this works regardless of pnpm hoisting.
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const nacl = require('tweetnacl');

const NONCE_BYTES = 24;

function decodeKey(name) {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} no está seteado en el entorno`);
  const bytes = new Uint8Array(Buffer.from(raw, 'base64url'));
  if (bytes.length !== 32) throw new Error(`${name} debe decodificar a 32 bytes (son ${bytes.length})`);
  return bytes;
}

function open(ciphertext, nonce, key) {
  const plain = nacl.secretbox.open(new Uint8Array(ciphertext), new Uint8Array(nonce), key);
  if (plain === null) throw new Error('secretbox: authentication failed');
  return plain;
}

function seal(plain, key) {
  const nonce = nacl.randomBytes(NONCE_BYTES);
  const ciphertext = nacl.secretbox(plain, nonce, key);
  return { ciphertext, nonce };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const oldKey = decodeKey('AUTH_TOTP_KEY');
  const newKey = decodeKey('AUTH_LLM_KEY');

  const prisma = new PrismaClient();
  try {
    const creds = await prisma.llmCredential.findMany({
      select: { id: true, label: true, encryptedKey: true, nonce: true },
    });
    console.log(`Encontradas ${creds.length} credenciales LLM. apply=${apply}`);

    let rotated = 0;
    let skipped = 0;
    let failed = 0;

    for (const c of creds) {
      // Si ya abre con la clave nueva, está migrada → skip (idempotente).
      try {
        open(c.encryptedKey, c.nonce, newKey);
        skipped++;
        continue;
      } catch {
        /* no abre con la nueva, intentar migrar desde la vieja */
      }

      let plain;
      try {
        plain = open(c.encryptedKey, c.nonce, oldKey);
      } catch {
        failed++;
        console.warn(`  ✗ ${c.id} (${c.label}): no abre ni con la clave vieja ni con la nueva — omitida`);
        continue;
      }

      const { ciphertext, nonce } = seal(plain, newKey);
      plain.fill(0);

      if (apply) {
        await prisma.llmCredential.update({
          where: { id: c.id },
          data: { encryptedKey: Buffer.from(ciphertext), nonce: Buffer.from(nonce) },
        });
      }
      rotated++;
      console.log(`  ✓ ${c.id} (${c.label})${apply ? ' migrada' : ' [dry-run]'}`);
    }

    console.log(`\nResumen: ${rotated} a migrar, ${skipped} ya migradas, ${failed} fallidas.`);
    if (!apply && rotated > 0) console.log('Re-ejecutá con --apply para escribir los cambios.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('rotate-llm-key: error fatal:', err);
  process.exit(1);
});
