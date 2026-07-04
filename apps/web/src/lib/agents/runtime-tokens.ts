/**
 * Distribución de tokens de agente al worker multi-tenant.
 *
 * El `ApiToken` guarda solo el hash (sha256) para AUTENTICAR — irrecuperable.
 * Para que un worker que atiende a TODOS los proyectos pueda actuar como cada
 * agente, sellamos el token plano en reposo (XSalsa20-Poly1305 con la clave
 * server `AUTH_LLM_KEY`, mismo patrón que las credenciales LLM) en
 * `AgentRuntimeToken`. Solo el endpoint privilegiado /internal/agent-runtime lo
 * abre, y solo para el token de servicio del worker.
 */
import type { AgentRole } from '@prisma/client';
import {
  randomBytes,
  SECRETBOX_NONCE_BYTES,
  secretboxOpen,
  secretboxSeal,
  textToBytes,
  bytesToText,
  fromBase64,
} from '@/lib/crypto';
import { env } from '@/lib/env';
import { prisma } from '@/lib/db';

function serverKey(): Uint8Array {
  const e = env();
  const key = e.AUTH_LLM_KEY ?? e.AUTH_TOTP_KEY;
  if (!key) {
    throw new Error('AUTH_LLM_KEY (o AUTH_TOTP_KEY) requerido para sellar tokens de agente.');
  }
  const bytes = fromBase64(key);
  if (bytes.length !== 32) throw new Error('La clave de sellado debe decodificar a 32 bytes.');
  return bytes;
}

/** Sella (upsert) el token plano de un agente para (proyecto, rol). Idempotente. */
export async function sealAgentToken(
  projectId: string,
  role: AgentRole,
  plainToken: string,
): Promise<void> {
  const nonce = randomBytes(SECRETBOX_NONCE_BYTES);
  const sealed = secretboxSeal(textToBytes(plainToken), nonce, serverKey());
  const data = {
    sealed: Buffer.from(sealed),
    nonce: Buffer.from(nonce),
    keyPrefix: plainToken.slice(0, 12),
  };
  await prisma.agentRuntimeToken.upsert({
    where: { projectId_role: { projectId, role } },
    update: data,
    create: { projectId, role, ...data },
  });
}

/** Abre el token plano de un agente (solo en el server, justo antes de entregarlo). */
export function openAgentToken(row: {
  sealed: Buffer | Uint8Array;
  nonce: Buffer | Uint8Array;
}): string {
  const plain = secretboxOpen(new Uint8Array(row.sealed), new Uint8Array(row.nonce), serverKey());
  return bytesToText(plain);
}
