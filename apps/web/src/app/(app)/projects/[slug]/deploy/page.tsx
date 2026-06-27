import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getServerT } from '@/lib/i18n/server';
import { PageHeader, Eyebrow } from '@/components/ui';
import { getDeployViewAction } from '@/lib/actions/deploy';
import { DeployClient } from './DeployClient';
import styles from './deploy.module.scss';

export default async function DeployPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user?.id) return null;
  const t = await getServerT();

  const project = await prisma.project.findUnique({
    where: { slug },
    include: { members: { where: { userId: session.user.id }, select: { role: true } } },
  });
  if (!project || project.members.length === 0) notFound();

  const res = await getDeployViewAction(slug);

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow={<Eyebrow>{t('Infraestructura', 'Infrastructure')}</Eyebrow>}
        title={t('Despliegue', 'Deploy')}
        description={t(
          'Despliega los repos del proyecto a tu PaaS fusion-infra y gestiona su ciclo de vida.',
          'Deploy the project repos to your fusion-infra PaaS and manage their lifecycle.',
        )}
      />
      {res.ok && res.data ? (
        <DeployClient slug={slug} initial={res.data} />
      ) : (
        <p className={styles.error}>
          {res.ok ? t('No se pudo cargar el despliegue', 'Could not load deployment') : res.error}
        </p>
      )}
    </main>
  );
}
