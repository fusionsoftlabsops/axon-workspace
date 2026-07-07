import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { VaultClient } from './VaultClient';

export default async function VaultPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const project = await prisma.project.findUnique({
    where: { slug },
    select: {
      id: true,
      members: { where: { userId }, select: { role: true } },
    },
  });
  if (!project || project.members.length === 0) notFound();

  const role = project.members[0]!.role;
  const isAdmin = role === 'OWNER' || role === 'ADMIN';

  // Los usuarios federados (SSO) arrancan sin vault: la UI ofrece inicializarlo
  // en vez de pedir una passphrase que no existe.
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { publicKey: true } });
  const hasVault = Boolean(me?.publicKey);

  // List ONLY the credentials this user has access to.
  const credentials = await prisma.credential.findMany({
    where: {
      projectId: project.id,
      access: { some: { userId } },
    },
    select: {
      id: true,
      name: true,
      type: true,
      metadataPublic: true,
      createdAt: true,
      createdById: true,
      needsRotation: true,
      access: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
    orderBy: { name: 'asc' },
  });

  return (
    <VaultClient
      projectSlug={slug}
      currentUserId={userId}
      isAdmin={isAdmin}
      hasVault={hasVault}
      canCreate={role !== 'VIEWER'}
      credentials={credentials.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        metadataPublic: (c.metadataPublic ?? null) as Record<string, string> | null,
        createdAt: c.createdAt.toISOString(),
        createdById: c.createdById,
        needsRotation: c.needsRotation,
        access: c.access.map((a) => ({
          userId: a.userId,
          name: a.user.name,
          email: a.user.email,
        })),
      }))}
    />
  );
}
