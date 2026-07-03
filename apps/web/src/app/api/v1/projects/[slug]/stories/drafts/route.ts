/**
 * POST /api/v1/projects/[slug]/stories/drafts
 *   → crea el draft (status=GENERATING) y dispara la generación en background.
 *     Devuelve { draftId } inmediatamente. El cliente hace polling al GET
 *     `/drafts/[id]` para ver el progreso. Self-hosted Node process; el bg
 *     keep alive después de retornar.
 *
 * GET /api/v1/projects/[slug]/stories/drafts
 *   → lista los drafts del proyecto.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireSessionOrToken } from '@/lib/api-auth';
import { startStoryDraftAction } from '@/lib/actions/stories';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  rawInput: z.string().min(10).max(4000),
  provider: z.enum(['ANTHROPIC', 'OPENAI', 'GOOGLE', 'MOONSHOT']),
  model: z.string().min(1).max(100),
  credentialId: z.union([z.string().cuid(), z.literal('server')]),
  selectedPaths: z.array(z.string()).max(50).optional(),
  citedMemoryIds: z.array(z.string()).max(20).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const authd = await requireSessionOrToken(req, ['stories:write']);
  if (authd instanceof NextResponse) return authd;
  if (
    authd.via === 'token' &&
    authd.projectSlugs.length > 0 &&
    !authd.projectSlugs.includes(slug)
  ) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const start = await startStoryDraftAction(slug, {
    rawInput: parsed.data.rawInput,
    provider: parsed.data.provider,
    model: parsed.data.model,
    credentialId: parsed.data.credentialId,
    selectedPaths: parsed.data.selectedPaths ?? [],
    citedMemoryIds: parsed.data.citedMemoryIds ?? [],
    // Con auth por token no hay sesión de navegador: el userId autenticado
    // viaja explícito para la verificación de membresía.
  }, authd.userId);
  if (!start.ok || !start.draftId) {
    return NextResponse.json(
      { error: start.error ?? 'no se pudo crear el borrador' },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, draftId: start.draftId }, { status: 201 });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const authd = await requireSessionOrToken(req, ['stories:read']);
  if (authd instanceof NextResponse) return authd;

  const project = await prisma.project.findUnique({
    where: { slug },
    select: {
      id: true,
      members: { where: { userId: authd.userId }, select: { role: true } },
    },
  });
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }

  const drafts = await prisma.storyDraft.findMany({
    where: { projectId: project.id, authorId: authd.userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      provider: true,
      model: true,
      status: true,
      summary: true,
      inputTokens: true,
      outputTokens: true,
      estimatedCostUsd: true,
      taskId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    count: drafts.length,
    drafts: drafts.map((d) => ({
      ...d,
      estimatedCostUsd: d.estimatedCostUsd.toString(),
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    })),
  });
}
