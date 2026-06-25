import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertProjectMember } from '@/lib/auth/membership';

/** GET — snapshot of the project's active AI plan, for polling during generation. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) {
    const status = ctx.error === 'No autenticado' ? 401 : 404;
    return NextResponse.json({ error: ctx.error }, { status });
  }

  const plan = await prisma.projectPlan.findFirst({
    where: { projectId: ctx.projectId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      messages: true,
      generated: true,
      suggestedRepos: true,
      improvedIdea: true,
      error: true,
    },
  });
  if (!plan) return NextResponse.json({ plan: null });

  return NextResponse.json({ plan });
}
