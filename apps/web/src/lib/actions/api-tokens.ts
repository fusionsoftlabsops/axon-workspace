'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { generateApiToken } from '@/lib/api-auth';
import { createApiTokenSchema, type CreateApiTokenInput } from '@admin/shared/schemas';

export async function createApiTokenAction(
  input: CreateApiTokenInput,
): Promise<{ ok: true; plainToken: string; prefix: string } | { ok: false; error: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'No autenticado' };

  const parsed = createApiTokenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };

  // If projectSlugs is given, validate the user is actually a member of each.
  if (parsed.data.projectSlugs && parsed.data.projectSlugs.length > 0) {
    const valid = await prisma.project.count({
      where: {
        slug: { in: parsed.data.projectSlugs },
        members: { some: { userId } },
      },
    });
    if (valid !== parsed.data.projectSlugs.length) {
      return { ok: false, error: 'Algunos proyectos no son tuyos' };
    }
  }

  const { plain, hash, prefix } = generateApiToken();

  const created = await prisma.apiToken.create({
    data: {
      userId,
      name: parsed.data.name,
      tokenHash: hash,
      prefix,
      scopes: parsed.data.scopes,
      projectSlugs: parsed.data.projectSlugs ?? [],
      expiresAt: parsed.data.expiresAt,
    },
  });

  await audit({
    actorId: userId,
    action: 'api_token.create',
    resourceType: 'api_token',
    resourceId: created.id,
    payload: { name: created.name, scopes: created.scopes },
  });

  revalidatePath('/settings/tokens');
  return { ok: true, plainToken: plain, prefix };
}

export async function revokeApiTokenAction(
  tokenId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'No autenticado' };

  const token = await prisma.apiToken.findUnique({ where: { id: tokenId } });
  if (!token || token.userId !== userId) {
    return { ok: false, error: 'Token no encontrado' };
  }

  await prisma.apiToken.update({
    where: { id: tokenId },
    data: { revokedAt: new Date() },
  });

  await audit({
    actorId: userId,
    action: 'api_token.revoke',
    resourceType: 'api_token',
    resourceId: tokenId,
  });

  revalidatePath('/settings/tokens');
  return { ok: true };
}
