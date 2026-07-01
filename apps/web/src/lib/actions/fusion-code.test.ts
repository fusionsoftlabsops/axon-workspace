import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  assert: vi.fn(),
  audit: vi.fn(),
  genToken: vi.fn(() => ({ plain: 'ad_pk_PLAINTOKEN', hash: 'hash', prefix: 'ad_pk_PLAIN' })),
  apiTokenCreate: vi.fn(),
  env: vi.fn(() => ({ AXON_MCP_URL: 'https://mcp-axon.test/mcp' })),
}));

vi.mock('@/auth', () => ({ auth: m.auth }));
vi.mock('@/lib/db', () => ({ prisma: { apiToken: { create: m.apiTokenCreate } } }));
vi.mock('@/lib/audit', () => ({ audit: m.audit }));
vi.mock('@/lib/api-auth', () => ({ generateApiToken: m.genToken }));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: m.assert }));
vi.mock('@/lib/env', () => ({ env: m.env }));

import { createProjectAgentTokenAction } from './fusion-code';

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: 'u1' } });
  m.assert.mockResolvedValue({ ok: true, projectId: 'p1', userId: 'u1', role: 'ADMIN' });
  m.apiTokenCreate.mockResolvedValue({ id: 'tok1' });
  m.env.mockReturnValue({ AXON_MCP_URL: 'https://mcp-axon.test/mcp' });
});

describe('createProjectAgentTokenAction', () => {
  it('rejects unauthenticated', async () => {
    m.auth.mockResolvedValue(null);
    expect(await createProjectAgentTokenAction('slug')).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects a non-member', async () => {
    m.assert.mockResolvedValue({ ok: false, error: 'Proyecto no encontrado' });
    expect(await createProjectAgentTokenAction('slug')).toEqual({ ok: false, error: 'Proyecto no encontrado' });
  });

  it('rejects a VIEWER', async () => {
    m.assert.mockResolvedValue({ ok: true, projectId: 'p1', userId: 'u1', role: 'VIEWER' });
    expect(await createProjectAgentTokenAction('slug')).toEqual({
      ok: false,
      error: 'Sin permisos para generar el token',
    });
  });

  it('mints an ad_pk_ token scoped to the project and returns it once', async () => {
    const r = await createProjectAgentTokenAction('my-proj');
    expect(r.ok).toBe(true);
    expect(m.apiTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          name: 'Fusion Code – my-proj',
          projectSlugs: ['my-proj'],
          scopes: ['tasks:read', 'tasks:write', 'comments:write', 'brain:read', 'brain:write', 'skills:read', 'skills:write'],
        }),
      }),
    );
    if (r.ok) {
      expect(r.data).toEqual({
        plainToken: 'ad_pk_PLAINTOKEN',
        mcpUrl: 'https://mcp-axon.test/mcp',
        projectSlug: 'my-proj',
      });
    }
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'api_token.create' }));
  });
});
