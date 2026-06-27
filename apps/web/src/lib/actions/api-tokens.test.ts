import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, auditMock, authMock, genTokenMock, revalidateMock } = vi.hoisted(() => ({
  prismaMock: {
    project: { count: vi.fn() },
    apiToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
  auditMock: vi.fn(),
  authMock: vi.fn(),
  genTokenMock: vi.fn(),
  revalidateMock: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('@/lib/api-auth', () => ({ generateApiToken: genTokenMock }));

import { createApiTokenAction, revokeApiTokenAction } from './api-tokens';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  genTokenMock.mockReturnValue({ plain: 'plain', hash: 'hash', prefix: 'pfx' });
});

describe('createApiTokenAction', () => {
  const validInput = { name: 'tok', scopes: ['tasks:read' as const] };

  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await createApiTokenAction(validInput)).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects invalid input', async () => {
    const res = await createApiTokenAction({ name: '', scopes: [] } as never);
    expect(res).toEqual({ ok: false, error: 'Datos inválidos' });
  });

  it('rejects when some projectSlugs are not the user’s', async () => {
    prismaMock.project.count.mockResolvedValue(1);
    const res = await createApiTokenAction({ ...validInput, projectSlugs: ['a', 'b'] });
    expect(res).toEqual({ ok: false, error: 'Algunos proyectos no son tuyos' });
  });

  it('creates the token, audits and revalidates', async () => {
    prismaMock.project.count.mockResolvedValue(2);
    prismaMock.apiToken.create.mockResolvedValue({ id: 't1', name: 'tok', scopes: ['tasks:read'] });
    const res = await createApiTokenAction({ ...validInput, projectSlugs: ['a', 'b'] });
    expect(prismaMock.apiToken.create).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'api_token.create' }));
    expect(revalidateMock).toHaveBeenCalledWith('/settings/tokens');
    expect(res).toEqual({ ok: true, plainToken: 'plain', prefix: 'pfx' });
  });

  it('creates the token with no projectSlugs (defaults to empty)', async () => {
    prismaMock.apiToken.create.mockResolvedValue({ id: 't1', name: 'tok', scopes: ['tasks:read'] });
    const res = await createApiTokenAction(validInput);
    expect(prismaMock.project.count).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: true });
  });
});

describe('revokeApiTokenAction', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await revokeApiTokenAction('t1')).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects when the token is missing or not owned', async () => {
    prismaMock.apiToken.findUnique.mockResolvedValue(null);
    expect(await revokeApiTokenAction('t1')).toEqual({ ok: false, error: 'Token no encontrado' });

    prismaMock.apiToken.findUnique.mockResolvedValue({ id: 't1', userId: 'other' });
    expect(await revokeApiTokenAction('t1')).toEqual({ ok: false, error: 'Token no encontrado' });
  });

  it('revokes the token, audits and revalidates', async () => {
    prismaMock.apiToken.findUnique.mockResolvedValue({ id: 't1', userId: 'u1' });
    const res = await revokeApiTokenAction('t1');
    expect(prismaMock.apiToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' } }),
    );
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'api_token.revoke' }));
    expect(res).toEqual({ ok: true });
  });
});
