import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, authMock, assertMock, revalidateMock, envMock, statMock, withinRootMock } =
  vi.hoisted(() => ({
    prismaMock: { project: { update: vi.fn() } },
    authMock: vi.fn(),
    assertMock: vi.fn(),
    revalidateMock: vi.fn(),
    envMock: vi.fn(() => ({ REPOS_ROOT: undefined as string | undefined })),
    statMock: vi.fn(),
    withinRootMock: vi.fn(),
  }));

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('node:fs/promises', () => ({ default: { stat: statMock }, stat: statMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/env', () => ({ env: envMock }));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: assertMock }));
vi.mock('@/lib/repo/reader', () => ({ isPathWithinRoot: withinRootMock }));

import { setProjectRepoConfigAction } from './repo-config';

const okCtx = { ok: true, userId: 'u1', projectId: 'p1', role: 'OWNER' as const };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  assertMock.mockResolvedValue(okCtx);
  envMock.mockReturnValue({ REPOS_ROOT: undefined });
  withinRootMock.mockReturnValue(true);
});

describe('setProjectRepoConfigAction', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await setProjectRepoConfigAction('slug', {})).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('propagates the membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await setProjectRepoConfigAction('slug', {})).toEqual({ ok: false, error: 'nope' });
  });

  it('rejects non OWNER/ADMIN', async () => {
    assertMock.mockResolvedValue({ ...okCtx, role: 'MEMBER' });
    const res = await setProjectRepoConfigAction('slug', {});
    expect(res.ok).toBe(false);
  });

  it('rejects invalid input', async () => {
    const res = await setProjectRepoConfigAction('slug', { repoUrl: 'not-a-url' });
    expect(res).toEqual({ ok: false, error: 'Datos inválidos' });
  });

  it('rejects a non-absolute repoPath', async () => {
    const res = await setProjectRepoConfigAction('slug', { repoPath: 'relative/path' });
    expect(res).toEqual({ ok: false, error: 'repoPath debe ser absoluto' });
  });

  it('rejects a repoPath outside REPOS_ROOT', async () => {
    envMock.mockReturnValue({ REPOS_ROOT: '/repos' });
    withinRootMock.mockReturnValue(false);
    const res = await setProjectRepoConfigAction('slug', { repoPath: '/etc/passwd' });
    expect(res.error).toContain('/repos');
  });

  it('rejects a path that does not exist', async () => {
    statMock.mockRejectedValue(new Error('ENOENT'));
    const res = await setProjectRepoConfigAction('slug', { repoPath: '/repos/missing' });
    expect(res.error).toContain('la ruta no existe');
  });

  it('rejects a path that is not a directory', async () => {
    statMock.mockResolvedValue({ isDirectory: () => false });
    const res = await setProjectRepoConfigAction('slug', { repoPath: '/repos/file.txt' });
    expect(res).toEqual({ ok: false, error: 'la ruta no es un directorio' });
  });

  it('saves a valid directory repoPath', async () => {
    statMock.mockResolvedValue({ isDirectory: () => true });
    const res = await setProjectRepoConfigAction('slug', {
      repoPath: '/repos/ok',
      repoUrl: 'https://github.com/a/b',
      repoDefaultBranch: 'dev',
    });
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { repoPath: '/repos/ok', repoUrl: 'https://github.com/a/b', repoDefaultBranch: 'dev' },
    });
    expect(revalidateMock).toHaveBeenCalledWith('/projects/slug/settings');
    expect(res).toEqual({ ok: true });
  });

  it('saves with a null repoPath (no path validation) defaulting branch to main', async () => {
    const res = await setProjectRepoConfigAction('slug', { repoPath: null });
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { repoPath: null, repoUrl: null, repoDefaultBranch: 'main' },
    });
    expect(res).toEqual({ ok: true });
  });
});
