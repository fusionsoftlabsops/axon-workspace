'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { toBase64 } from '@/lib/crypto';

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
