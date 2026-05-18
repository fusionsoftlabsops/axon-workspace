import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { MembersPanel } from './MembersPanel';
import { RepoSettingsPanel } from './RepoSettingsPanel';

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user?.id) return null;

  const project = await prisma.project.findUnique({
    where: { slug },
    include: {
      members: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      },
    },
  });

  if (!project) notFound();

  const myMembership = project.members.find((m) => m.userId === session.user.id);
  if (!myMembership || (myMembership.role !== 'OWNER' && myMembership.role !== 'ADMIN')) {
    notFound();
  }

  return (
    <div style={{ maxWidth: '900px', padding: '2rem 1.5rem' }}>
      <h2>Miembros</h2>
      <p style={{ color: 'var(--color-fg-muted)' }}>
        Solo usuarios con cuenta pueden ser miembros. Invítalos por email después de que se
        registren.
      </p>
      <MembersPanel
        projectSlug={slug}
        currentUserId={session.user.id}
        ownerId={project.ownerId}
        members={project.members.map((m) => ({
          id: m.id,
          userId: m.userId,
          role: m.role,
          name: m.user.name,
          email: m.user.email,
          joinedAt: m.joinedAt.toISOString(),
        }))}
      />

      <h2 style={{ marginTop: '3rem' }}>Repositorio</h2>
      <p style={{ color: 'var(--color-fg-muted)' }}>
        Asocia el proyecto a una copia local del repo. El generador de HUs leerá archivos de ahí
        para construir contexto. Solo lectura, sandboxed: ningún path puede escapar de esta raíz.
      </p>
      <RepoSettingsPanel
        projectSlug={slug}
        initial={{
          repoPath: project.repoPath,
          repoUrl: project.repoUrl,
          repoDefaultBranch: project.repoDefaultBranch,
        }}
      />
    </div>
  );
}
