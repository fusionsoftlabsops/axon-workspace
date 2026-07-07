'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { fromBase64 } from '@/lib/crypto';
import { initVaultSchema, type InitVaultInput } from '@admin/shared/schemas';
import { audit } from '@/lib/audit';

export type InitVaultResult = { ok: true } | { ok: false; error: string };

/**
 * Inicializa el vault E2E de un usuario federado (SSO) que aún no lo tiene.
 *
 * Zero-knowledge idéntico al signup: el cliente genera el keypair, deriva el
 * KEK de la passphrase y sella la private key ANTES de llamar; el servidor solo
 * persiste el material cifrado y NUNCA ve la passphrase (reusa la misma
 * maquinaria de `generateProtectedKeypairWithRecovery`).
 *
 * Solo escribe si el usuario NO tiene vault todavía (publicKey null); nunca
 * sobrescribe un vault existente (eso rompería credenciales ya cifradas).
 */
export async function initVaultAction(input: InitVaultInput): Promise<InitVaultResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'No autenticado' };

  const parsed = initVaultSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };
  const data = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { publicKey: true },
  });
  if (!user) return { ok: false, error: 'Usuario no encontrado' };
  if (user.publicKey) return { ok: false, error: 'El vault ya está inicializado' };

  await prisma.user.update({
    where: { id: userId },
    data: {
      publicKey: Buffer.from(fromBase64(data.publicKey)),
      encryptedPrivateKey: Buffer.from(fromBase64(data.encryptedPrivateKey)),
      encryptedPrivKeyNonce: Buffer.from(fromBase64(data.encryptedPrivKeyNonce)),
      kdfSalt: Buffer.from(fromBase64(data.kdfSalt)),
      recoveryHash: data.recoveryHash,
      encryptedPrivKeyRecovery: Buffer.from(fromBase64(data.encryptedPrivKeyRecovery)),
      recoveryPrivKeyNonce: Buffer.from(fromBase64(data.recoveryPrivKeyNonce)),
      recoveryKdfSalt: Buffer.from(fromBase64(data.recoveryKdfSalt)),
    },
  });

  await audit({
    actorId: userId,
    action: 'vault.initialized',
    resourceType: 'user',
    resourceId: userId,
  });

  return { ok: true };
}
