import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
  publish: vi.fn(async () => {}),
}));
vi.mock('@/lib/db', () => ({ prisma: { teamChatMessage: { create: h.create, findMany: h.findMany } } }));
vi.mock('@/lib/realtime', () => ({ publish: h.publish }));

import {
  teamChannel,
  agentDisplayName,
  DEFAULT_AGENT_NAMES,
  postTeamMessage,
  listTeamMessages,
} from './team-chat';

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.publish.mockResolvedValue(undefined);
});

describe('teamChannel', () => {
  it('namespaces by project id', () => {
    expect(teamChannel('p1')).toBe('team:p1');
  });
});

describe('agentDisplayName', () => {
  it('falls back to the default persona name per role', () => {
    expect(agentDisplayName('SM', null)).toBe(`${DEFAULT_AGENT_NAMES.SM} · SM`);
    expect(agentDisplayName('DEV', undefined)).toBe(`${DEFAULT_AGENT_NAMES.DEV} · DEV`);
    expect(agentDisplayName('QA', '   ')).toBe(`${DEFAULT_AGENT_NAMES.QA} · QA`);
  });

  it('prefers a custom name when set', () => {
    expect(agentDisplayName('DEV', 'Rex')).toBe('Rex · DEV');
  });
});

describe('postTeamMessage', () => {
  it('persists the row and publishes it on the project channel (best-effort)', async () => {
    h.create.mockResolvedValue({
      id: 'm1',
      authorId: 'u1',
      agentRole: 'DEV',
      authorName: 'Kai · DEV',
      kind: 'STATUS',
      body: 'Tomo la HU #24',
      createdAt: new Date('2026-07-03T00:00:00Z'),
    });
    const view = await postTeamMessage({
      projectId: 'p1',
      authorId: 'u1',
      agentRole: 'DEV',
      authorName: 'Kai · DEV',
      kind: 'STATUS',
      body: 'Tomo la HU #24',
      storyNumber: 24,
    });
    expect(view).toMatchObject({ id: 'm1', authorName: 'Kai · DEV', storyNumber: 24 });
    expect(h.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: 'p1', agentRole: 'DEV', kind: 'STATUS', storyId: null }),
    });
    expect(h.publish).toHaveBeenCalledWith(
      'team:p1',
      expect.objectContaining({ type: 'team.message', message: expect.objectContaining({ id: 'm1' }) }),
    );
  });

  it('never throws when the realtime publish fails (best-effort)', async () => {
    h.create.mockResolvedValue({
      id: 'm2',
      authorId: 'u1',
      agentRole: null,
      authorName: 'Manuel',
      kind: 'CHAT',
      body: 'hola',
      createdAt: new Date('2026-07-03T00:00:00Z'),
    });
    h.publish.mockRejectedValue(new Error('redis down'));
    await expect(
      postTeamMessage({ projectId: 'p1', authorId: 'u1', authorName: 'Manuel', body: 'hola' }),
    ).resolves.toMatchObject({ id: 'm2' });
  });
});

describe('listTeamMessages', () => {
  it('returns the latest messages in ascending order with story numbers resolved', async () => {
    h.findMany.mockResolvedValue([
      {
        id: 'm2',
        authorId: 'a2',
        agentRole: 'QA',
        authorName: 'Vera · QA',
        kind: 'HANDOFF',
        body: 'Aprobada',
        story: { taskNumber: 24 },
        createdAt: new Date('2026-07-03T01:00:00Z'),
      },
      {
        id: 'm1',
        authorId: 'a1',
        agentRole: 'DEV',
        authorName: 'Kai · DEV',
        kind: 'STATUS',
        body: 'Tomo la HU',
        story: null,
        createdAt: new Date('2026-07-03T00:00:00Z'),
      },
    ]);
    const result = await listTeamMessages('p1', 50);
    expect(h.findMany).toHaveBeenCalledWith({
      where: { projectId: 'p1' },
      include: { story: { select: { taskNumber: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    // El repo devuelve desc; la función debe invertir a ascendente para render directo.
    expect(result.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(result[1]).toMatchObject({ storyNumber: 24 });
    expect(result[0]).toMatchObject({ storyNumber: null });
  });

  it('clamps the limit into [1, 300]', async () => {
    h.findMany.mockResolvedValue([]);
    await listTeamMessages('p1', 10_000);
    expect(h.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 300 }));
    await listTeamMessages('p1', 0);
    expect(h.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }));
  });
});
