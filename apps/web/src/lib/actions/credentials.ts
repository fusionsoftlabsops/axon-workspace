'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { fromBase64, toBase64 } from '@/lib/crypto';
import {
  createCredentialSchema,
  type CreateCredentialInput,
} from '@admin/shared/schemas';
import { audit } from '@/lib/audit';
import type { ActionResult } from './projects';

type Ctx = { ok: true; projectId: string; userId: string; role: string } | { ok: false; error: string };

async function ctx(projectSlug: string): Promise<Ctx> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'No autenticado' };
  const project = await prisma.project.findUnique({
    where: { slug: projectSlug },
    select: { id: true, members: { where: { userId }, select: { role: true } } },
  });
  if (!project || project.members.length === 0) {
    return { ok: false, error: 'Proyecto no encontrado' };
  }
  return { ok: true, projectId: project.id, userId, role: project.members[0]!.role };
}

/**
 * Persist an encrypted credential. The server stores the ciphertext, nonce
 * and one wrapped DEK per recipient — it never sees the plaintext or the
 * unwrapped DEK.
 */
export async function createCredentialAction(
  projectSlug: string,
  input: CreateCredentialInput,
): Promise<ActionResult<{ id: string }>> {
  const c = await ctx(projectSlug);
  if (!c.ok) return { ok: false, error: c.error };
  if (c.role === 'VIEWER') return { ok: false, error: 'Sin permisos para crear credenciales' };

  const parsed = createCredentialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };
  const data = parsed.data;

  // Make sure every grantee is actually a member of this project.
  const memberIds = await prisma.projectMember.findMany({
    where: { projectId: c.projectId, userId: { in: data.access.map((a) => a.userId) } },
    select: { userId: true },
  });
  const memberSet = new Set(memberIds.map((m) => m.userId));
  for (const a of data.access) {
    if (!memberSet.has(a.userId)) {
      return { ok: false, error: 'Hay destinatarios que no son miembros del proyecto' };
    }
  }

  const created = await prisma.credential.create({
    data: {
      projectId: c.projectId,
      name: data.name,
      type: data.type,
      ciphertext: Buffer.from(fromBase64(data.ciphertext)),
      nonce: Buffer.from(fromBase64(data.nonce)),
      metadataPublic:
        data.metadataPublic && Object.keys(data.metadataPublic).length > 0
          ? (data.metadataPublic as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      createdById: c.userId,
      access: {
        create: data.access.map((a) => ({
          userId: a.userId,
          wrappedDek: Buffer.from(fromBase64(a.wrappedDek)),
          grantedById: c.userId,
        })),
      },
    },
  });

  await audit({
    actorId: c.userId,
    action: 'credential.create',
    resourceType: 'credential',
    resourceId: created.id,
    projectId: c.projectId,
    payload: { name: data.name, type: data.type, sharedWith: data.access.length },
  });

  revalidatePath(`/projects/${projectSlug}/vault`);
  return { ok: true, data: { id: created.id } };
}

export interface CredentialEncryptedResponse {
  id: string;
  name: string;
  type: string;
  ciphertext: string; // base64url
  nonce: string;
  wrappedDek: string;
  createdAt: string;
}

/**
 * Return a credential the user is allowed to access (server returns the
 * encrypted blob + the user's wrapped DEK).
 */
export async function getCredentialAction(
  projectSlug: string,
  credentialId: string,
): Promise<{ ok: true; data: CredentialEncryptedResponse } | { ok: false; error: string }> {
  const c = await ctx(projectSlug);
  if (!c.ok) return { ok: false, error: c.error };

  const cred = await prisma.credential.findFirst({
    where: { id: credentialId, projectId: c.projectId },
    include: { access: { where: { userId: c.userId } } },
  });
  if (!cred || cred.access.length === 0) {
    return { ok: false, error: 'Credencial no encontrada o sin acceso' };
  }

  await audit({
    actorId: c.userId,
    action: 'credential.read',
    resourceType: 'credential',
    resourceId: cred.id,
    projectId: c.projectId,
  });

  return {
    ok: true,
    data: {
      id: cred.id,
      name: cred.name,
      type: cred.type,
      ciphertext: toBase64(new Uint8Array(cred.ciphertext)),
      nonce: toBase64(new Uint8Array(cred.nonce)),
      wrappedDek: toBase64(new Uint8Array(cred.access[0]!.wrappedDek)),
      createdAt: cred.createdAt.toISOString(),
    },
  };
}

