/**
 * Chat de planeación por API token — para el SUPERVISOR de consola.
 *   GET  → lee el hilo del plan + contexto (idea mejorada, repos sugeridos,
 *          resumen del plan generado). scope projects:read.
 *   POST → participa en la planeación (dispara la respuesta del/los agentes en
 *          fable-5 = costo LLM). scope comments:write; rechaza VIEWER.
 * La UI sigue usando las server actions planChatAction/planTypingAction; aquí se
 * reutiliza el mismo núcleo `runPlanChat`.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { runPlanChat } from '@/lib/actions/planning';

export const runtime = 'nodejs';

async function loadMember(slug: string, userId: string) {
  const project = await prisma.project.findUnique({
    where: { slug },
    select: { id: true, members: { where: { userId }, select: { role: true } } },
  });
  if (!project || project.members.length === 0) return null;
  return { id: project.id, role: project.members[0]!.role };
}

interface GenSummary {
  sprints?: Array<{ name?: string; tasks?: unknown[] }>;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const authd = await requireApiToken(req, ['projects:read']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }
  const member = await loadMember(slug, authd.userId);
  if (!member) return NextResponse.json({ error: 'project not found' }, { status: 404 });

  const plan = await prisma.projectPlan.findFirst({
    where: { projectId: member.id },
    orderBy: { createdAt: 'desc' },
    select: {
      status: true,
      messages: true,
      improvedIdea: true,
      suggestedRepos: true,
      generated: true,
      updatedAt: true,
    },
  });
  if (!plan) return NextResponse.json({ error: 'plan not found' }, { status: 404 });

  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('limit') ?? '40', 10) || 40, 1), 200);
  const messages = Array.isArray(plan.messages) ? plan.messages : [];
  const gen = (plan.generated ?? null) as GenSummary | null;
  const generatedSummary = gen?.sprints
    ? gen.sprints.map((s) => ({ name: s.name ?? '', tasks: Array.isArray(s.tasks) ? s.tasks.length : 0 }))
    : null;

  return NextResponse.json({
    status: plan.status,
    improvedIdea: plan.improvedIdea,
    suggestedRepos: plan.suggestedRepos ?? null,
    generatedSummary,
    messages: messages.slice(-limit),
    updatedAt: plan.updatedAt.toISOString(),
  });
}

const postSchema = z.object({ message: z.string().min(1).max(4000) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const authd = await requireApiToken(req, ['comments:write']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }
  const member = await loadMember(slug, authd.userId);
  if (!member) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  if (member.role === 'VIEWER') {
    return NextResponse.json({ error: 'viewer cannot post to the plan chat' }, { status: 403 });
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const author = await prisma.user.findUnique({ where: { id: authd.userId }, select: { name: true } });
  const res = await runPlanChat(member.id, authd.userId, author?.name ?? null, member.role, parsed.data.message);
  if (!res.ok || !res.data) return NextResponse.json({ error: res.ok ? 'sin datos' : res.error }, { status: 400 });

  const msgs = res.data.messages;
  return NextResponse.json({
    ok: true,
    reply: msgs[msgs.length - 1] ?? null,
    messages: msgs.slice(-6),
  });
}
