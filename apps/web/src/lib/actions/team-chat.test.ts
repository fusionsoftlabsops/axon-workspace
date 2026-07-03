import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  assertProjectMember: vi.fn(),
  userFindUnique: vi.fn(),
  listTeamMessages: vi.fn(),
  postTeamMessage: vi.fn(),
}));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: h.assertProjectMember }));
vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique: h.userFindUnique } } }));
vi.mock('@/lib/agents/team-chat', () => ({
  listTeamMessages: h.listTeamMessages,
  postTeamMessage: h.postTeamMessage,
}));

import { listTeamChatAction, postTeamChatAction } from './team-chat';

const MEMBER = { ok: true as const, userId: 'u1', projectId: 'p1', role: 'MEMBER' as const };

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.assertProjectMember.mockResolvedValue(MEMBER);
});

describe('listTeamChatAction', () => {
  it('propagates the membership error', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await listTeamChatAction('axon')).toEqual({ ok: false, error: 'nope' });
  });

  it('returns the thread for a member', async () => {
    h.listTeamMessages.mockResolvedValue([{ id: 'm1' }]);
    const res = await listTeamChatAction('axon', 50);
    expect(res).toEqual({ ok: true, data: [{ id: 'm1' }] });
    expect(h.listTeamMessages).toHaveBeenCalledWith('p1', 50);
  });
});

describe('postTeamChatAction', () => {
  it('propagates the membership error', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await postTeamChatAction('axon', 'hola')).toEqual({ ok: false, error: 'nope' });
  });

  it('blocks VIEWERs from writing', async () => {
    h.assertProjectMember.mockResolvedValue({ ...MEMBER, role: 'VIEWER' });
    expect(await postTeamChatAction('axon', 'hola')).toEqual({ ok: false, error: 'Sin permisos para escribir' });
  });

  it('rejects an empty or oversized message', async () => {
    expect(await postTeamChatAction('axon', '   ')).toEqual({ ok: false, error: 'Mensaje vacío' });
    expect(await postTeamChatAction('axon', 'x'.repeat(20_001))).toEqual({
      ok: false,
      error: 'Mensaje demasiado largo',
    });
  });

  it('posts as the human member, resolving the display name', async () => {
    h.userFindUnique.mockResolvedValue({ name: 'Manuel' });
    h.postTeamMessage.mockResolvedValue({ id: 'm1', authorName: 'Manuel' });
    const res = await postTeamChatAction('axon', '  hola equipo  ');
    expect(res).toEqual({ ok: true, data: { id: 'm1', authorName: 'Manuel' } });
    expect(h.postTeamMessage).toHaveBeenCalledWith({
      projectId: 'p1',
      authorId: 'u1',
      agentRole: null,
      authorName: 'Manuel',
      kind: 'CHAT',
      body: 'hola equipo',
    });
  });

  it('falls back to a generic name when the user has none set', async () => {
    h.userFindUnique.mockResolvedValue({ name: null });
    h.postTeamMessage.mockResolvedValue({ id: 'm2' });
    await postTeamChatAction('axon', 'hola');
    expect(h.postTeamMessage).toHaveBeenCalledWith(expect.objectContaining({ authorName: 'Miembro' }));
  });
});
