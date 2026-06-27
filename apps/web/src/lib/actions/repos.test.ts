import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, assertMock, revalidateMock, isGhMock, createRepoMock, parseFullNameMock, getPermMock } =
  vi.hoisted(() => ({
    prismaMock: {
      projectPlan: { findFirst: vi.fn() },
      projectRepo: { findMany: vi.fn(), upsert: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
      projectMember: { findMany: vi.fn() },
    },
    assertMock: vi.fn(),
    revalidateMock: vi.fn(),
    isGhMock: vi.fn(),
    createRepoMock: vi.fn(),
    parseFullNameMock: vi.fn(() => 'owner/repo'),
    getPermMock: vi.fn(),
  }));

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: assertMock }));
vi.mock('@/lib/github/client', () => ({
  isGithubConfigured: isGhMock,
  createRepo: createRepoMock,
  parseRepoFullName: parseFullNameMock,
  getCollaboratorPermission: getPermMock,
}));

import {
  getReposSectionAction,
  createRepoOnGithubAction,
  linkExistingRepoAction,
  updateProjectRepoAction,
  removeProjectRepoAction,
  verifyRepoAccessAction,
} from './repos';

const okCtx = { ok: true, userId: 'u1', projectId: 'p1', role: 'OWNER' as const };

beforeEach(() => {
  vi.clearAllMocks();
  assertMock.mockResolvedValue(okCtx);
  isGhMock.mockReturnValue(true);
  parseFullNameMock.mockReturnValue('owner/repo');
  prismaMock.projectPlan.findFirst.mockResolvedValue(null);
  prismaMock.projectRepo.findMany.mockResolvedValue([]);
  prismaMock.projectRepo.upsert.mockResolvedValue({});
  prismaMock.projectRepo.update.mockResolvedValue({});
  prismaMock.projectRepo.delete.mockResolvedValue({});
  prismaMock.projectMember.findMany.mockResolvedValue([]);
});

describe('getReposSectionAction', () => {
  it('propagates the membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await getReposSectionAction('slug')).toEqual({ ok: false, error: 'nope' });
  });

  it('returns the section', async () => {
    const res = await getReposSectionAction('slug');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.githubConfigured).toBe(true);
      expect(res.data.repos).toEqual([]);
      expect(res.data.suggested).toEqual([]);
    }
  });

  it('maps stored repos to views', async () => {
    prismaMock.projectRepo.findMany.mockResolvedValue([
      {
        id: 'r1', name: 'web', kind: 'frontend', url: 'u', githubFullName: 'o/web',
        defaultBranch: 'main', repoPath: null, access: [{ userId: 'x' }], accessCheckedAt: new Date('2020-01-01T00:00:00Z'),
      },
    ]);
    const res = await getReposSectionAction('slug');
    if (res.ok) expect(res.data.repos[0]).toMatchObject({ id: 'r1', accessCheckedAt: '2020-01-01T00:00:00.000Z' });
  });
});

