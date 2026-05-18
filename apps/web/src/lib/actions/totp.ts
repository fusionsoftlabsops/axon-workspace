'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import {
  buildOtpauthUri,
  generateTotpSecret,
  openTotpSecret,
  sealTotpSecret,
  verifyTotp,
} from '@/lib/auth/totp';

export interface TotpEnrollmentChallenge {
  secret: string;
  otpauthUri: string;
}

/** Start TOTP enrollment: generate a fresh secret and return it for QR rendering. */
export async function beginTotpEnrollment(): Promise<TotpEnrollmentChallenge> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('UNAUTHORIZED');

  const secret = generateTotpSecret();
  return {
    secret,
    otpauthUri: buildOtpauthUri(secret, session.user.email),
  };
}

/**
 * Finish enrollment: the user proves they configured the authenticator
 * correctly by submitting the secret (round-tripped) plus a valid current
 * code. We only persist the encrypted secret after the code verifies.
 */
export async function confirmTotpEnrollment(
  secret: string,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'No autenticado' };
  if (!verifyTotp(secret, code)) return { ok: false, error: 'Código incorrecto' };

  const sealed = sealTotpSecret(secret);
  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      totpSecretEncrypted: Buffer.from(sealed.ciphertext),
      totpNonce: Buffer.from(sealed.nonce),
    },
  });

  revalidatePath('/settings/2fa');
  return { ok: true };
}

/** Disable TOTP (requires a current valid code as proof of possession). */
export async function disableTotp(
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'No autenticado' };

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.totpSecretEncrypted || !user.totpNonce) {
    return { ok: false, error: 'TOTP no está habilitado' };
  }

  const secret = openTotpSecret(user.totpSecretEncrypted, user.totpNonce);
  if (!verifyTotp(secret, code)) return { ok: false, error: 'Código incorrecto' };

  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecretEncrypted: null, totpNonce: null },
  });

  revalidatePath('/settings/2fa');
  return { ok: true };
}
