import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import styles from './layout.module.scss';
import { getServerT } from '@/lib/i18n/server';

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

  return (
    <div className={styles.project}>
      <div className={styles.subnav}>
        <div className={styles.title}>
          <Link href="/projects" className={styles.back}>← {t('Catálogo', 'Catalog')}</Link>
          <h1 className={styles.heading}>{project.name}</h1>
          <code className={styles.slug}>{project.slug}</code>
        </div>
        <nav className={styles.tabs}>
          <Link href={`/projects/${slug}/plan`}>✦ {t('Plan', 'Plan')}</Link>
          <Link href={`/projects/${slug}/roadmap`}>⊞ {t('Roadmap', 'Roadmap')}</Link>
          <Link href={`/projects/${slug}/board`}>§ {t('Tablero', 'Board')}</Link>
          <Link href={`/projects/${slug}/files`}>❏ {t('Archivos', 'Files')}</Link>
          <Link href={`/projects/${slug}/vault`}>※ Vault</Link>
          <Link href={`/projects/${slug}/brain`}>⁂ {t('Cerebro', 'Brain')}</Link>
          <Link href={`/projects/${slug}/stories`}>✎ {t('HUs', 'Stories')}</Link>
          {canManage && <Link href={`/projects/${slug}/settings`}>¶ {t('Ajustes', 'Settings')}</Link>}
          {canManage && <Link href={`/projects/${slug}/settings/audit`}>☞ {t('Auditoría', 'Audit')}</Link>}
        </nav>
      </div>
      {children}
    </div>
  );
}
