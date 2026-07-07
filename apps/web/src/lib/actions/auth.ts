'use server';

import { redirect } from 'next/navigation';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { fromBase64 } from '@/lib/crypto';
import { hashInviteToken } from '@/lib/invite-token';
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

  // Registration is invite-only: require a valid, unexpired, unaccepted invite.
  // The account email is taken from the invitation (authoritative), not the
  // client-provided email.
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashInviteToken(data.token) },
    select: { id: true, email: true, acceptedAt: true, expiresAt: true },
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: 'Invitación inválida, expirada o ya usada' };
  }
  const email = invitation.email.toLowerCase().trim();

  try {
    const passwordHash = await hashPassword(data.password);

    // Create the user and consume the invitation atomically. Invited users are
    // regular members (never master — the super-admin is seeded separately).
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
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
          isMasterUser: false,
        },
      });
      // Guard against a race: only consume if still unaccepted.
      const consumed = await tx.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (consumed.count === 0) throw new Error('INVITE_ALREADY_USED');

      // Auto-join any project-scoped invitations for this email (incl. the one
      // just consumed) so invited collaborators land in their project on signup.
      const projInvites = await tx.invitation.findMany({
        where: { email, projectId: { not: null } },
        select: { id: true, projectId: true, projectRole: true, seniority: true },
      });
      for (const pi of projInvites) {
        if (!pi.projectId || !pi.projectRole) continue;
        await tx.projectMember.createMany({
          data: { projectId: pi.projectId, userId: user.id, role: pi.projectRole, seniority: pi.seniority },
          skipDuplicates: true,
        });
      }
      await tx.invitation.updateMany({
        where: { email, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
    });

    return { ok: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, error: 'Ya existe una cuenta con ese email' };
    }
    if (err instanceof Error && err.message === 'INVITE_ALREADY_USED') {
      return { ok: false, error: 'Esta invitación ya fue usada' };
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

/**
 * Inicia el login federado por OIDC (Authentik). `signIn` lanza el redirect al
 * IdP (throw NEXT_REDIRECT), por eso esta acción no retorna: la navegación la
 * maneja Auth.js. Se usa como `action` de un <form> en la página de login, y
 * solo se muestra si el SSO está configurado (`isOidcConfigured`).
 */
export async function ssoLoginAction(): Promise<void> {
  await signIn('authentik', { redirectTo: '/projects' });
}

export async function logoutAction(): Promise<void> {
  const { signOut } = await import('@/auth');
  await signOut({ redirect: false });
  redirect('/login');
}
