import { describe, it, expect, vi, beforeEach } from 'vitest';

const deleteMany = vi.fn();
const createMany = vi.fn();
vi.mock('@/lib/db', () => ({ prisma: { brainMemory: { deleteMany: (...a: unknown[]) => deleteMany(...a), createMany: (...a: unknown[]) => createMany(...a) } } }));

import { seedBrainFromAnalysis, CODE_ANALYSIS_TAG } from './seed-brain';
import type { GodNode } from './describe';

beforeEach(() => {
  deleteMany.mockReset().mockResolvedValue({});
  createMany.mockReset().mockResolvedValue({});
});

const GOD: GodNode[] = [
  { id: 'a', label: 'Orchestrator', degree: 9, community: '0' },
  { id: 'b', label: 'Auth', degree: 4, community: '1' },
];

describe('seedBrainFromAnalysis', () => {
  it('drops prior seeds (idempotent) and seeds pattern + glossary when god nodes exist', async () => {
    const count = await seedBrainFromAnalysis({ projectId: 'p1', authorId: 'u1', summary: 'el resumen', godNodes: GOD });
    expect(count).toBe(2);

    expect(deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1', scope: 'PROJECT', tags: { has: CODE_ANALYSIS_TAG } } });

    const data = createMany.mock.calls[0]![0].data;
    expect(data).toHaveLength(2);
    expect(data[0].type).toBe('PATTERN');
    expect(data[0].body).toContain('el resumen');
    expect(data[1].type).toBe('GLOSSARY');
    expect(data[1].body).toContain('**Orchestrator** — 9 conexiones');
    expect(data.every((m: { tags: string[] }) => m.tags.includes(CODE_ANALYSIS_TAG))).toBe(true);
    expect(data.every((m: { scope: string; projectId: string; authorId: string }) => m.scope === 'PROJECT' && m.projectId === 'p1' && m.authorId === 'u1')).toBe(true);
  });

  it('seeds only the architecture pattern when there are no god nodes', async () => {
    const count = await seedBrainFromAnalysis({ projectId: 'p2', authorId: 'u2', summary: 's', godNodes: [] });
    expect(count).toBe(1);
    expect(createMany.mock.calls[0]![0].data).toHaveLength(1);
  });
});
