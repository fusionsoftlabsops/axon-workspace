import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  agentFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  taskFindUnique: vi.fn(),
  listTeamMessages: vi.fn(),
  postTeamMessage: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken: h.requireApiToken,
  tokenAllowsProject: (a: { projectSlugs: string[] }, s: string) =>
    a.projectSlugs.length === 0 || a.projectSlugs.includes(s),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: h.projectFindUnique },
    agent: { findFirst: h.agentFindFirst },
    user: { findUnique: h.userFindUnique },
    task: { findUnique: h.taskFindUnique },
  },
}));
vi.mock('@/lib/agents/team-chat', () => ({
  agentDisplayName: (role: string, name: string | null) => `${name ?? 'Kai'} · ${role}`,
  listTeamMessages: h.listTeamMessages,
  postTeamMessage: h.postTeamMessage,
}));

import { GET, POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj' }) };
const authd = { userId: 'u1', tokenId: 't1', scopes: [], projectSlugs: [] as string[] };

function getReq(qs = '') {
  return new NextRequest(`http://localhost/x${qs}`);
}
function postReq(body: unknown) {
  return new NextRequest('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ ...authd });
});

describe('GET team-chat', () => {
  it('401 auth fails', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await GET(getReq(), ctx)).status).toBe(401);
  });
  it('403 not scoped', async () => {
    h.requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['other'] });
    expect((await GET(getReq(), ctx)).status).toBe(403);
  });
  it('404 project missing', async () => {
    h.projectFindUnique.mockResolvedValue(null);
    expect((await GET(getReq(), ctx)).status).toBe(404);
  });
  it('404 not a member', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [] });
    expect((await GET(getReq(), ctx)).status).toBe(404);
  });
  it('200 returns the thread', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
    h.listTeamMessages.mockResolvedValue([{ id: 'm1', body: 'hola' }]);
    const res = await GET(getReq('?limit=50'), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messages: [{ id: 'm1', body: 'hola' }] });
    expect(h.listTeamMessages).toHaveBeenCalledWith('p1', 50);
  });
});

describe('POST team-chat', () => {
  it('401 auth fails', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await POST(postReq({ body: 'hola' }), ctx)).status).toBe(401);
  });
  it('403 not scoped', async () => {
    h.requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['other'] });
    expect((await POST(postReq({ body: 'hola' }), ctx)).status).toBe(403);
  });
  it('404 project missing', async () => {
    h.projectFindUnique.mockResolvedValue(null);
    expect((await POST(postReq({ body: 'hola' }), ctx)).status).toBe(404);
  });
  it('403 viewer cannot post', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'VIEWER' }] });
    expect((await POST(postReq({ body: 'hola' }), ctx)).status).toBe(403);
  });
  it('400 invalid body', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
    expect((await POST(postReq({ body: '' }), ctx)).status).toBe(400);
  });
  it('403 disabled agent', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
    h.agentFindFirst.mockResolvedValue({ role: 'DEV', displayName: null, enabled: false });
    expect((await POST(postReq({ body: 'hola' }), ctx)).status).toBe(403);
  });
  it('201 posts as an agent (name · role) and narrates via HANDOFF', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
    h.agentFindFirst.mockResolvedValue({ role: 'DEV', displayName: 'Kai', enabled: true });
    h.postTeamMessage.mockResolvedValue({ id: 'm1', authorName: 'Kai · DEV' });
    const res = await POST(postReq({ body: 'Terminé la HU', kind: 'HANDOFF' }), ctx);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ message: { id: 'm1', authorName: 'Kai · DEV' } });
    expect(h.postTeamMessage).toHaveBeenCalledWith(
      expect.objectContaining({ agentRole: 'DEV', authorName: 'Kai · DEV', kind: 'HANDOFF', body: 'Terminé la HU' }),
    );
  });
  it('201 posts as a human (falls back to user name)', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'MEMBER' }] });
    h.agentFindFirst.mockResolvedValue(null);
    h.userFindUnique.mockResolvedValue({ name: 'Manuel' });
    h.postTeamMessage.mockResolvedValue({ id: 'm2', authorName: 'Manuel' });
    const res = await POST(postReq({ body: 'hola equipo' }), ctx);
    expect(res.status).toBe(201);
    expect(h.postTeamMessage).toHaveBeenCalledWith(
      expect.objectContaining({ agentRole: null, authorName: 'Manuel', kind: 'CHAT' }),
    );
  });
  it('resolves an optional storyNumber to a storyId', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
    h.agentFindFirst.mockResolvedValue(null);
    h.userFindUnique.mockResolvedValue({ name: 'Manuel' });
    h.taskFindUnique.mockResolvedValue({ id: 'task-24' });
    h.postTeamMessage.mockResolvedValue({ id: 'm3' });
    await POST(postReq({ body: 'sobre la HU 24', storyNumber: 24 }), ctx);
    expect(h.taskFindUnique).toHaveBeenCalledWith({
      where: { projectId_taskNumber: { projectId: 'p1', taskNumber: 24 } },
      select: { id: true },
    });
    expect(h.postTeamMessage).toHaveBeenCalledWith(expect.objectContaining({ storyId: 'task-24', storyNumber: 24 }));
  });
});
