'use server';

import { redirect } from 'next/navigation';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { fromBase64 } from '@/lib/crypto';
import { signupSchema, type SignupInput } from '@admin/shared/schemas';
import { signIn } from '@/auth';

export type SignupActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Register a new user. The client must already have generated the X25519
 * keypair, derived the KEK from the passphrase, and encrypted the private
 * key. We never see the passphrase or the unprotected private key.
 */
export async function signupAction(input: SignupInput): Promise<SignupActionResult> {
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Datos inválidos',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join('.'), i.message]),
      ),
    };
  }

  const data = parsed.data;
  const existing = await prisma.user.count();
  const isFirstUser = existing === 0;

  try {
    const passwordHash = await hashPassword(data.password);

    await prisma.user.create({
      data: {
        email: data.email.toLowerCase().trim(),
        name: data.name.trim(),
        passwordHash,
        publicKey: Buffer.from(fromBase64(data.publicKey)),
        encryptedPrivateKey: Buffer.from(fromBase64(data.encryptedPrivateKey)),
        encryptedPrivKeyNonce: Buffer.from(fromBase64(data.encryptedPrivKeyNonce)),
        kdfSalt: Buffer.from(fromBase64(data.kdfSalt)),
        recoveryHash: data.recoveryHash,
        encryptedPrivKeyRecovery: Buffer.from(fromBase64(data.encryptedPrivKeyRecovery)),
        recoveryPrivKeyNonce: Buffer.from(fromBase64(data.recoveryPrivKeyNonce)),
        recoveryKdfSalt: Buffer.from(fromBase64(data.recoveryKdfSalt)),
        isMasterUser: isFirstUser,
      },
    });

    return { ok: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, error: 'Ya existe una cuenta con ese email' };
    }
    throw err;
  }
}

export type LoginActionResult =
  | { ok: true }
  | { ok: false; error: 'INVALID' | 'TOTP_REQUIRED' };

/**
 * Submit login credentials. If the user has TOTP enrolled and the code is
 * missing, returns `TOTP_REQUIRED` so the UI can show the TOTP input.
 */
export async function loginAction(
  email: string,
  password: string,
  totp?: string,
): Promise<LoginActionResult> {
  try {
    // Auth.js Credentials only ships fields with truthy values to authorize,
    // and our loginSchema rejects an empty string for totp (regex ^\d{6}$).
    // Omit the field entirely when the user has no TOTP code to submit.
    const credentials: Record<string, string> = { email, password };
    if (totp) credentials.totp = totp;

    await signIn('credentials', { ...credentials, redirect: false });
    return { ok: true };
  } catch (err) {
    const cause = err instanceof Error ? err.message : '';
    if (cause.includes('TOTP_REQUIRED')) return { ok: false, error: 'TOTP_REQUIRED' };
    return { ok: false, error: 'INVALID' };
  }
}

export async function logoutAction(): Promise<void> {
  const { signOut } = await import('@/auth');
  await signOut({ redirect: false });
  redirect('/login');
}
