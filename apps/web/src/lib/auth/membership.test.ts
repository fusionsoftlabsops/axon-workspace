import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({ prisma: { project: { findUnique: mocks.findUnique } } }));

import { assertProjectMember } from './membership';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('assertProjectMember', () => {
  it('rejects when there is no session / user id', async () => {
    mocks.auth.mockResolvedValue(null);
    expect(await assertProjectMember('axon')).toEqual({ ok: false, error: 'No autenticado' });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('rejects when the session has no user.id', async () => {
    mocks.auth.mockResolvedValue({ user: {} });
    expect(await assertProjectMember('axon')).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects when the project does not exist', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'u1' } });
    mocks.findUnique.mockResolvedValue(null);
    expect(await assertProjectMember('axon')).toEqual({
      ok: false,
      error: 'Proyecto no encontrado',
    });
  });

  it('rejects when the user is not a member of the project', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'u1' } });
    mocks.findUnique.mockResolvedValue({ id: 'p1', members: [] });
    expect(await assertProjectMember('axon')).toEqual({
      ok: false,
      error: 'Proyecto no encontrado',
    });
  });

  it('returns the membership context for a member', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'u1' } });
    mocks.findUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'OWNER' }] });
    const ctx = await assertProjectMember('axon');
    expect(ctx).toEqual({ ok: true, projectId: 'p1', userId: 'u1', role: 'OWNER' });
    // queried by slug, scoped membership to the user
    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'axon' } }),
    );
  });
});
