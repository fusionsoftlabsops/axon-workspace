import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getServerT } from '@/lib/i18n/server';
import { PageHeader, Eyebrow } from '@/components/ui';
import { env } from '@/lib/env';
import { DevelopClient, type DevelopHU } from './DevelopClient';

export default async function DevelopPage({ params }: { params: Promise<{ slug: string }> }) {
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

  const tasks = await prisma.task.findMany({
    where: { projectId: project.id },
    orderBy: { taskNumber: 'asc' },
    select: {
      taskNumber: true,
      title: true,
      state: { select: { name: true, category: true } },
      sprint: { select: { name: true } },
    },
  });
  const hus: DevelopHU[] = tasks.map((tk) => ({
    number: tk.taskNumber,
    title: tk.title,
    state: tk.state.name,
    done: tk.state.category === 'DONE',
    sprint: tk.sprint?.name ?? null,
  }));

  // Public control-plane base that serves the Fusion Code installer + Coding
  // Tools page. Optional — the guide degrades to manual steps if unset.
  let fusionBase: string | null = null;
  try {
    fusionBase = env().FUSION_CODE_BASE_URL ?? null;
  } catch {
    fusionBase = null;
  }
  const mcpUrl = env().AXON_MCP_URL;

  return (
    <main style={{ maxWidth: 900, padding: '1.5rem' }}>
      <PageHeader
        eyebrow={<Eyebrow>{t('Ejecución asistida por IA', 'AI-assisted execution')}</Eyebrow>}
        title={t('Desarrollá con Fusion Code', 'Develop with Fusion Code')}
        description={t(
          'Instalá nuestro editor (Qwen Code + Fusion Code), conectá este proyecto y trabajá las HU: cada una baja su contexto y el cerebro del proyecto.',
          'Install our editor (Qwen Code + Fusion Code), connect this project, and work the stories: each one pulls its context and the project brain.',
        )}
      />
      <DevelopClient
        slug={slug}
        canGenerate={role !== 'VIEWER'}
        fusionBase={fusionBase}
        mcpUrl={mcpUrl}
        hus={hus}
      />
    </main>
  );
}
