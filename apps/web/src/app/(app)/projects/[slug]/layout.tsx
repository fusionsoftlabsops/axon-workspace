import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import styles from './layout.module.scss';
import { getServerT } from '@/lib/i18n/server';
import { ProjectTabs, type ProjectTab } from './ProjectTabs';

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user?.id) return null;
  const t = await getServerT();

  const project = await prisma.project.findUnique({
    where: { slug },
    include: {
      members: { where: { userId: session.user.id }, select: { role: true } },
    },
  });

  if (!project || project.members.length === 0) {
    notFound();
  }

  const role = project.members[0]!.role;
  const canManage = role === 'OWNER' || role === 'ADMIN';

  const base = `/projects/${slug}`;
  const tabs: ProjectTab[] = [
    { href: `${base}/plan`, label: `✦ ${t('Plan', 'Plan')}` },
    { href: `${base}/roadmap`, label: `⊞ ${t('Roadmap', 'Roadmap')}` },
    { href: `${base}/board`, label: `§ ${t('Tablero', 'Board')}` },
    { href: `${base}/qa`, label: `✓ ${t('QA', 'QA')}` },
    { href: `${base}/context`, label: `◆ ${t('Contexto', 'Context')}` },
    { href: `${base}/files`, label: `❏ ${t('Archivos', 'Files')}` },
    { href: `${base}/vault`, label: '※ Vault' },
    { href: `${base}/brain`, label: `⁂ ${t('Cerebro', 'Brain')}` },
    { href: `${base}/stories`, label: `✎ ${t('HUs', 'Stories')}` },
    { href: `${base}/develop`, label: `⌘ ${t('Desarrollar', 'Develop')}` },
    { href: `${base}/deploy`, label: `⚡ ${t('Deploy', 'Deploy')}` },
    { href: `${base}/agents`, label: `🤖 ${t('Agentes', 'Agents')}` },
    ...(canManage
      ? [
          { href: `${base}/settings`, label: `¶ ${t('Ajustes', 'Settings')}` },
          { href: `${base}/settings/audit`, label: `☞ ${t('Auditoría', 'Audit')}` },
        ]
      : []),
  ];

  return (
    <div className={styles.project}>
      <div className={styles.subnav}>
        <div className={styles.title}>
          <Link href="/projects" className={styles.back}>← {t('Catálogo', 'Catalog')}</Link>
          <h1 className={styles.heading}>{project.name}</h1>
          <code className={styles.slug}>{project.slug}</code>
        </div>
        <ProjectTabs tabs={tabs} />
      </div>
      {children}
    </div>
  );
}
