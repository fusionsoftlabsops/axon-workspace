'use server';

import { timingSafeEqual } from 'node:crypto';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { fromBase64 } from '@/lib/crypto';
import {
  resetPassphraseSchema,
  setRecoveryCodeSchema,
  type ResetPassphraseInput,
  type SetRecoveryCodeInput,
} from '@admin/shared/schemas';
import { audit } from '@/lib/audit';

export type RecoveryActionResult = { ok: true } | { ok: false; error: string };

/** Constant-time compare of two hex strings of equal length. */
function proofMatches(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Reset the vault passphrase using the recovery code. The client has already
 * decrypted the private key with the recovery code and re-sealed it under the
 * new passphrase; here we verify the sha256 proof matches `recoveryHash` and
 * swap in the new passphrase blob. The server never sees the code itself.
 *
 * The public key is intentionally NOT changed, so existing credentials stay
 * decryptable.
 */
export async function resetPassphraseWithRecoveryAction(
  input: ResetPassphraseInput,
): Promise<RecoveryActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'No autenticado' };

  const parsed = resetPassphraseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };
  const data = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { recoveryHash: true },
  });
  if (!user?.recoveryHash) {
    return { ok: false, error: 'Esta cuenta no tiene código de recuperación configurado' };
  }
  if (!proofMatches(user.recoveryHash, data.recoveryHash)) {
    return { ok: false, error: 'Código de recuperación incorrecto' };
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      encryptedPrivateKey: Buffer.from(fromBase64(data.encryptedPrivateKey)),
      encryptedPrivKeyNonce: Buffer.from(fromBase64(data.encryptedPrivKeyNonce)),
      kdfSalt: Buffer.from(fromBase64(data.kdfSalt)),
    },
  });

  await audit({
    actorId: userId,
    action: 'vault.passphrase_reset',
    resourceType: 'user',
    resourceId: userId,
  });

  return { ok: true };
}

/**
 * Regenerate the recovery code. The vault must be unlocked client-side (the
 * client re-seals the private key with a fresh recovery code and sends the new
 * blob + proof). Replaces the previous recovery material.
 */
export async function setRecoveryCodeAction(
  input: SetRecoveryCodeInput,
): Promise<RecoveryActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'No autenticado' };

  const parsed = setRecoveryCodeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };
  const data = parsed.data;

  await prisma.user.update({
    where: { id: userId },
    data: {
      recoveryHash: data.recoveryHash,
      encryptedPrivKeyRecovery: Buffer.from(fromBase64(data.encryptedPrivKeyRecovery)),
      recoveryPrivKeyNonce: Buffer.from(fromBase64(data.recoveryPrivKeyNonce)),
      recoveryKdfSalt: Buffer.from(fromBase64(data.recoveryKdfSalt)),
    },
  });

  await audit({
    actorId: userId,
    action: 'vault.recovery_code_regenerated',
    resourceType: 'user',
    resourceId: userId,
  });

  return { ok: true };
}
