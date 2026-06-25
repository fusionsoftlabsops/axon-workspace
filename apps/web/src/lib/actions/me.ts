'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { toBase64 } from '@/lib/crypto';

const GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** Current user's GitHub handle (used to verify repo access). */
export async function getMyGithubLogin(): Promise<string | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const u = await prisma.user.findUnique({ where: { id }, select: { githubLogin: true } });
  return u?.githubLogin ?? null;
}

export async function setGithubLoginAction(
  login: string,
): Promise<{ ok: true; githubLogin: string | null } | { ok: false; error: string }> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return { ok: false, error: 'No autenticado' };
  const value = login.trim().replace(/^@/, '');
  if (value && !GITHUB_LOGIN_RE.test(value)) {
    return { ok: false, error: 'Usuario de GitHub inválido' };
  }
  await prisma.user.update({ where: { id }, data: { githubLogin: value || null } });
  return { ok: true, githubLogin: value || null };
}

export interface SelfKeyMaterial {
  publicKey: string;
  encryptedPrivateKey: string;
  encryptedPrivKeyNonce: string;
  kdfSalt: string;
}

/**
 * Return the current user's protected keypair. The client uses this to
 * unlock the private key in-memory after asking the user for their
 * passphrase. The server never sees the unprotected key.
 */
export async function getSelfKeyMaterial(): Promise<
  { ok: true; data: SelfKeyMaterial } | { ok: false; error: string }
> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return { ok: false, error: 'No autenticado' };

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      publicKey: true,
      encryptedPrivateKey: true,
      encryptedPrivKeyNonce: true,
      kdfSalt: true,
    },
  });
  if (!user) return { ok: false, error: 'Usuario no encontrado' };

  return {
    ok: true,
    data: {
      publicKey: toBase64(new Uint8Array(user.publicKey)),
      encryptedPrivateKey: toBase64(new Uint8Array(user.encryptedPrivateKey)),
      encryptedPrivKeyNonce: toBase64(new Uint8Array(user.encryptedPrivKeyNonce)),
      kdfSalt: toBase64(new Uint8Array(user.kdfSalt)),
    },
  };
}

export interface SelfRecoveryMaterial {
  publicKey: string;
  encryptedPrivKeyRecovery: string;
  recoveryPrivKeyNonce: string;
  recoveryKdfSalt: string;
}

/**
 * Return the current user's recovery blob (private key sealed with the recovery
 * code). The client decrypts it with the recovery code to recover the key when
 * the passphrase is lost. Returns an error if the user never set up recovery.
 */
export async function getSelfRecoveryMaterial(): Promise<
  { ok: true; data: SelfRecoveryMaterial } | { ok: false; error: string }
> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return { ok: false, error: 'No autenticado' };

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      publicKey: true,
      encryptedPrivKeyRecovery: true,
      recoveryPrivKeyNonce: true,
      recoveryKdfSalt: true,
    },
  });
  if (!user) return { ok: false, error: 'Usuario no encontrado' };
  if (!user.encryptedPrivKeyRecovery || !user.recoveryPrivKeyNonce || !user.recoveryKdfSalt) {
    return { ok: false, error: 'Esta cuenta no tiene código de recuperación configurado' };
  }

  return {
    ok: true,
    data: {
      publicKey: toBase64(new Uint8Array(user.publicKey)),
      encryptedPrivKeyRecovery: toBase64(new Uint8Array(user.encryptedPrivKeyRecovery)),
      recoveryPrivKeyNonce: toBase64(new Uint8Array(user.recoveryPrivKeyNonce)),
      recoveryKdfSalt: toBase64(new Uint8Array(user.recoveryKdfSalt)),
    },
  };
}
