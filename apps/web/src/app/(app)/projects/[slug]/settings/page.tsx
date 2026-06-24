import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { getServerT } from '@/lib/i18n/server';
import { MembersPanel } from './MembersPanel';
import { RepoSettingsPanel } from './RepoSettingsPanel';
import { ProjectLifecyclePanel } from './ProjectLifecyclePanel';

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user?.id) return null;
  const t = await getServerT();

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
      <h2>{t('Miembros', 'Members')}</h2>
      <p style={{ color: 'var(--color-fg-muted)' }}>
        {t(
          'Solo usuarios con cuenta pueden ser miembros. Invítalos por email después de que se registren.',
          'Only users with an account can be members. Invite them by email after they sign up.',
        )}
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

      <h2 style={{ marginTop: '3rem' }}>{t('Repositorio', 'Repository')}</h2>
      <p style={{ color: 'var(--color-fg-muted)' }}>
        {t(
          'Asocia el proyecto a una copia local del repo. El generador de HUs leerá archivos de ahí para construir contexto. Solo lectura, sandboxed: ningún path puede escapar de esta raíz.',
          'Associate the project with a local copy of the repo. The user-story generator will read files from there to build context. Read-only, sandboxed: no path can escape this root.',
        )}
      </p>
      <RepoSettingsPanel
        projectSlug={slug}
        initial={{
          repoPath: project.repoPath,
          repoUrl: project.repoUrl,
          repoDefaultBranch: project.repoDefaultBranch,
        }}
      />

      <h2 style={{ marginTop: '3rem' }}>{t('Estado del proyecto', 'Project status')}</h2>
      <p style={{ color: 'var(--color-fg-muted)' }}>
        {t(
          'Activa, pausa, desactiva o marca como completado el proyecto. Solo OWNER o ADMIN pueden cambiar el estado o eliminarlo.',
          'Set the project as active, paused, inactive or completed. Only OWNER or ADMIN can change the status or delete it.',
        )}
      </p>
      <ProjectLifecyclePanel
        projectSlug={slug}
        projectName={project.name}
        currentStatus={project.status}
      />
    </div>
  );
}
