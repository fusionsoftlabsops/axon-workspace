import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  brainMemory: { deleteMany: vi.fn(), createMany: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: m }));

import { seedBrainFromPlan, PLAN_TAG } from './seed-from-plan';
import type { GeneratedPlan } from '@/lib/ai/plan-schema';

function plan(over: Partial<GeneratedPlan> = {}): GeneratedPlan {
  return {
    improvedIdea: 'Una app para gestionar deudas',
    sprints: [
      { name: 'S1', goal: 'MVP', tasks: [{ title: 'Login' } as never, { title: 'Dashboard' } as never] },
    ],
    suggestedRepos: [{ name: 'api', kind: 'backend', stack: 'NestJS', reason: 'core' } as never],
    ...over,
  } as GeneratedPlan;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('seedBrainFromPlan', () => {
  it('drops prior plan seeds before creating (idempotent)', async () => {
    await seedBrainFromPlan({ projectId: 'p1', authorId: 'u1', plan: plan() });
    expect(m.brainMemory.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', scope: 'PROJECT', tags: { has: PLAN_TAG } },
    });
  });

  it('creates idea + sprints + repos memories tagged source:plan', async () => {
    const n = await seedBrainFromPlan({ projectId: 'p1', authorId: 'u1', plan: plan() });
    expect(n).toBe(3);
    const rows = m.brainMemory.createMany.mock.calls[0]![0].data as Array<{ type: string; title: string; tags: string[] }>;
    expect(rows.map((r) => r.type)).toEqual(['DECISION', 'NOTE', 'GLOSSARY']);
    expect(rows.every((r) => r.tags.includes(PLAN_TAG) && r.title)).toBe(true);
    // Sprint memory lists the HUs.
    const sprintMem = rows.find((r) => r.type === 'NOTE') as { body: string };
    expect(sprintMem.body).toContain('Login');
    expect(sprintMem.body).toContain('Dashboard');
  });

  it('skips empty sections', async () => {
    const n = await seedBrainFromPlan({
      projectId: 'p1',
      authorId: 'u1',
      plan: plan({ improvedIdea: '', suggestedRepos: [] }),
    });
    // Only the sprints memory remains.
    expect(n).toBe(1);
  });

  it('creates nothing for an empty plan', async () => {
    const n = await seedBrainFromPlan({
      projectId: 'p1',
      authorId: 'u1',
      plan: plan({ improvedIdea: '', sprints: [], suggestedRepos: [] }),
    });
    expect(n).toBe(0);
    expect(m.brainMemory.createMany).not.toHaveBeenCalled();
  });
});
