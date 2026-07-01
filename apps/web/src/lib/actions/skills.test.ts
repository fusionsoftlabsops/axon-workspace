import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, authMock, revalidateMock, auditMock } = vi.hoisted(() => ({
  prismaMock: {
    skill: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    user: { findMany: vi.fn() },
  },
  authMock: vi.fn(),
  revalidateMock: vi.fn(),
  auditMock: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));

import { createSkillAction, reviewSkillAction, deleteSkillAction, loadSkills } from './skills';

const skillRow = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  slug: 'my-skill',
  name: 'My skill',
  description: 'does a thing',
  category: 'OTHER',
  kind: 'COMMAND',
  body: '# body',
  official: false,
  status: 'PENDING',
  version: 1,
  tags: [],
  authorId: 'u1',
  updatedAt: new Date('2026-07-01T00:00:00Z'),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u1', isMasterUser: false } });
});

describe('createSkillAction', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await createSkillAction({ slug: 'x-y', name: 'n', description: 'd', category: 'OTHER', kind: 'COMMAND', body: 'b' })).toEqual({
      ok: false,
      error: 'No autenticado',
    });
  });

  it('rejects a non-kebab slug', async () => {
    const r = await createSkillAction({ slug: 'Bad Slug', name: 'n', description: 'd', category: 'OTHER', kind: 'COMMAND', body: 'b' });
    expect(r.ok).toBe(false);
  });

  it('rejects a duplicate slug', async () => {
    prismaMock.skill.findUnique.mockResolvedValue({ id: 'exists' });
    const r = await createSkillAction({ slug: 'my-skill', name: 'n', description: 'd', category: 'OTHER', kind: 'COMMAND', body: 'b' });
    expect(r.ok).toBe(false);
  });

  it('creates a PENDING skill authored by the user', async () => {
    prismaMock.skill.findUnique.mockResolvedValue(null);
    prismaMock.skill.create.mockResolvedValue(skillRow());
    const r = await createSkillAction({ slug: 'my-skill', name: 'My skill', description: 'd', category: 'GIT', kind: 'COMMAND', body: 'b' });
    expect(r.ok).toBe(true);
    const data = prismaMock.skill.create.mock.calls[0]![0].data;
    expect(data.status).toBe('PENDING');
    expect(data.official).toBe(false);
    expect(data.authorId).toBe('u1');
  });
});

describe('reviewSkillAction', () => {
  it('rejects a non-master user', async () => {
    expect(await reviewSkillAction('s1', { status: 'APPROVED' })).toEqual({
      ok: false,
      error: 'Solo un administrador puede revisar skills',
    });
  });

  it('lets a master approve + mark official', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isMasterUser: true } });
    prismaMock.skill.update.mockResolvedValue(skillRow({ status: 'APPROVED', official: true }));
    const r = await reviewSkillAction('s1', { status: 'APPROVED', official: true });
    expect(r.ok).toBe(true);
    expect(prismaMock.skill.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'APPROVED', official: true },
    });
  });
});

describe('deleteSkillAction', () => {
  it('rejects a non-master user', async () => {
    const r = await deleteSkillAction('s1');
    expect(r.ok).toBe(false);
    expect(prismaMock.skill.delete).not.toHaveBeenCalled();
  });

  it('deletes for a master', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isMasterUser: true } });
    prismaMock.skill.delete.mockResolvedValue({});
    expect(await deleteSkillAction('s1')).toEqual({ ok: true });
  });
});

describe('loadSkills', () => {
  it('maps rows and resolves author names', async () => {
    prismaMock.skill.findMany.mockResolvedValue([skillRow(), skillRow({ id: 's2', slug: 'other', authorId: null })]);
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', name: 'Ana' }]);
    const list = await loadSkills();
    expect(list).toHaveLength(2);
    expect(list[0]!.authorName).toBe('Ana');
    expect(list[1]!.authorName).toBeNull();
  });
});
