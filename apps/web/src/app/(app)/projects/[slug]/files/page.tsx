import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getServerT } from '@/lib/i18n/server';
import { PageHeader, Eyebrow } from '@/components/ui';
import { FilesClient } from './FilesClient';
import styles from './files.module.scss';

export default async function FilesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user?.id) return null;
  const t = await getServerT();

  const project = await prisma.project.findUnique({
    where: { slug },
    include: { members: { where: { userId: session.user.id }, select: { role: true } } },
  });
  if (!project || project.members.length === 0) notFound();
  const role = project.members[0]!.role;

  // Never select `data` here — only the download route reads the bytes.
  const files = await prisma.projectFile.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      mimeType: true,
      size: true,
      category: true,
      createdAt: true,
      uploadedById: true,
      uploadedBy: { select: { name: true } },
    },
  });

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow={<Eyebrow>{t('Almacén del proyecto', 'Project store')}</Eyebrow>}
        title={t('Archivos', 'Files')}
        description={t(
          'Sube archivos e imágenes accesibles para el equipo del proyecto. Se organizan por tipo y fecha.',
          'Upload files and images accessible to the project team. Organized by type and date.',
        )}
      />
      <FilesClient
        slug={slug}
        role={role}
        currentUserId={session.user.id}
        files={files.map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: f.size,
          category: f.category,
          createdAt: f.createdAt.toISOString(),
          uploadedById: f.uploadedById,
          uploaderName: f.uploadedBy.name,
        }))}
      />
    </main>
  );
}
