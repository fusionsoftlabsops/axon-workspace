/**
 * Full-text search across a project's brain memories.
 *
 * The `search_vector` column is populated by a Postgres trigger (see the
 * `brain_system` migration). We query with `plainto_tsquery('spanish', ...)`
 * which is forgiving with user input — no need to teach users tsquery syntax.
 *
 * Returns memories the requester is allowed to see:
 *   - All PROJECT-scoped memories of the project.
 *   - LOCAL-scoped memories owned by `requesterUserId`.
 *   - If `includeAllLocals=true` (OWNER view), all LOCAL memories.
 */
import type { BrainScope, MemoryStatus, MemoryType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export interface SearchFilters {
  scope?: BrainScope[];      // default: ['PROJECT'] + own LOCAL
  type?: MemoryType[];
  tags?: string[];           // ANY-match
  authorId?: string;
  status?: MemoryStatus[];   // default: ['ACTIVE']
  includeStale?: boolean;    // include lastCitedAt older than 6 months
  staleOnly?: boolean;
  orphansOnly?: boolean;     // citationCount = 0
}

export interface SearchResult {
  id: string;
  projectId: string;
  scope: BrainScope;
  type: MemoryType;
  title: string;
  body: string;
  tags: string[];
  status: MemoryStatus;
  authorId: string;
  authorName: string;
  ownerUserId: string | null;
  sourceTaskId: string | null;
  sourceTaskNumber: number | null;
  citationCount: number;
  lastCitedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Postgres ts_rank score when a `query` was given; otherwise null. */
  rank: number | null;
}

const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 6;

export async function searchBrain(opts: {
  projectId: string;
  requesterUserId: string;
  includeAllLocals?: boolean;
  query?: string;
  limit?: number;
  filters?: SearchFilters;
}): Promise<SearchResult[]> {
  const { projectId, requesterUserId, query, filters = {} } = opts;
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const includeAllLocals = opts.includeAllLocals ?? false;
  const statuses = filters.status ?? ['ACTIVE'];

  // Scope predicate: PROJECT always allowed; LOCAL gated by ownership / OWNER.
  const scopePredicates: Prisma.Sql[] = [Prisma.sql`m.scope = 'PROJECT'`];
  if (includeAllLocals) {
    scopePredicates.push(Prisma.sql`m.scope = 'LOCAL'`);
  } else {
    scopePredicates.push(
      Prisma.sql`(m.scope = 'LOCAL' AND m."ownerUserId" = ${requesterUserId})`,
    );
  }
  const scopeSql = Prisma.join(scopePredicates, ' OR ');

  const where: Prisma.Sql[] = [
    Prisma.sql`m."projectId" = ${projectId}`,
    Prisma.sql`(${scopeSql})`,
    Prisma.sql`m.status = ANY (${statuses}::"MemoryStatus"[])`,
  ];

  if (filters.scope && filters.scope.length > 0) {
    where.push(Prisma.sql`m.scope = ANY (${filters.scope}::"BrainScope"[])`);
  }
  if (filters.type && filters.type.length > 0) {
    where.push(Prisma.sql`m.type = ANY (${filters.type}::"MemoryType"[])`);
  }
  if (filters.tags && filters.tags.length > 0) {
    where.push(Prisma.sql`m.tags && ${filters.tags}::text[]`);
  }
  if (filters.authorId) {
    where.push(Prisma.sql`m."authorId" = ${filters.authorId}`);
  }
  if (filters.orphansOnly) {
    where.push(Prisma.sql`m."citationCount" = 0`);
  }
  if (filters.staleOnly) {
    where.push(
      Prisma.sql`(m."lastCitedAt" IS NULL OR m."lastCitedAt" < NOW() - INTERVAL '6 months')`,
    );
  } else if (!filters.includeStale) {
    // default: don't filter; show everything
  }

  let rankExpr: Prisma.Sql = Prisma.sql`NULL::float4`;
  let orderBy: Prisma.Sql = Prisma.sql`m."updatedAt" DESC`;

  if (query && query.trim()) {
    rankExpr = Prisma.sql`ts_rank(m.search_vector, plainto_tsquery('spanish', ${query}))`;
    where.push(Prisma.sql`m.search_vector @@ plainto_tsquery('spanish', ${query})`);
    orderBy = Prisma.sql`rank DESC NULLS LAST, m."updatedAt" DESC`;
  }

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      projectId: string;
      scope: BrainScope;
      type: MemoryType;
      title: string;
      body: string;
      tags: string[];
      status: MemoryStatus;
      authorId: string;
      authorName: string;
      ownerUserId: string | null;
      sourceTaskId: string | null;
      sourceTaskNumber: number | null;
      citationCount: number;
      lastCitedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      rank: number | null;
    }>
  >(Prisma.sql`
    SELECT
      m.id,
      m."projectId",
      m.scope,
      m.type,
      m.title,
      m.body,
      m.tags,
      m.status,
      m."authorId",
      u.name           AS "authorName",
      m."ownerUserId",
      m."sourceTaskId",
      t."taskNumber"   AS "sourceTaskNumber",
      m."citationCount",
      m."lastCitedAt",
      m."createdAt",
      m."updatedAt",
      ${rankExpr} AS rank
    FROM "BrainMemory" m
    JOIN "User" u ON u.id = m."authorId"
    LEFT JOIN "Task" t ON t.id = m."sourceTaskId"
    WHERE ${Prisma.join(where, ' AND ')}
    ORDER BY ${orderBy}
    LIMIT ${limit}
  `);

  return rows;
}

/** Convenience: was this memory last cited > 6 months ago? */
export function isStale(memory: { lastCitedAt: Date | null; updatedAt: Date }): boolean {
  const lastTouch = memory.lastCitedAt ?? memory.updatedAt;
  return Date.now() - lastTouch.getTime() > SIX_MONTHS_MS;
}
