'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { createInvitationSchema, type CreateInvitationInput } from '@admin/shared/schemas';
import { audit } from '@/lib/audit';
import { hashInviteToken } from '@/lib/invite-token';

const INVITE_TTL_DAYS = 7;

/** Only the master (super-admin) user may manage invitations. */
async function requireMaster(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id || !session.user.isMasterUser) return null;
  return session.user.id;
}

export interface InvitationView {
  id: string;
  email: string;
  invitedByName: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  expired: boolean;
  createdAt: string;
}

/** Validate a plaintext invite token. Returns the invited email or null. */
export async function getInvitationByToken(
  token: string,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  if (!token) return { ok: false, error: 'Falta el token de invitación' };
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: { email: true, acceptedAt: true, expiresAt: true },
  });
  if (!inv) return { ok: false, error: 'Invitación inválida' };
  if (inv.acceptedAt) return { ok: false, error: 'Esta invitación ya fue usada' };
  if (inv.expiresAt.getTime() < Date.now()) return { ok: false, error: 'La invitación expiró' };
  return { ok: true, email: inv.email };
}

export async function createInvitationAction(
  input: CreateInvitationInput,
): Promise<
  { ok: true; data: { email: string; token: string; expiresAt: string } } | { ok: false; error: string }
> {
  const masterId = await requireMaster();
  if (!masterId) return { ok: false, error: 'Solo el super-admin puede invitar' };

  const parsed = createInvitationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Email inválido' };
  const email = parsed.data.email.toLowerCase().trim();

  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) return { ok: false, error: 'Ya existe una cuenta con ese email' };

  // Supersede any prior pending invite for the same email.
  await prisma.invitation.deleteMany({ where: { email, acceptedAt: null } });

  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
  await prisma.invitation.create({
    data: { email, tokenHash: hashInviteToken(token), invitedById: masterId, expiresAt },
  });

  await audit({
    actorId: masterId,
    action: 'invitation.create',
    resourceType: 'invitation',
    resourceId: email,
    payload: { email },
  });

  revalidatePath('/settings/invitations');
  return { ok: true, data: { email, token, expiresAt: expiresAt.toISOString() } };
}

export async function listInvitationsAction(): Promise<
  { ok: true; data: InvitationView[] } | { ok: false; error: string }
> {
  const masterId = await requireMaster();
  if (!masterId) return { ok: false, error: 'No autorizado' };

  const rows = await prisma.invitation.findMany({
    orderBy: { createdAt: 'desc' },
    include: { invitedBy: { select: { name: true } } },
  });
  const now = Date.now();
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      email: r.email,
      invitedByName: r.invitedBy?.name ?? null,
      expiresAt: r.expiresAt.toISOString(),
      acceptedAt: r.acceptedAt?.toISOString() ?? null,
      expired: !r.acceptedAt && r.expiresAt.getTime() < now,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function revokeInvitationAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const masterId = await requireMaster();
  if (!masterId) return { ok: false, error: 'No autorizado' };

  await prisma.invitation.deleteMany({ where: { id, acceptedAt: null } });
  await audit({
    actorId: masterId,
    action: 'invitation.revoke',
    resourceType: 'invitation',
    resourceId: id,
  });
  revalidatePath('/settings/invitations');
  return { ok: true };
}
