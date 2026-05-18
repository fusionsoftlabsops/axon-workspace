/**
 * GET /api/v1/projects/[slug]/stories/drafts/[id]
 *   → estado actual de un draft (con todas las secciones generadas).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSessionOrToken } from '@/lib/api-auth';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const authd = await requireSessionOrToken(req, ['stories:read']);
  if (authd instanceof NextResponse) return authd;

  const project = await prisma.project.findUnique({
    where: { slug },
    select: { id: true, members: { where: { userId: authd.userId }, select: { role: true } } },
  });
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }

  const draft = await prisma.storyDraft.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true } },
    },
  });
  if (!draft || draft.projectId !== project.id) {
    return NextResponse.json({ error: 'draft not found' }, { status: 404 });
  }
  // Solo el author ve sus propios borradores (no es contenido compartido)
  if (draft.authorId !== authd.userId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    id: draft.id,
    status: draft.status,
    errorMessage: draft.errorMessage,
    provider: draft.provider,
    model: draft.model,
    rawInput: draft.rawInput,
    selectedPaths: draft.selectedPaths,
    citedMemoryIds: draft.citedMemoryIds,
    summary: draft.summary,
    acceptanceCriteria: draft.acceptanceCriteria,
    technicalContext: draft.technicalContext,
    subtaskBreakdown: draft.subtaskBreakdown,
    filesToTouch: draft.filesToTouch,
    risks: draft.risks,
    inputTokens: draft.inputTokens,
    outputTokens: draft.outputTokens,
    estimatedCostUsd: draft.estimatedCostUsd.toString(),
    durationMs: draft.durationMs,
    taskId: draft.taskId,
    parentDraftId: draft.parentDraftId,
    author: draft.author,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  });
}
