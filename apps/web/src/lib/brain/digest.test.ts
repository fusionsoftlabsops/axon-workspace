import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ prisma: { task: { findUnique: vi.fn() } } }));
vi.mock('@/lib/db', () => db);

import { buildTaskDigest } from './digest';

beforeEach(() => {
  vi.clearAllMocks();
});

function fullTask() {
  return {
    id: 't1',
    taskNumber: 7,
    title: 'Ship feature',
    priority: 'HIGH',
    description: '  Build the thing.  ',
    project: { slug: 'AXON', name: 'Axon' },
    state: { name: 'Done', category: 'DONE' },
    assignee: { name: 'Ana' },
    reporter: { name: 'Beto' },
    comments: [
      { author: { name: 'Ana' }, createdAt: new Date('2026-01-01T00:00:00Z'), body: '  first  ' },
    ],
    activity: [
      {
        actor: { name: 'Beto' },
        createdAt: new Date('2026-01-02T00:00:00Z'),
        type: 'STATE_CHANGED',
        payload: { to: 'DONE' },
      },
      {
        actor: { name: 'Beto' },
        createdAt: new Date('2026-01-03T00:00:00Z'),
        type: 'WEIRD_UNKNOWN',
        payload: null,
      },
    ],
  };
}

describe('buildTaskDigest', () => {
  it('returns null when the task is not found', async () => {
    db.prisma.task.findUnique.mockResolvedValue(null);
    expect(await buildTaskDigest('missing')).toBeNull();
  });

  it('assembles a markdown digest with all sections', async () => {
    db.prisma.task.findUnique.mockResolvedValue(fullTask());
    const res = await buildTaskDigest('t1');
    expect(res).not.toBeNull();
    expect(res!.taskId).toBe('t1');
    expect(res!.taskNumber).toBe(7);
    expect(res!.projectSlug).toBe('AXON');
    const d = res!.digest;
    expect(d).toContain('# Tarea AXON#7: Ship feature');
    expect(d).toContain('Estado actual: **Done** (DONE)');
    expect(d).toContain('Asignado a: Ana · Reportado por: Beto');
    expect(d).toContain('## Descripción');
    expect(d).toContain('Build the thing.');
    expect(d).toContain('## Comentarios');
    expect(d).toContain('first');
    expect(d).toContain('## Actividad');
    expect(d).toContain('Cambio de estado {"to":"DONE"}'); // known label + payload
    expect(d).toContain('WEIRD_UNKNOWN'); // unknown type falls back to raw type
  });

  it('omits optional sections and shows a dash for an unassigned task', async () => {
    const t = fullTask();
    t.description = '   ';
    t.comments = [];
    t.activity = [];
    (t as { assignee: unknown }).assignee = null;
    db.prisma.task.findUnique.mockResolvedValue(t);
    const d = (await buildTaskDigest('t1'))!.digest;
    expect(d).not.toContain('## Descripción');
    expect(d).not.toContain('## Comentarios');
    expect(d).not.toContain('## Actividad');
    expect(d).toContain('Asignado a: — ·');
  });

  it('caps the digest at 40k chars', async () => {
    const t = fullTask();
    t.description = 'x'.repeat(60_000);
    db.prisma.task.findUnique.mockResolvedValue(t);
    const d = (await buildTaskDigest('t1'))!.digest;
    expect(d.length).toBe(40_000);
  });
});
