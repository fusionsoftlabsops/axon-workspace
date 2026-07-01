import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireApiToken } from '@/lib/api-auth';
import { audit } from '@/lib/audit';

const categoryEnum = z.enum(['TESTING', 'QUALITY', 'WORKFLOW', 'ARCHITECTURE', 'GIT', 'OTHER']);
const kindEnum = z.enum(['COMMAND', 'GUIDELINE']);

const createBody = z.object({
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case'),
  name: z.string().min(2).max(120),
  description: z.string().min(2).max(500),
  category: categoryEnum.default('OTHER'),
  kind: kindEnum.default('COMMAND'),
  body: z.string().min(1).max(40_000),
  tags: z.array(z.string().min(1).max(40)).max(12).default([]),
});

/**
 * Global skills registry (org-wide, not project-scoped).
 * GET  — the approved skills package (what Fusion Code syncs). scope: skills:read
 * POST — contribute a new skill (enters PENDING for review).   scope: skills:write
 */
export async function GET(req: NextRequest) {
  const authd = await requireApiToken(req, ['skills:read']);
  if (authd instanceof NextResponse) return authd;

  const sp = req.nextUrl.searchParams;
  const category = sp.get('category');
  const where: Prisma.SkillWhereInput = { status: 'APPROVED' };
  if (category && categoryEnum.safeParse(category).success) {
    where.category = category as z.infer<typeof categoryEnum>;
  }

  const skills = await prisma.skill.findMany({
    where,
    orderBy: [{ official: 'desc' }, { category: 'asc' }, { slug: 'asc' }],
    take: 500,
  });

  return NextResponse.json({
    count: skills.length,
    skills: skills.map((s) => ({
      slug: s.slug,
      name: s.name,
      description: s.description,
      category: s.category,
      kind: s.kind,
      body: s.body,
      official: s.official,
      version: s.version,
      tags: s.tags,
      updatedAt: s.updatedAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const authd = await requireApiToken(req, ['skills:write']);
  if (authd instanceof NextResponse) return authd;

  const json = await req.json().catch(() => null);
  const parsed = createBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;

  const existing = await prisma.skill.findUnique({ where: { slug: data.slug }, select: { id: true } });
  if (existing) {
    return NextResponse.json({ error: `a skill with slug "${data.slug}" already exists` }, { status: 409 });
  }

  const created = await prisma.skill.create({
    data: {
      slug: data.slug,
      name: data.name,
      description: data.description,
      category: data.category,
      kind: data.kind,
      body: data.body,
      tags: data.tags,
      official: false,
      status: 'PENDING',
      authorId: authd.userId,
    },
    select: { id: true, slug: true },
  });

  await audit({
    actorId: authd.userId,
    action: 'skill.contribute',
    resourceType: 'skill',
    resourceId: created.id,
    payload: { slug: created.slug, via: 'api' },
  });

  return NextResponse.json({ id: created.id, slug: created.slug, status: 'PENDING' }, { status: 201 });
}
