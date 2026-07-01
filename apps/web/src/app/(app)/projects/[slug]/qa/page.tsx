import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getServerT } from '@/lib/i18n/server';
import { PageHeader, Eyebrow } from '@/components/ui';
import { loadQaQueue } from '@/lib/actions/qa';
import { QaClient } from './QaClient';

export default async function QaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user?.id) return null;
  const t = await getServerT();

  const project = await prisma.project.findUnique({
    where: { slug },
    select: { id: true, members: { where: { userId: session.user.id }, select: { role: true } } },
  });
  if (!project || project.members.length === 0) notFound();
  const role = project.members[0]!.role;

  const queue = await loadQaQueue(project.id);

  return (
    <main style={{ padding: '1.5rem 0' }}>
      <PageHeader
        eyebrow={<Eyebrow>{t('Aseguramiento de calidad', 'Quality assurance')}</Eyebrow>}
        title={t('QA — Verificación', 'QA — Verification')}
        description={t(
          'Historias que el equipo terminó y pasaron a Verificación. Revisá los criterios, las pruebas sugeridas por el desarrollo, generá tus propias pruebas y aprobá o rechazá.',
          'Stories the team finished and moved to Verification. Review the criteria, the tests suggested by development, generate your own tests, and approve or reject.',
        )}
      />
      <QaClient slug={slug} canWrite={role !== 'VIEWER'} initialQueue={queue} />
    </main>
  );
}
