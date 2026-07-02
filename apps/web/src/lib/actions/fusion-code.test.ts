import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  assert: vi.fn(),
  audit: vi.fn(),
  genToken: vi.fn(() => ({ plain: 'ad_pk_PLAINTOKEN', hash: 'hash', prefix: 'ad_pk_PLAIN' })),
  apiTokenCreate: vi.fn(),
  env: vi.fn(() => ({ AXON_MCP_URL: 'https://mcp-axon.test/mcp' })),
  isFusionConfigured: vi.fn(() => true),
  getExposedModels: vi.fn(),
  createModelToken: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: m.auth }));
vi.mock('@/lib/db', () => ({ prisma: { apiToken: { create: m.apiTokenCreate } } }));
vi.mock('@/lib/audit', () => ({ audit: m.audit }));
vi.mock('@/lib/api-auth', () => ({ generateApiToken: m.genToken }));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: m.assert }));
vi.mock('@/lib/env', () => ({ env: m.env }));
vi.mock('@/lib/deploy/fusion-coding-tools', () => ({
  isFusionConfigured: m.isFusionConfigured,
  getExposedModels: m.getExposedModels,
  createModelToken: m.createModelToken,
}));

import { createModelSetupAction, createProjectAgentTokenAction } from './fusion-code';

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: 'u1' } });
  m.assert.mockResolvedValue({ ok: true, projectId: 'p1', userId: 'u1', role: 'ADMIN' });
  m.apiTokenCreate.mockResolvedValue({ id: 'tok1' });
  m.env.mockReturnValue({ AXON_MCP_URL: 'https://mcp-axon.test/mcp' });
  m.isFusionConfigured.mockReturnValue(true);
  m.getExposedModels.mockResolvedValue([
    { appId: 'app1', name: 'vllm', url: 'https://vllm-api.test' },
  ]);
  m.createModelToken.mockResolvedValue({
    id: 'mt1',
    name: 'Fusion Code – Ana – axon/my-proj',
    createdAt: 'now',
    token: 'fsn_SECRET',
  });
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

describe('createModelSetupAction', () => {
  it('rejects unauthenticated', async () => {
    m.auth.mockResolvedValue(null);
    expect(await createModelSetupAction('slug')).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects a non-member', async () => {
    m.assert.mockResolvedValue({ ok: false, error: 'Proyecto no encontrado' });
    expect(await createModelSetupAction('slug')).toEqual({ ok: false, error: 'Proyecto no encontrado' });
  });

  it('allows a VIEWER (the token only grants model usage, not Axon writes)', async () => {
    m.assert.mockResolvedValue({ ok: true, projectId: 'p1', userId: 'u1', role: 'VIEWER' });
    const r = await createModelSetupAction('my-proj');
    expect(r.ok).toBe(true);
  });

  it('fails clearly when fusion-infra is not configured', async () => {
    m.isFusionConfigured.mockReturnValue(false);
    const r = await createModelSetupAction('my-proj');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no está configurada/);
    expect(m.createModelToken).not.toHaveBeenCalled();
  });

  it('fails clearly when no model is exposed', async () => {
    m.getExposedModels.mockResolvedValue([]);
    const r = await createModelSetupAction('my-proj');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/modelo expuesto/);
  });

  it('mints an fsn_ token named after the user and project, returns url with /v1, and audits', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1', name: 'Ana', email: 'ana@test.dev' } });
    const r = await createModelSetupAction('my-proj');
    expect(m.createModelToken).toHaveBeenCalledWith('app1', 'Fusion Code – Ana – axon/my-proj');
    expect(r).toEqual({
      ok: true,
      data: { modelUrl: 'https://vllm-api.test/v1', token: 'fsn_SECRET' },
    });
    expect(m.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'model_token.create',
        resourceType: 'model_token',
        resourceId: 'mt1',
        projectId: 'p1',
      }),
    );
  });

  it('falls back to the email when the user has no name', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1', email: 'ana@test.dev' } });
    await createModelSetupAction('my-proj');
    expect(m.createModelToken).toHaveBeenCalledWith('app1', 'Fusion Code – ana@test.dev – axon/my-proj');
  });

  it('surfaces fusion-infra errors as a friendly message', async () => {
    m.createModelToken.mockRejectedValue(new Error('fusion-infra 401: Invalid or expired API token'));
    const r = await createModelSetupAction('my-proj');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/No se pudo generar el token del modelo: fusion-infra 401/);
  });
});
