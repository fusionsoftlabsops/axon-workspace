'use server';

import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { hashInviteToken } from '@/lib/invite-token';
import { sendMail } from '@/lib/mailer';
import { env } from '@/lib/env';
import { audit } from '@/lib/audit';
import {
  requestPasswordResetSchema,
  resetPasswordSchema,
  type RequestPasswordResetInput,
  type ResetPasswordInput,
} from '@admin/shared/schemas';

export type ResetActionResult = { ok: true } | { ok: false; error: string };

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const REQUEST_WINDOW_MS = 15 * 60 * 1000; // throttle window
const MAX_REQUESTS_PER_WINDOW = 3;

/**
 * Request a login-password reset link. Always returns ok (anti-enumeration):
 * whether or not the email exists, the caller gets the same response. If the
 * account exists, a one-time token is created and emailed.
 *
 * This resets ONLY the server login password — it does NOT touch the E2E vault,
 * which is encrypted under a separate passphrase and recoverable via the
 * recovery code. (Login password and vault passphrase are distinct secrets.)
 */
export async function requestPasswordResetAction(
  input: RequestPasswordResetInput,
): Promise<ResetActionResult> {
  const parsed = requestPasswordResetSchema.safeParse(input);
  // Even on invalid input we keep the response uniform to avoid enumeration,
  // but a malformed email can't match anything, so just return ok.
  if (!parsed.success) return { ok: true };

  const email = parsed.data.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return { ok: true };

  // Basic throttle: cap reset requests per user per window.
  const recent = await prisma.passwordResetToken.count({
    where: { userId: user.id, createdAt: { gt: new Date(Date.now() - REQUEST_WINDOW_MS) } },
  });
  if (recent >= MAX_REQUESTS_PER_WINDOW) return { ok: true };

  const token = randomBytes(24).toString('base64url');
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashInviteToken(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  const base = env().AUTH_URL?.replace(/\/+$/, '');
  if (base) {
    const link = `${base}/reset-password?token=${token}`;
    await sendMail({
      to: email,
      subject: 'Restablecer tu contraseña de Axon',
      html:
        `<p>Recibimos una solicitud para restablecer tu contraseña de login en Axon.</p>` +
        `<p>Usá este enlace (válido 1 hora, un solo uso): <a href="${link}">${link}</a></p>` +
        `<p>Si no fuiste vos, ignorá este correo. Tu vault de credenciales no se ve afectado: ` +
        `se recupera aparte con tu código de recuperación.</p>`,
      text:
        `Restablecé tu contraseña de login en Axon (válido 1 hora): ${link}\n` +
        `Si no fuiste vos, ignorá este correo. Tu vault no se ve afectado (se recupera con tu código de recuperación).`,
    });
  }

  await audit({
    actorId: user.id,
    action: 'auth.password_reset_request',
    resourceType: 'user',
    resourceId: user.id,
  });

  return { ok: true };
}

/**
 * Complete a login-password reset using a token from the email. Updates only the
 * argon2 `passwordHash`; the vault stays sealed under its own passphrase.
 */
export async function resetPasswordAction(input: ResetPasswordInput): Promise<ResetActionResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'La contraseña debe tener al menos 12 caracteres' };
  }

  const tokenHash = hashInviteToken(parsed.data.token);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: 'Enlace inválido o expirado. Solicitá uno nuevo.' };
  }

  const passwordHash = await hashPassword(parsed.data.password);

  await prisma.$transaction(async (tx) => {
    // Consume the token only if still unused (guards against double submit).
    const consumed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count === 0) throw new Error('TOKEN_ALREADY_USED');
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    // Invalidate any other outstanding reset tokens for this user.
    await tx.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: new Date() },
    });
  });

  await audit({
    actorId: record.userId,
    action: 'auth.password_reset',
    resourceType: 'user',
    resourceId: record.userId,
  });

  return { ok: true };
}
