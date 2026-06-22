/**
 * LLM credential storage with server-side encryption.
 *
 * Trade-off narrow zero-knowledge: el server necesita la API key en claro
 * cuando invoca el LLM, así que NO usamos el vault E2E aquí. En su lugar
 * sellamos con `AUTH_LLM_KEY` (XSalsa20-Poly1305 + nonce per-key). Un dump de
 * DB sin acceso al server key no revela los secretos.
 *
 * `AUTH_LLM_KEY` es una clave DEDICADA, separada de `AUTH_TOTP_KEY`, para que
 * filtrar una no comprometa la otra (LLM keys vs. secretos 2FA). Por
 * compatibilidad, si `AUTH_LLM_KEY` no está seteada caemos a `AUTH_TOTP_KEY`
 * (las credenciales legadas se sellaron con esa); usar `scripts/rotate-llm-key.mjs`
 * para migrarlas a la clave nueva.
 */
import type { LlmCredential, LlmProvider } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  fromBase64,
  randomBytes,
  SECRETBOX_NONCE_BYTES,
  secretboxOpen,
  secretboxSeal,
} from '@/lib/crypto';
import { textToBytes, bytesToText } from '@/lib/crypto';
import { env } from '@/lib/env';
import { prisma } from '@/lib/db';

function getServerKey(): Uint8Array {
  const e = env();
  // Preferir la clave dedicada; caer a AUTH_TOTP_KEY para credenciales legadas.
  const key = e.AUTH_LLM_KEY ?? e.AUTH_TOTP_KEY;
  const source = e.AUTH_LLM_KEY ? 'AUTH_LLM_KEY' : 'AUTH_TOTP_KEY';
  if (!key) {
    throw new Error(
      'AUTH_LLM_KEY (o AUTH_TOTP_KEY) no está configurado: requerido para sellar credenciales LLM.',
    );
  }
  const bytes = fromBase64(key);
  if (bytes.length !== 32) {
    throw new Error(`${source} debe decodificar a exactamente 32 bytes.`);
  }
  return bytes;
}

export interface CreateLlmCredentialInput {
  userId: string;
  projectId?: string | null;
  provider: LlmProvider;
  label: string;
  plainKey: string;
  modelDefault?: string | null;
}

export async function createLlmCredential(
  input: CreateLlmCredentialInput,
): Promise<LlmCredential> {
  const serverKey = getServerKey();
  const nonce = randomBytes(SECRETBOX_NONCE_BYTES);
  const ciphertext = secretboxSeal(textToBytes(input.plainKey), nonce, serverKey);

  const keyPrefix = input.plainKey.slice(0, 8);

  return prisma.llmCredential.create({
    data: {
      userId: input.userId,
      projectId: input.projectId ?? null,
      provider: input.provider,
      label: input.label.trim().slice(0, 80) || 'sin etiqueta',
      encryptedKey: Buffer.from(ciphertext),
      nonce: Buffer.from(nonce),
      keyPrefix,
      modelDefault: input.modelDefault?.trim() || null,
    },
  });
}

/**
 * Descifra y devuelve la API key en claro. Solo usar inmediatamente
 * antes de invocar al LLM; nunca persistir el resultado.
 */
export function decryptLlmCredentialKey(cred: {
  encryptedKey: Buffer | Uint8Array;
  nonce: Buffer | Uint8Array;
}): string {
  const serverKey = getServerKey();
  const plain = secretboxOpen(
    new Uint8Array(cred.encryptedKey),
    new Uint8Array(cred.nonce),
    serverKey,
  );
  return bytesToText(plain);
}

/**
 * Marca `lastUsedAt` después de una invocación exitosa. No bloqueante:
 * el caller no debe esperar este update.
 */
export function touchLlmCredential(credentialId: string): void {
  prisma.llmCredential
    .update({
      where: { id: credentialId },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {
      /* best-effort */
    });
}

export async function listLlmCredentialsForUser(
  userId: string,
  opts: { projectId?: string; includeRevoked?: boolean } = {},
): Promise<Array<Omit<LlmCredential, 'encryptedKey' | 'nonce'>>> {
  const where: Prisma.LlmCredentialWhereInput = {
    userId,
    ...(opts.projectId ? { OR: [{ projectId: opts.projectId }, { projectId: null }] } : {}),
    ...(opts.includeRevoked ? {} : { revokedAt: null }),
  };
  const rows = await prisma.llmCredential.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      userId: true,
      projectId: true,
      provider: true,
      label: true,
      keyPrefix: true,
      modelDefault: true,
      lastUsedAt: true,
      createdAt: true,
      revokedAt: true,
    },
  });
  return rows;
}

export async function revokeLlmCredential(
  userId: string,
  credentialId: string,
): Promise<{ ok: boolean }> {
  const cred = await prisma.llmCredential.findUnique({
    where: { id: credentialId },
    select: { userId: true, revokedAt: true },
  });
  if (!cred || cred.userId !== userId) return { ok: false };
  if (cred.revokedAt) return { ok: true };
  await prisma.llmCredential.update({
    where: { id: credentialId },
    data: { revokedAt: new Date() },
  });
  return { ok: true };
}
