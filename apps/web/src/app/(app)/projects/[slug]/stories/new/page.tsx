import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { repoReaderFor } from '@/lib/repo/reader';
import { listProviders } from '@/lib/ai/providers/registry';
import { serverCredentialAvailable } from '@/lib/llm-credentials/server-credential';
import { PageHeader, Eyebrow } from '@/components/ui';
import { getServerT } from '@/lib/i18n/server';
import { Composer } from './Composer';
import styles from '../stories.module.scss';

export default async function NewStoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getServerT();
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const project = await prisma.project.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      repoPath: true,
      members: { where: { userId }, select: { role: true } },
    },
  });
  if (!project || project.members.length === 0) notFound();
  if (project.members[0]!.role === 'VIEWER') {
    redirect(`/projects/${slug}/stories`);
  }

  const credentials = await prisma.llmCredential.findMany({
    where: {
      userId,
      revokedAt: null,
      OR: [{ projectId: project.id }, { projectId: null }],
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      provider: true,
      label: true,
      modelDefault: true,
      keyPrefix: true,
    },
  });

  // Fallback del servidor (misma key que el chat del Plan): opción sintética
  // al final — las credenciales personales siguen siendo el default.
  if (serverCredentialAvailable()) {
    credentials.push({
      id: 'server',
      provider: 'ANTHROPIC',
      label: 'Credencial del servidor (Anthropic)',
      modelDefault: 'claude-sonnet-5',
      keyPrefix: 'server',
    });
  }

  // Snapshot del árbol del repo (depth 2) para el selector de archivos.
  let repoTree: Awaited<ReturnType<NonNullable<Awaited<ReturnType<typeof repoReaderFor>>>['tree']>> = [];
  if (project.repoPath) {
    const reader = await repoReaderFor({ repoPath: project.repoPath });
    if (reader) repoTree = await reader.tree({ maxDepth: 2 });
  }

  const providerInfos = listProviders();

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow={<Eyebrow>{t('Nuevo borrador', 'New draft')}</Eyebrow>}
        title={t('¿Qué HU vas a levantar?', 'What story will you raise?')}
        description={t('Describe la necesidad. El sistema lee el código real y las memorias relevantes.', 'Describe the need. The system reads the real code and the relevant memories.')}
      />

      <Composer
        projectSlug={slug}
        projectName={project.name}
        credentials={credentials}
        providers={providerInfos}
        repoTree={repoTree}
        hasRepo={Boolean(project.repoPath)}
      />
    </main>
  );
}
