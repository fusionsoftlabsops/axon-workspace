/**
 * Incremental pull of the project brain for a given user.
 *
 * Tracks `BrainSyncState.lastPulledAt` per (user, project) so each call only
 * returns memories that have been created or updated since the last pull.
 * On first pull, returns the full active PROJECT brain.
 */
import { prisma } from '@/lib/db';

export interface PullEntry {
  id: string;
  type: string;
  title: string;
  body: string;
  tags: string[];
  status: string;
  authorName: string;
  sourceTaskNumber: number | null;
  citationCount: number;
  updatedAt: string;
}

export interface PullResult {
  projectSlug: string;
  pulledAt: string;
  lastPulledAt: string | null;
  count: number;
  memories: PullEntry[];
}

/**
 * Pull PROJECT-scoped active memories newer than the user's last pull.
 * Updates `lastPulledAt` to NOW() after a successful fetch.
 */
export async function pullProjectBrain(opts: {
  userId: string;
  projectId: string;
  projectSlug: string;
  limit?: number;
}): Promise<PullResult> {
  const { userId, projectId, projectSlug } = opts;
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);

  const state = await prisma.brainSyncState.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });
  const since = state?.lastPulledAt;
  const now = new Date();

  const memories = await prisma.brainMemory.findMany({
    where: {
      projectId,
      scope: 'PROJECT',
      status: 'ACTIVE',
      ...(since ? { updatedAt: { gt: since } } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    include: {
      author: { select: { name: true } },
      sourceTask: { select: { taskNumber: true } },
    },
  });

  await prisma.brainSyncState.upsert({
    where: { userId_projectId: { userId, projectId } },
    update: { lastPulledAt: now },
    create: { userId, projectId, lastPulledAt: now },
  });

  return {
    projectSlug,
    pulledAt: now.toISOString(),
    lastPulledAt: since?.toISOString() ?? null,
    count: memories.length,
    memories: memories.map((m) => ({
      id: m.id,
      type: m.type,
      title: m.title,
      body: m.body,
      tags: m.tags,
      status: m.status,
      authorName: m.author.name,
      sourceTaskNumber: m.sourceTask?.taskNumber ?? null,
      citationCount: m.citationCount,
      updatedAt: m.updatedAt.toISOString(),
    })),
  };
}
