import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import styles from './layout.module.scss';

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
          <Link href="/projects" className={styles.back}>← Catálogo</Link>
          <h1 className={styles.heading}>{project.name}</h1>
          <code className={styles.slug}>{project.slug}</code>
        </div>
        <nav className={styles.tabs}>
          <Link href={`/projects/${slug}/board`}>§ Tablero</Link>
          <Link href={`/projects/${slug}/vault`}>※ Vault</Link>
          <Link href={`/projects/${slug}/brain`}>⁂ Cerebro</Link>
          <Link href={`/projects/${slug}/stories`}>✎ HUs</Link>
          {canManage && <Link href={`/projects/${slug}/settings`}>¶ Ajustes</Link>}
          {canManage && <Link href={`/projects/${slug}/settings/audit`}>☞ Auditoría</Link>}
        </nav>
      </div>
      {children}
    </div>
  );
}
