/**
 * POST /api/v1/projects/[slug]/repo/grep  { pattern, scope?: string[] }
 *   → hits del pattern (texto fijo, escapado) en el repo del proyecto.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireSessionOrToken } from '@/lib/api-auth';
import { repoReaderFor } from '@/lib/repo/reader';

export const runtime = 'nodejs';

const bodySchema = z.object({
  pattern: z.string().min(1).max(200),
  scope: z.array(z.string()).max(40).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const authd = await requireSessionOrToken(req, ['repo:read']);
  if (authd instanceof NextResponse) return authd;

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { slug },
    select: {
      id: true,
      repoPath: true,
      members: { where: { userId: authd.userId }, select: { role: true } },
    },
  });
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }

  const reader = await repoReaderFor({ repoPath: project.repoPath });
  if (!reader) {
    return NextResponse.json(
      { error: 'repositorio no configurado o inaccesible' },
      { status: 412 },
    );
  }

  try {
    const hits = await reader.grep(parsed.data.pattern, parsed.data.scope);
    return NextResponse.json({
      pattern: parsed.data.pattern,
      count: hits.length,
      hits,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'grep failed' },
      { status: 400 },
    );
  }
}
