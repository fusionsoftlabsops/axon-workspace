import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { marketingTaskKit } from '@/lib/agents/marketing';

async function resolveTask(slug: string, taskNumber: number, userId: string) {
  const project = await prisma.project.findUnique({
    where: { slug },
    select: { id: true, members: { where: { userId }, select: { role: true } } },
  });
  if (!project || project.members.length === 0) return null;
  const task = await prisma.task.findUnique({
    where: { projectId_taskNumber: { projectId: project.id, taskNumber } },
    select: { id: true },
  });
  if (!task) return null;
  return { project, task, role: project.members[0]!.role };
}

const postBody = z.object({ lang: z.enum(['es', 'en']).optional() }).nullable();

/**
 * Genera el kit de marketing de una HU (copy + SEO + social + asset de marca) y
 * lo persiste. Advisory. Lo llama el agente Branding/SEO (Sol).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; taskNumber: string }> },
) {
  const { slug, taskNumber } = await params;
  const num = parseInt(taskNumber, 10);
  if (!Number.isFinite(num) || num < 1) {
    return NextResponse.json({ error: 'invalid taskNumber' }, { status: 400 });
  }
  const authd = await requireApiToken(req, ['tasks:write']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }
  const found = await resolveTask(slug, num, authd.userId);
  if (!found) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (found.role === 'VIEWER') {
    return NextResponse.json({ error: 'viewer cannot generate' }, { status: 403 });
  }

  const parsed = postBody.safeParse(await req.json().catch(() => null));
  const lang = (parsed.success && parsed.data?.lang) || 'es';

  let kit;
  try {
    kit = await marketingTaskKit({
      projectId: found.project.id,
      taskId: found.task.id,
      slug,
      actorUserId: authd.userId,
      lang,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error de IA' },
      { status: 502 },
    );
  }

  await audit({
    actorId: authd.userId,
    action: 'task.marketing',
    resourceType: 'task',
    resourceId: found.task.id,
    projectId: found.project.id,
    payload: { via: 'api', assetFileId: kit.assetFileId },
  });

  return NextResponse.json({ ok: true, marketing: kit }, { status: 201 });
}
