/**
 * Seed the project brain from a published plan. Creates PROJECT-scoped memories
 * tagged `source:plan` so an external coding agent (Fusion Code / Qwen) picks up
 * the plan's context immediately via `recall` when it opens an HU (`/task`).
 * Re-publishing replaces the previous plan seeds (idempotent).
 */
import { prisma } from '@/lib/db';
import type { GeneratedPlan } from '@/lib/ai/plan-schema';

export const PLAN_TAG = 'source:plan';

export async function seedBrainFromPlan(params: {
  projectId: string;
  authorId: string;
  plan: GeneratedPlan;
}): Promise<number> {
  const { projectId, authorId, plan } = params;

  // Idempotent: drop prior plan seeds before re-seeding.
  await prisma.brainMemory.deleteMany({
    where: { projectId, scope: 'PROJECT', tags: { has: PLAN_TAG } },
  });

  const memories: { type: 'DECISION' | 'NOTE' | 'GLOSSARY'; title: string; body: string }[] = [];

  const idea = plan.improvedIdea?.trim();
  if (idea) {
    memories.push({
      type: 'DECISION',
      title: 'Idea del proyecto (plan)',
      body:
        'Idea afinada del proyecto, generada en la planeación con Opus. Es la referencia ' +
        `de "qué construimos y para quién":\n\n${idea}`,
    });
  }

  const sprints = plan.sprints ?? [];
  if (sprints.length > 0) {
    const body = sprints
      .map((s, i) => {
        const goal = s.goal?.trim() ? ` — ${s.goal.trim()}` : '';
        const hus = (s.tasks ?? []).map((tk) => `  - ${tk.title}`).join('\n');
        return `${i + 1}. **${s.name}**${goal}${hus ? `\n${hus}` : ''}`;
      })
      .join('\n');
    memories.push({
      type: 'NOTE',
      title: 'Objetivos por sprint y HUs',
      body: `Plan de trabajo publicado (sprints y sus historias de usuario):\n\n${body}`,
    });
  }

  const repos = (plan.suggestedRepos ?? []).filter((r) => r.name?.trim());
  if (repos.length > 0) {
    const body = repos
      .map((r) => {
        const bits = [r.kind, r.stack].filter((x) => x && x.trim()).join(' · ');
        const reason = r.reason?.trim() ? ` — ${r.reason.trim()}` : '';
        return `- **${r.name}**${bits ? ` (${bits})` : ''}${reason}`;
      })
      .join('\n');
    memories.push({
      type: 'GLOSSARY',
      title: 'Stack y repos del proyecto',
      body: `Repositorios y stack sugeridos por el plan:\n\n${body}`,
    });
  }

  if (memories.length === 0) return 0;

  await prisma.brainMemory.createMany({
    data: memories.map((m) => ({
      projectId,
      scope: 'PROJECT' as const,
      ownerUserId: null,
      authorId,
      type: m.type,
      title: m.title,
      body: m.body,
      tags: [PLAN_TAG],
    })),
  });

  return memories.length;
}
