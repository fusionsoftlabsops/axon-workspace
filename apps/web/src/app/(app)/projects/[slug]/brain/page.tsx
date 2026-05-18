import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { searchBrain } from '@/lib/brain';
import { BrainClient } from './BrainClient';

type BrainTab = 'project' | 'local' | 'audit';
type MemoryTypeFilter =
  | 'DECISION'
  | 'GOTCHA'
  | 'PATTERN'
  | 'ANTIPATTERN'
  | 'RUNBOOK'
  | 'GLOSSARY'
  | 'NOTE';

function isMemoryType(value: string): value is MemoryTypeFilter {
  return (
    value === 'DECISION' ||
    value === 'GOTCHA' ||
    value === 'PATTERN' ||
    value === 'ANTIPATTERN' ||
    value === 'RUNBOOK' ||
    value === 'GLOSSARY' ||
    value === 'NOTE'
  );
}

export default async function BrainPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    tab?: string;
    q?: string;
    type?: string;
    tag?: string;
    stale?: string;
    orphans?: string;
  }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const project = await prisma.project.findUnique({
    where: { slug },
    select: {
      id: true,
      members: { where: { userId }, select: { role: true } },
    },
  });
  if (!project || project.members.length === 0) notFound();

  const role = project.members[0]!.role;
  const isOwner = role === 'OWNER';
  const requestedTab = (sp.tab ?? 'project') as BrainTab;
  const tab: BrainTab = requestedTab === 'audit' && !isOwner ? 'project' : requestedTab;

  const staleOnly = sp.stale === '1';
  const orphansOnly = sp.orphans === '1';

  const filters: {
    scope?: ('PROJECT' | 'LOCAL')[];
    type?: MemoryTypeFilter[];
    tags?: string[];
    staleOnly?: boolean;
    orphansOnly?: boolean;
  } = {};
  if (tab === 'project') filters.scope = ['PROJECT'];
  if (tab === 'local') filters.scope = ['LOCAL'];
  // tab === 'audit' → no scope filter; helper grants includeAllLocals when OWNER

  if (sp.type && isMemoryType(sp.type)) filters.type = [sp.type];
  if (sp.tag) filters.tags = [sp.tag];
  if (staleOnly) filters.staleOnly = true;
  if (orphansOnly) filters.orphansOnly = true;

  const includeAllLocals = tab === 'audit' && isOwner;

  const memories = await searchBrain({
    projectId: project.id,
    requesterUserId: userId,
    includeAllLocals,
    query: sp.q?.trim() || undefined,
    limit: 100,
    filters,
  });

  // ---------- Cross-dev audit summary (OWNER only) ----------
  let auditByAuthor:
    | Array<{
        userId: string;
        name: string;
        email: string;
        role: string;
        local: number;
        project: number;
        cited: number;
        stale: number;
      }>
    | undefined;

  if (tab === 'audit' && isOwner) {
    const members = await prisma.projectMember.findMany({
      where: { projectId: project.id },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });

    const summaries = await Promise.all(
      members.map(async (m) => {
        const sixM = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30 * 6);
        const [local, projectScope, cited, staleByMember] = await Promise.all([
          prisma.brainMemory.count({
            where: {
              projectId: project.id,
              scope: 'LOCAL',
              ownerUserId: m.user.id,
              status: 'ACTIVE',
            },
          }),
          prisma.brainMemory.count({
            where: {
              projectId: project.id,
              scope: 'PROJECT',
              authorId: m.user.id,
              status: 'ACTIVE',
            },
          }),
          prisma.brainMemory.count({
            where: {
              projectId: project.id,
              authorId: m.user.id,
              status: 'ACTIVE',
              citationCount: { gt: 0 },
            },
          }),
          prisma.brainMemory.count({
            where: {
              projectId: project.id,
              authorId: m.user.id,
              status: 'ACTIVE',
              OR: [{ lastCitedAt: null }, { lastCitedAt: { lt: sixM } }],
            },
          }),
        ]);
        return {
          userId: m.user.id,
          name: m.user.name,
          email: m.user.email,
          role: m.role,
          local,
          project: projectScope,
          cited,
          stale: staleByMember,
        };
      }),
    );
    auditByAuthor = summaries;
  }

  // Stats for the header strip.
  const sixMonthsAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30 * 6);
  const [projectCount, localCount, topCited, staleCount, orphansCount] = await Promise.all([
    prisma.brainMemory.count({
      where: { projectId: project.id, scope: 'PROJECT', status: 'ACTIVE' },
    }),
    prisma.brainMemory.count({
      where: { projectId: project.id, scope: 'LOCAL', ownerUserId: userId, status: 'ACTIVE' },
    }),
    prisma.brainMemory.findMany({
      where: { projectId: project.id, scope: 'PROJECT', status: 'ACTIVE', citationCount: { gt: 0 } },
      orderBy: { citationCount: 'desc' },
      take: 3,
      select: { id: true, title: true, citationCount: true },
    }),
    // Stale: PROJECT, ACTIVE, never cited OR last cite > 6 months ago.
    prisma.brainMemory.count({
      where: {
        projectId: project.id,
        scope: 'PROJECT',
        status: 'ACTIVE',
        OR: [{ lastCitedAt: null }, { lastCitedAt: { lt: sixMonthsAgo } }],
      },
    }),
    // Orphans: PROJECT, ACTIVE, never cited at all.
    prisma.brainMemory.count({
      where: { projectId: project.id, scope: 'PROJECT', status: 'ACTIVE', citationCount: 0 },
    }),
  ]);

  return (
    <BrainClient
      projectSlug={slug}
      isOwner={isOwner}
      currentUserId={userId}
      activeTab={tab}
      query={sp.q ?? ''}
      typeFilter={sp.type && isMemoryType(sp.type) ? sp.type : null}
      tagFilter={sp.tag ?? null}
      memories={memories.map((m) => ({
        id: m.id,
        scope: m.scope,
        type: m.type,
        title: m.title,
        body: m.body,
        tags: m.tags,
        status: m.status,
        authorName: m.authorName,
        ownerUserId: m.ownerUserId,
        sourceTaskNumber: m.sourceTaskNumber,
        citationCount: m.citationCount,
        lastCitedAt: m.lastCitedAt?.toISOString() ?? null,
        updatedAt: m.updatedAt.toISOString(),
      }))}
      stats={{
        project: projectCount,
        local: localCount,
        topCited,
        stale: staleCount,
        orphans: orphansCount,
      }}
      staleActive={staleOnly}
      orphansActive={orphansOnly}
      auditByAuthor={auditByAuthor ?? null}
    />
  );
}