describe('createRepoOnGithubAction', () => {
  it('rejects a VIEWER (guard)', async () => {
    assertMock.mockResolvedValue({ ...okCtx, role: 'VIEWER' });
    expect(await createRepoOnGithubAction('slug', { name: 'x' })).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('rejects when GitHub is not configured', async () => {
    isGhMock.mockReturnValue(false);
    const res = await createRepoOnGithubAction('slug', { name: 'x' });
    expect(res.ok).toBe(false);
  });

  it('rejects an empty name', async () => {
    const res = await createRepoOnGithubAction('slug', { name: '  ' });
    expect(res).toEqual({ ok: false, error: 'Nombre de repo requerido' });
  });

  it('returns the error when createRepo throws', async () => {
    createRepoMock.mockRejectedValue(new Error('gh down'));
    expect(await createRepoOnGithubAction('slug', { name: 'web' })).toEqual({ ok: false, error: 'gh down' });
  });

  it('creates + upserts the repo', async () => {
    createRepoMock.mockResolvedValue({ htmlUrl: 'h', fullName: 'o/web', defaultBranch: 'main' });
    const res = await createRepoOnGithubAction('slug', { name: 'web', kind: 'frontend' });
    expect(prismaMock.projectRepo.upsert).toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });
});

describe('linkExistingRepoAction', () => {
  it('rejects an empty name', async () => {
    expect(await linkExistingRepoAction('slug', { name: ' ', url: 'u' })).toEqual({ ok: false, error: 'Nombre de repo requerido' });
  });

  it('rejects an empty url', async () => {
    expect(await linkExistingRepoAction('slug', { name: 'web', url: ' ' })).toEqual({ ok: false, error: 'URL requerida' });
  });

  it('links + upserts the repo', async () => {
    const res = await linkExistingRepoAction('slug', { name: 'web', url: 'https://github.com/o/web' });
    expect(prismaMock.projectRepo.upsert).toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });
});

describe('updateProjectRepoAction', () => {
  it('rejects a missing repo', async () => {
    prismaMock.projectRepo.findFirst.mockResolvedValue(null);
    expect(await updateProjectRepoAction('slug', 'r1', {})).toEqual({ ok: false, error: 'Repo no encontrado' });
  });

  it('rejects an empty name patch', async () => {
    prismaMock.projectRepo.findFirst.mockResolvedValue({ id: 'r1' });
    expect(await updateProjectRepoAction('slug', 'r1', { name: '  ' })).toEqual({ ok: false, error: 'El nombre no puede estar vacío' });
  });

  it('updates the repo fields', async () => {
    prismaMock.projectRepo.findFirst.mockResolvedValue({ id: 'r1' });
    const res = await updateProjectRepoAction('slug', 'r1', {
      name: 'web', kind: 'frontend', url: 'https://github.com/o/web', repoPath: '/x', defaultBranch: 'dev',
    });
    expect(prismaMock.projectRepo.update).toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });

  it('reports a failed update (duplicate name)', async () => {
    prismaMock.projectRepo.findFirst.mockResolvedValue({ id: 'r1' });
    prismaMock.projectRepo.update.mockRejectedValue(new Error('unique'));
    const res = await updateProjectRepoAction('slug', 'r1', { url: '', repoPath: '', defaultBranch: '' });
    expect(res).toEqual({ ok: false, error: 'No se pudo actualizar (¿nombre duplicado?)' });
  });
});

describe('removeProjectRepoAction', () => {
  it('rejects a missing repo', async () => {
    prismaMock.projectRepo.findFirst.mockResolvedValue(null);
    expect(await removeProjectRepoAction('slug', 'r1')).toEqual({ ok: false, error: 'Repo no encontrado' });
  });

  it('deletes the repo', async () => {
    prismaMock.projectRepo.findFirst.mockResolvedValue({ id: 'r1' });
    const res = await removeProjectRepoAction('slug', 'r1');
    expect(prismaMock.projectRepo.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
    expect(res.ok).toBe(true);
  });
});

describe('verifyRepoAccessAction', () => {
  it('rejects when GitHub is not configured', async () => {
    isGhMock.mockReturnValue(false);
    const res = await verifyRepoAccessAction('slug', 'r1');
    expect(res.ok).toBe(false);
  });

  it('rejects a missing repo', async () => {
    prismaMock.projectRepo.findFirst.mockResolvedValue(null);
    expect(await verifyRepoAccessAction('slug', 'r1')).toEqual({ ok: false, error: 'Repo no encontrado' });
  });

  it('rejects a repo without a github full name', async () => {
    prismaMock.projectRepo.findFirst.mockResolvedValue({ id: 'r1', githubFullName: null, url: null });
    const res = await verifyRepoAccessAction('slug', 'r1');
    expect(res).toEqual({ ok: false, error: 'El repo no tiene una URL de GitHub válida' });
  });

  it('checks each member access (login, no login, error)', async () => {
    prismaMock.projectRepo.findFirst.mockResolvedValue({ id: 'r1', githubFullName: 'o/web', url: null });
    prismaMock.projectMember.findMany.mockResolvedValue([
      { user: { id: 'u1', name: 'A', githubLogin: 'a' } },
      { user: { id: 'u2', name: 'B', githubLogin: null } },
      { user: { id: 'u3', name: 'C', githubLogin: 'c' } },
    ]);
    getPermMock.mockResolvedValueOnce('admin').mockRejectedValueOnce(new Error('gh err'));
    const res = await verifyRepoAccessAction('slug', 'r1');
    expect(prismaMock.projectRepo.update).toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });
});