/**
 * Grant another member access to an existing credential. The CALLER must
 * already hold access (have unwrapped the DEK in their browser), re-wrap
 * the DEK for the recipient's public key, and POST the new wrapped DEK.
 */
export async function shareCredentialAction(
  projectSlug: string,
  credentialId: string,
  recipientUserId: string,
  wrappedDekB64: string,
): Promise<ActionResult> {
  const c = await ctx(projectSlug);
  if (!c.ok) return { ok: false, error: c.error };
  if (c.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const cred = await prisma.credential.findFirst({
    where: { id: credentialId, projectId: c.projectId },
    include: { access: { where: { userId: c.userId }, select: { id: true } } },
  });
  if (!cred || cred.access.length === 0) {
    return { ok: false, error: 'No tienes acceso a esta credencial' };
  }

  const recipientIsMember = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: c.projectId, userId: recipientUserId } },
    select: { userId: true },
  });
  if (!recipientIsMember) return { ok: false, error: 'Destinatario no es miembro' };

  try {
    await prisma.credentialAccess.create({
      data: {
        credentialId,
        userId: recipientUserId,
        wrappedDek: Buffer.from(fromBase64(wrappedDekB64)),
        grantedById: c.userId,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, error: 'Ese miembro ya tiene acceso' };
    }
    throw err;
  }

  await audit({
    actorId: c.userId,
    action: 'credential.share',
    resourceType: 'credential',
    resourceId: credentialId,
    projectId: c.projectId,
    payload: { recipientUserId },
  });

  revalidatePath(`/projects/${projectSlug}/vault`);
  return { ok: true };
}

/** Revoke a member's access. The credential should be rotated afterwards. */
export async function revokeCredentialAccessAction(
  projectSlug: string,
  credentialId: string,
  userId: string,
): Promise<ActionResult> {
  const c = await ctx(projectSlug);
  if (!c.ok) return { ok: false, error: c.error };
  if (c.role !== 'OWNER' && c.role !== 'ADMIN') {
    return { ok: false, error: 'Solo OWNER/ADMIN puede revocar' };
  }

  const cred = await prisma.credential.findFirst({
    where: { id: credentialId, projectId: c.projectId },
    select: { id: true, createdById: true },
  });
  if (!cred) return { ok: false, error: 'Credencial no encontrada' };

  // Refuse to remove the creator's own access (would orphan the credential).
  if (userId === cred.createdById) {
    return {
      ok: false,
      error: 'No se puede revocar el acceso del creador. Elimina la credencial en su lugar.',
    };
  }

  await prisma.credentialAccess.deleteMany({
    where: { credentialId: cred.id, userId },
  });

  // El revocado pudo haber cacheado el DEK en su browser: marcar la credencial
  // como pendiente de rotación hasta que se re-cifre.
  await prisma.credential.update({
    where: { id: cred.id },
    data: { needsRotation: true },
  });

  await audit({
    actorId: c.userId,
    action: 'credential.revoke',
    resourceType: 'credential',
    resourceId: cred.id,
    projectId: c.projectId,
    payload: { revokedUserId: userId },
  });

  revalidatePath(`/projects/${projectSlug}/vault`);
  return { ok: true };
}

export async function deleteCredentialAction(
  projectSlug: string,
  credentialId: string,
): Promise<ActionResult> {
  const c = await ctx(projectSlug);
  if (!c.ok) return { ok: false, error: c.error };
  if (c.role !== 'OWNER' && c.role !== 'ADMIN') {
    return { ok: false, error: 'Solo OWNER/ADMIN puede eliminar' };
  }

  const cred = await prisma.credential.findFirst({
    where: { id: credentialId, projectId: c.projectId },
    select: { id: true },
  });
  if (!cred) return { ok: false, error: 'Credencial no encontrada' };

  await prisma.credential.delete({ where: { id: cred.id } });
  await audit({
    actorId: c.userId,
    action: 'credential.delete',
    resourceType: 'credential',
    resourceId: cred.id,
    projectId: c.projectId,
  });
  revalidatePath(`/projects/${projectSlug}/vault`);
  return { ok: true };
}

