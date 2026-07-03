/**
 * POST /api/v1/projects/[slug]/stories/drafts/[id]/publish
 *   body: { stateId, includeSubtasks: number[], finalTitle?, finalDescription? }
 *   → publica el draft como Task con kind=STORY + subtasks seleccionadas.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSessionOrToken } from '@/lib/api-auth';
import { publishStoryDraftAsTaskAction } from '@/lib/actions/stories';

export const runtime = 'nodejs';

const bodySchema = z.object({
  stateId: z.string().cuid(),
  includeSubtasks: z.array(z.number().int().nonnegative()).default([]),
  finalTitle: z.string().min(1).max(200).optional(),
  finalDescription: z.string().max(20_000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { id } = await params;
  const authd = await requireSessionOrToken(req, ['stories:write']);
  if (authd instanceof NextResponse) return authd;

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const result = await publishStoryDraftAsTaskAction(id, {
    stateId: parsed.data.stateId,
    includeSubtasks: parsed.data.includeSubtasks,
    finalTitle: parsed.data.finalTitle,
    finalDescription: parsed.data.finalDescription,
  }, authd.userId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({
    ok: true,
    taskId: result.taskId,
    taskNumber: result.taskNumber,
  });
}