/**
 * Rotate a credential: replace its ciphertext (re-encrypted client-side with a
 * fresh DEK) and rewrap the DEK for the CURRENT access holders only. This
 * invalidates any DEK a revoked member may have cached. The caller must hold
 * access (they need the plaintext to re-encrypt). Clears `needsRotation`.
 */
export async function rotateCredentialAction(
  projectSlug: string,
  credentialId: string,
  payload: {
    ciphertext: string;
    nonce: string;
    access: Array<{ userId: string; wrappedDek: string }>;
  },
): Promise<ActionResult> {
  const c = await ctx(projectSlug);
  if (!c.ok) return { ok: false, error: c.error };
  if (c.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const cred = await prisma.credential.findFirst({
    where: { id: credentialId, projectId: c.projectId },
    include: { access: { where: { userId: c.userId }, select: { id: true } } },
  });
  if (!cred || cred.access.length === 0) {
    return { ok: false, error: 'No tienes acceso a esta credencial' };
  }
  if (payload.access.length === 0) {
    return { ok: false, error: 'La rotación requiere al menos un destinatario' };
  }

  // Todos los destinatarios deben ser miembros del proyecto.
  const memberIds = await prisma.projectMember.findMany({
    where: { projectId: c.projectId, userId: { in: payload.access.map((a) => a.userId) } },
    select: { userId: true },
  });
  const memberSet = new Set(memberIds.map((m) => m.userId));
  for (const a of payload.access) {
    if (!memberSet.has(a.userId)) {
      return { ok: false, error: 'Hay destinatarios que no son miembros del proyecto' };
    }
  }

  // Reemplazar el acceso y el ciphertext atómicamente.
  await prisma.$transaction([
    prisma.credentialAccess.deleteMany({ where: { credentialId } }),
    prisma.credential.update({
      where: { id: credentialId },
      data: {
        ciphertext: Buffer.from(fromBase64(payload.ciphertext)),
        nonce: Buffer.from(fromBase64(payload.nonce)),
        rotatedAt: new Date(),
        needsRotation: false,
        access: {
          create: payload.access.map((a) => ({
            userId: a.userId,
            wrappedDek: Buffer.from(fromBase64(a.wrappedDek)),
            grantedById: c.userId,
          })),
        },
      },
    }),
  ]);

  await audit({
    actorId: c.userId,
    action: 'credential.rotate',
    resourceType: 'credential',
    resourceId: credentialId,
    projectId: c.projectId,
    payload: { recipients: payload.access.length },
  });

  revalidatePath(`/projects/${projectSlug}/vault`);
  return { ok: true };
}

/**
 * Get the public keys of every project member, so the caller can re-wrap a
 * DEK when sharing a credential.
 */
export async function getProjectMemberKeys(
  projectSlug: string,
): Promise<
  | { ok: true; data: Array<{ userId: string; name: string; email: string; publicKey: string }> }
  | { ok: false; error: string }
> {
  const c = await ctx(projectSlug);
  if (!c.ok) return { ok: false, error: c.error };

  const members = await prisma.projectMember.findMany({
    where: { projectId: c.projectId },
    include: { user: { select: { id: true, name: true, email: true, publicKey: true } } },
  });
  return {
    ok: true,
    // Los miembros federados sin vault (publicKey null) se OMITEN: no se les
    // puede envolver un DEK hasta que inicialicen su vault. Evita generar una
    // publicKey basura y degrada con gracia el compartir de credenciales.
    data: members
      .filter((m) => m.user.publicKey != null)
      .map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        publicKey: toBase64(new Uint8Array(m.user.publicKey!)),
      })),
  };
}
