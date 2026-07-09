import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- mutable env (the action reads env() for TEAM_ID / SERVER_ID / GITHUB_TOKEN) ----
let envConfig: Record<string, unknown>;
vi.mock('@/lib/env', () => ({ env: () => envConfig }));

const { prismaMock, auditMock, assertMock, fusionMock, startPollingMock, revalidateMock } = vi.hoisted(
  () => {
    const fn = () => vi.fn();
    return {
      prismaMock: {
        project: { findUnique: fn() },
        deployTarget: { findUnique: fn(), create: fn() },
        deployment: {
          findFirst: fn(),
          findMany: fn(),
          create: fn(),
          update: fn(),
          upsert: fn(),
          delete: fn(),
        },
        projectRepo: { findFirst: fn(), findMany: fn() },
      },
      auditMock: vi.fn(),
      assertMock: vi.fn(),
      fusionMock: {
        isFusionConfigured: vi.fn(),
        getContext: vi.fn(),
        createProject: vi.fn(),
        listEnvironments: vi.fn(),
        updateEnvironmentClass: vi.fn(),
        listApps: vi.fn(),
        getApp: vi.fn(),
        createApp: vi.fn(),
        deleteApp: vi.fn(),
        deployApp: vi.fn(),
        redeployApp: vi.fn(),
        stopApp: vi.fn(),
        startApp: vi.fn(),
        recreateApp: vi.fn(),
        rollbackApp: vi.fn(),
        setAppEnv: vi.fn(),
        getAppEnvKeys: vi.fn(),
        getDeployment: vi.fn(),
        appDeployments: vi.fn(),
        dbCatalog: vi.fn(),
        createDatabase: vi.fn(),
        getDbCredentials: vi.fn(),
        getEnvironmentPolicy: vi.fn(),
        getProjectGovernance: vi.fn(),
      },
      startPollingMock: vi.fn(),
      revalidateMock: vi.fn(),
    };
  },
);

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: assertMock }));
vi.mock('@/lib/deploy/fusion-client', () => fusionMock);
// Keep the real deriveState (several actions depend on its mapping); spy startPolling.
vi.mock('@/lib/deploy/poll', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/deploy/poll')>();
  return { ...actual, startPolling: startPollingMock };
});

import * as deploy from './deploy';

const OWNER = { ok: true as const, userId: 'u1', projectId: 'p1', role: 'OWNER' as const };

const depRow = {
  id: 'dep1',
  fusionAppId: 'a1',
  kind: 'APP',
  name: 'web',
  status: 'LIVE',
  hostname: 'web.host',
  error: null,
  buildPack: 'DOCKERFILE',
  exposedPort: 3000,
  imported: false,
  lastDeploymentId: 'd0',
  updatedAt: new Date('2020-01-01T00:00:00Z'),
  projectRepo: { id: 'r1', name: 'api' },
};
const target = {
  id: 'dt1',
  projectId: 'p1',
  fusionTeamId: 't1',
  fusionProjectId: 'fp1',
  environmentId: 'e1',
  serverId: 's1',
  deployments: [depRow],
};
const repo = {
  id: 'r1',
  projectId: 'p1',
  name: 'api',
  url: 'https://github.com/o/api',
  defaultBranch: 'main',
  private: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  envConfig = {};
  assertMock.mockResolvedValue(OWNER);
  prismaMock.project.findUnique.mockResolvedValue({ name: 'My Project' });
  fusionMock.isFusionConfigured.mockReturnValue(true);
  prismaMock.deployTarget.findUnique.mockResolvedValue(target);
  prismaMock.deployTarget.create.mockResolvedValue({});
  prismaMock.projectRepo.findMany.mockResolvedValue([]);
  prismaMock.projectRepo.findFirst.mockResolvedValue(repo);
  prismaMock.deployment.findFirst.mockResolvedValue(depRow);
  prismaMock.deployment.findMany.mockResolvedValue([]);
  prismaMock.deployment.create.mockResolvedValue({ id: 'newdep' });
  prismaMock.deployment.update.mockResolvedValue({});
  prismaMock.deployment.upsert.mockResolvedValue({});
  prismaMock.deployment.delete.mockResolvedValue({});
  auditMock.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------- guard ----
describe('guard', () => {
  it('propagates the membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'no eres miembro' });
    expect(await deploy.getDeployViewAction('slug')).toEqual({ ok: false, error: 'no eres miembro' });
  });

  it('blocks non OWNER/ADMIN on a mutating action', async () => {
    assertMock.mockResolvedValue({ ...OWNER, role: 'VIEWER' });
    const res = await deploy.connectDeployTargetAction('slug');
    expect(res).toEqual({ ok: false, error: 'Solo OWNER/ADMIN pueden gestionar despliegues' });
  });

  it('falls back to the slug when the project row has no name', async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);
    fusionMock.isFusionConfigured.mockReturnValue(true);
    prismaMock.deployTarget.findUnique.mockResolvedValue(null);
    fusionMock.getContext.mockResolvedValue({ defaultTeamId: 't1', servers: [{ id: 's1', teamId: 't1', agentStatus: 'ONLINE' }] });
    fusionMock.createProject.mockResolvedValue({ id: 'fp1', environments: [{ id: 'e1', name: 'production' }] });
    await deploy.connectDeployTargetAction('myslug');
    expect(fusionMock.createProject).toHaveBeenCalledWith('myslug', 't1');
  });
});

// ------------------------------------------------------ getDeployViewAction ----
describe('getDeployViewAction', () => {
  it('maps target, deployments and repos (url derivation + deployed flag)', async () => {
    prismaMock.projectRepo.findMany.mockResolvedValue([
      { id: 'r1', name: 'api', kind: 'service', url: 'https://gh/api', deployments: [{ id: 'x' }] },
      { id: 'r2', name: 'web', kind: 'service', url: null, deployments: [] },
    ]);
    const res = await deploy.getDeployViewAction('slug');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.configured).toBe(true);
    expect(res.data.connected).toBe(true);
    expect(res.data.target).toEqual({ fusionTeamId: 't1', fusionProjectId: 'fp1', environmentId: 'e1', serverId: 's1' });
    expect(res.data.repos).toEqual([
      { id: 'r1', name: 'api', kind: 'service', url: 'https://gh/api', deployed: true },
      { id: 'r2', name: 'web', kind: 'service', url: null, deployed: false },
    ]);
    const view = res.data.deployments[0]!;
    expect(view.url).toBe('https://web.host');
    expect(view.kind).toBe('APP');
    expect(view.repoId).toBe('r1');
    expect(view.updatedAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('handles a disconnected project + DB kind / null status / null hostname / null repo', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValueOnce({
      ...target,
      deployments: [
        { ...depRow, id: 'd2', kind: 'DATABASE', status: null, hostname: null, projectRepo: null, lastDeploymentId: null },
      ],
    });
    const res = await deploy.getDeployViewAction('slug');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const v = res.data.deployments[0]!;
    expect(v.kind).toBe('DATABASE');
    expect(v.status).toBe('PENDING');
    expect(v.url).toBeNull();
    expect(v.repoId).toBeNull();
  });

  it('reports not connected when there is no target', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValue(null);
    const res = await deploy.getDeployViewAction('slug');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.connected).toBe(false);
      expect(res.data.target).toBeNull();
      expect(res.data.deployments).toEqual([]);
    }
  });
});

// --------------------------------------------------- getConnectOptionsAction ----
describe('getConnectOptionsAction', () => {
  it('rejects when not configured', async () => {
    fusionMock.isFusionConfigured.mockReturnValue(false);
    const res = await deploy.getConnectOptionsAction('slug');
    expect(res.ok).toBe(false);
  });

  it('filters servers by the resolved team id', async () => {
    fusionMock.getContext.mockResolvedValue({
      defaultTeamId: 't1',
      servers: [
        { id: 's1', name: 'A', teamId: 't1', agentStatus: 'ONLINE' },
        { id: 's2', name: 'B', teamId: 't2', agentStatus: 'ONLINE' },
      ],
    });
    const res = await deploy.getConnectOptionsAction('slug');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.servers).toEqual([{ id: 's1', name: 'A', agentStatus: 'ONLINE' }]);
      expect(res.data.defaultTeamId).toBe('t1');
    }
  });

  it('uses FUSION_INFRA_TEAM_ID override for filtering', async () => {
    envConfig = { FUSION_INFRA_TEAM_ID: 't2' };
    fusionMock.getContext.mockResolvedValue({
      defaultTeamId: 't1',
      servers: [
        { id: 's1', name: 'A', teamId: 't1', agentStatus: 'ONLINE' },
        { id: 's2', name: 'B', teamId: 't2', agentStatus: 'OFFLINE' },
      ],
    });
    const res = await deploy.getConnectOptionsAction('slug');
    expect(res.ok && res.data.servers.map((s) => s.id)).toEqual(['s2']);
  });

  it('returns the error when getContext throws', async () => {
    fusionMock.getContext.mockRejectedValue(new Error('cp down'));
    expect(await deploy.getConnectOptionsAction('slug')).toEqual({ ok: false, error: 'cp down' });
  });

  it('lists the existing fusion-infra projects of the team (with environments)', async () => {
    fusionMock.getContext.mockResolvedValue({
      defaultTeamId: 't1',
      servers: [],
      projects: [
        { id: 'fpA', name: 'axon', teamId: 't1', environments: [{ id: 'eA', name: 'production' }] },
        { id: 'fpB', name: 'otro-team', teamId: 't2', environments: [] },
      ],
    });
    const res = await deploy.getConnectOptionsAction('slug');
    expect(res.ok && res.data.projects).toEqual([
      { id: 'fpA', name: 'axon', environments: [{ id: 'eA', name: 'production' }] },
    ]);
  });
});

// -------------------------------------------------- connectDeployTargetAction ----
describe('connectDeployTargetAction', () => {
  it('rejects when not configured', async () => {
    fusionMock.isFusionConfigured.mockReturnValue(false);
    const res = await deploy.connectDeployTargetAction('slug');
    expect(res.ok).toBe(false);
  });

  it('is idempotent when a target already exists', async () => {
    // loadTarget returns target → returns loadView, never creates.
    const res = await deploy.connectDeployTargetAction('slug');
    expect(res.ok).toBe(true);
    expect(fusionMock.createProject).not.toHaveBeenCalled();
  });

  it('errors when there is no default team', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValue(null);
    fusionMock.getContext.mockResolvedValue({ defaultTeamId: null, servers: [] });
    const res = await deploy.connectDeployTargetAction('slug');
    expect(res).toEqual({ ok: false, error: 'fusion-infra: sin team por defecto; configura FUSION_INFRA_TEAM_ID' });
  });

  it('resolves an explicit serverId and creates the target (production env)', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValueOnce(null).mockResolvedValue(target);
    fusionMock.getContext.mockResolvedValue({
      defaultTeamId: 't1',
      servers: [{ id: 's9', teamId: 't1', agentStatus: 'OFFLINE' }],
    });
    fusionMock.createProject.mockResolvedValue({ id: 'fp1', environments: [{ id: 'edev', name: 'dev' }, { id: 'eprod', name: 'Production' }] });
    const res = await deploy.connectDeployTargetAction('slug', { serverId: 's9' });
    expect(res.ok).toBe(true);
    expect(prismaMock.deployTarget.create).toHaveBeenCalledWith({
      data: { projectId: 'p1', fusionTeamId: 't1', fusionProjectId: 'fp1', environmentId: 'eprod', serverId: 's9' },
    });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'deploy.connect' }));
    expect(revalidateMock).toHaveBeenCalledWith('/projects/slug/deploy');
  });

  it('uses FUSION_INFRA_SERVER_ID when no explicit server and picks envs[0] without production', async () => {
    envConfig = { FUSION_INFRA_SERVER_ID: 's-env' };
    prismaMock.deployTarget.findUnique.mockResolvedValueOnce(null).mockResolvedValue(target);
    fusionMock.getContext.mockResolvedValue({ defaultTeamId: 't1', servers: [] });
    fusionMock.createProject.mockResolvedValue({ id: 'fp1', environments: [{ id: 'estaging', name: 'staging' }] });
    await deploy.connectDeployTargetAction('slug');
    expect(prismaMock.deployTarget.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ serverId: 's-env', environmentId: 'estaging' }) }),
    );
  });

  it('auto-picks the single ONLINE server', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValueOnce(null).mockResolvedValue(target);
    fusionMock.getContext.mockResolvedValue({ defaultTeamId: 't1', servers: [{ id: 's1', teamId: 't1', agentStatus: 'ONLINE' }] });
    fusionMock.createProject.mockResolvedValue({ id: 'fp1', environments: [{ id: 'e1', name: 'production' }] });
    await deploy.connectDeployTargetAction('slug');
    expect(prismaMock.deployTarget.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ serverId: 's1' }) }));
  });

  it('errors when multiple ONLINE servers are ambiguous', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValue(null);
    fusionMock.getContext.mockResolvedValue({
      defaultTeamId: 't1',
      servers: [
        { id: 's1', teamId: 't1', agentStatus: 'ONLINE' },
        { id: 's2', teamId: 't1', agentStatus: 'ONLINE' },
      ],
    });
    const res = await deploy.connectDeployTargetAction('slug');
    expect(res).toEqual({ ok: false, error: 'Elige un servidor de destino' });
  });

  it('errors when no servers are ONLINE', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValue(null);
    fusionMock.getContext.mockResolvedValue({ defaultTeamId: 't1', servers: [{ id: 's1', teamId: 't1', agentStatus: 'OFFLINE' }] });
    const res = await deploy.connectDeployTargetAction('slug');
    expect(res).toEqual({ ok: false, error: 'No hay servidores ONLINE en fusion-infra para desplegar' });
  });

  it('falls back to listEnvironments and errors when the project has no envs', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValue(null);
    fusionMock.getContext.mockResolvedValue({ defaultTeamId: 't1', servers: [{ id: 's1', teamId: 't1', agentStatus: 'ONLINE' }] });
    fusionMock.createProject.mockResolvedValue({ id: 'fp1' }); // no environments
    fusionMock.listEnvironments.mockResolvedValue([]);
    const res = await deploy.connectDeployTargetAction('slug');
    expect(fusionMock.listEnvironments).toHaveBeenCalledWith('fp1', 't1');
    expect(res).toEqual({ ok: false, error: 'fusion-infra creó el proyecto sin entornos' });
  });

  it('returns the error message when createProject throws', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValue(null);
    fusionMock.getContext.mockResolvedValue({ defaultTeamId: 't1', servers: [{ id: 's1', teamId: 't1', agentStatus: 'ONLINE' }] });
    fusionMock.createProject.mockRejectedValue(new Error('boom'));
    expect(await deploy.connectDeployTargetAction('slug')).toEqual({ ok: false, error: 'boom' });
  });

  it('enlaza un proyecto fusion-infra EXISTENTE sin crear nada ni tocar envClass', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValueOnce(null).mockResolvedValue(target);
    fusionMock.getContext.mockResolvedValue({
      defaultTeamId: 't1',
      servers: [{ id: 's1', teamId: 't1', agentStatus: 'ONLINE' }],
      projects: [
        {
          id: 'fpX',
          name: 'axon',
          teamId: 't1',
          environments: [{ id: 'eDev', name: 'dev' }, { id: 'eProd', name: 'Production' }],
        },
      ],
    });
    const res = await deploy.connectDeployTargetAction('slug', { fusionProjectId: 'fpX', envClass: 'PROD' });
    expect(res.ok).toBe(true);
    expect(fusionMock.createProject).not.toHaveBeenCalled();
    expect(fusionMock.updateEnvironmentClass).not.toHaveBeenCalled();
    expect(prismaMock.deployTarget.create).toHaveBeenCalledWith({
      data: { projectId: 'p1', fusionTeamId: 't1', fusionProjectId: 'fpX', environmentId: 'eProd', serverId: 's1' },
    });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ linkedExisting: true }) }),
    );
  });

  it('respeta el environmentId elegido del proyecto existente', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValueOnce(null).mockResolvedValue(target);
    fusionMock.getContext.mockResolvedValue({
      defaultTeamId: 't1',
      servers: [{ id: 's1', teamId: 't1', agentStatus: 'ONLINE' }],
      projects: [
        { id: 'fpX', name: 'axon', teamId: 't1', environments: [{ id: 'eDev', name: 'dev' }, { id: 'eProd', name: 'production' }] },
      ],
    });
    await deploy.connectDeployTargetAction('slug', { fusionProjectId: 'fpX', environmentId: 'eDev' });
    expect(prismaMock.deployTarget.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ environmentId: 'eDev' }) }),
    );
  });

  it('cae a listEnvironments cuando el proyecto existente viene sin environments', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValueOnce(null).mockResolvedValue(target);
    fusionMock.getContext.mockResolvedValue({
      defaultTeamId: 't1',
      servers: [{ id: 's1', teamId: 't1', agentStatus: 'ONLINE' }],
      projects: [{ id: 'fpX', name: 'axon', teamId: 't1', environments: [] }],
    });
    fusionMock.listEnvironments.mockResolvedValue([{ id: 'eOnly', name: 'staging' }]);
    await deploy.connectDeployTargetAction('slug', { fusionProjectId: 'fpX' });
    expect(fusionMock.listEnvironments).toHaveBeenCalledWith('fpX', 't1');
    expect(prismaMock.deployTarget.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ environmentId: 'eOnly' }) }),
    );
  });

  it('rechaza un fusionProjectId que no existe en el team', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValue(null);
    fusionMock.getContext.mockResolvedValue({
      defaultTeamId: 't1',
      servers: [{ id: 's1', teamId: 't1', agentStatus: 'ONLINE' }],
      projects: [{ id: 'fpOther', name: 'x', teamId: 't2', environments: [] }],
    });
    expect(await deploy.connectDeployTargetAction('slug', { fusionProjectId: 'fpOther' })).toEqual({
      ok: false,
      error: 'Proyecto fusion-infra no encontrado en el team',
    });
  });

  it('rechaza un environmentId que no pertenece al proyecto existente', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValue(null);
    fusionMock.getContext.mockResolvedValue({
      defaultTeamId: 't1',
      servers: [{ id: 's1', teamId: 't1', agentStatus: 'ONLINE' }],
      projects: [{ id: 'fpX', name: 'axon', teamId: 't1', environments: [{ id: 'eProd', name: 'production' }] }],
    });
    expect(await deploy.connectDeployTargetAction('slug', { fusionProjectId: 'fpX', environmentId: 'nope' })).toEqual({
      ok: false,
      error: 'El proyecto fusion-infra no tiene ese entorno',
    });
  });
});

// ----------------------------------------------------------- deployRepoAction ----
describe('deployRepoAction', () => {
  const input = { exposedPort: 8080 };

  it('rejects when not configured', async () => {
    fusionMock.isFusionConfigured.mockReturnValue(false);
    expect((await deploy.deployRepoAction('slug', 'r1', input)).ok).toBe(false);
  });

  it('errors when there is no target', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValue(null);
    expect(await deploy.deployRepoAction('slug', 'r1', input)).toEqual({
      ok: false,
      error: 'Conecta el proyecto a la infraestructura primero',
    });
  });

  it('errors when the repo is missing', async () => {
    prismaMock.projectRepo.findFirst.mockResolvedValue(null);
    expect(await deploy.deployRepoAction('slug', 'r1', input)).toEqual({ ok: false, error: 'Repo no encontrado' });
  });

  it('errors when the repo has no url', async () => {
    prismaMock.projectRepo.findFirst.mockResolvedValue({ ...repo, url: null });
    expect(await deploy.deployRepoAction('slug', 'r1', input)).toEqual({
      ok: false,
      error: 'El repo no tiene URL de GitHub para desplegar',
    });
  });

  it('creates + deploys a new app (private repo → gitToken, default Dockerfile, branch)', async () => {
    envConfig = { GITHUB_TOKEN: 'ghp_secret' };
    prismaMock.projectRepo.findFirst.mockResolvedValue({ ...repo, private: true, defaultBranch: 'develop' });
    prismaMock.deployment.findFirst.mockResolvedValue(null); // no existing
    fusionMock.createApp.mockResolvedValue({ id: 'a1', name: 'slug-api', hostname: 'h.host' });
    fusionMock.deployApp.mockResolvedValue({ deploymentId: 'd1' });
    prismaMock.deployment.create.mockResolvedValue({ id: 'depNew' });
    const res = await deploy.deployRepoAction('slug', 'r1', { exposedPort: 8080, env: { K: 'v' } });
    expect(res.ok).toBe(true);
    expect(fusionMock.createApp).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'slug-api',
        environmentId: 'e1',
        serverId: 's1',
        buildPack: 'DOCKERFILE',
        repository: 'https://github.com/o/api',
        branch: 'develop',
        dockerfilePath: 'Dockerfile',
        exposedPort: 8080,
        gitToken: 'ghp_secret',
        // main = producción: NODE_ENV se inyecta por defecto junto al env pedido.
        env: { NODE_ENV: 'production', K: 'v' },
      }),
      't1',
    );
    expect(fusionMock.deployApp).toHaveBeenCalledWith('a1', 't1');
    expect(startPollingMock).toHaveBeenCalledWith('depNew', 't1');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'deploy.create' }));
  });

  it('uses a custom dockerfilePath and omits gitToken for a public repo', async () => {
    prismaMock.deployment.findFirst.mockResolvedValue(null);
    fusionMock.createApp.mockResolvedValue({ id: 'a1', name: 'slug-api', hostname: 'h' });
    fusionMock.deployApp.mockResolvedValue({ deploymentId: 'd1' });
    await deploy.deployRepoAction('slug', 'r1', { exposedPort: 80, dockerfilePath: 'docker/Dockerfile.prod' });
    expect(fusionMock.createApp).toHaveBeenCalledWith(
      expect.objectContaining({ dockerfilePath: 'docker/Dockerfile.prod', gitToken: undefined, branch: 'main' }),
      't1',
    );
  });

  it('defaults NODE_ENV=production but lets an explicit value override it', async () => {
    prismaMock.deployment.findFirst.mockResolvedValue(null);
    fusionMock.createApp.mockResolvedValue({ id: 'a1', name: 'slug-api', hostname: 'h' });
    fusionMock.deployApp.mockResolvedValue({ deploymentId: 'd1' });
    await deploy.deployRepoAction('slug', 'r1', { exposedPort: 80 });
    expect(fusionMock.createApp).toHaveBeenCalledWith(
      expect.objectContaining({ env: { NODE_ENV: 'production' } }),
      't1',
    );
    fusionMock.createApp.mockClear();
    await deploy.deployRepoAction('slug', 'r1', { exposedPort: 80, env: { NODE_ENV: 'staging' } });
    expect(fusionMock.createApp).toHaveBeenCalledWith(
      expect.objectContaining({ env: { NODE_ENV: 'staging' } }),
      't1',
    );
  });

  it('redeploys when a deployment already exists', async () => {
    prismaMock.deployment.findFirst.mockResolvedValue({ id: 'dep1', fusionAppId: 'a1' });
    fusionMock.redeployApp.mockResolvedValue({ deploymentId: 'd2' });
    const res = await deploy.deployRepoAction('slug', 'r1', input);
    expect(res.ok).toBe(true);
    expect(fusionMock.redeployApp).toHaveBeenCalledWith('a1', 't1');
    expect(prismaMock.deployment.update).toHaveBeenCalledWith({
      where: { id: 'dep1' },
      data: { status: 'BUILDING', lastDeploymentId: 'd2', error: null },
    });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'deploy.redeploy' }));
    expect(startPollingMock).toHaveBeenCalledWith('dep1', 't1');
  });

  it('returns the error when the client throws', async () => {
    prismaMock.deployment.findFirst.mockResolvedValue(null);
    fusionMock.createApp.mockRejectedValue(new Error('build error'));
    expect(await deploy.deployRepoAction('slug', 'r1', input)).toEqual({ ok: false, error: 'build error' });
  });
});

// ------------------------------------------------------------- lifecycleAction ----
describe('lifecycleAction', () => {
  it('errors when the deployment is not found', async () => {
    prismaMock.deployment.findFirst.mockResolvedValue(null);
    expect(await deploy.lifecycleAction('slug', 'dep1', 'stop')).toEqual({ ok: false, error: 'Despliegue no encontrado' });
  });

  it('errors when there is no target', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValue(null);
    expect(await deploy.lifecycleAction('slug', 'dep1', 'stop')).toEqual({ ok: false, error: 'Despliegue no encontrado' });
  });

  it.each(['stop', 'start', 'recreate'] as const)('runs %s, updates, audits and polls', async (op) => {
    fusionMock[`${op}App` as const].mockResolvedValue({ deploymentId: 'dz' });
    const res = await deploy.lifecycleAction('slug', 'dep1', op);
    expect(res.ok).toBe(true);
    expect(fusionMock[`${op}App` as const]).toHaveBeenCalledWith('a1', 't1');
    expect(prismaMock.deployment.update).toHaveBeenCalledWith({
      where: { id: 'dep1' },
      data: { status: 'BUILDING', lastDeploymentId: 'dz', error: null },
    });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: `deploy.${op}` }));
    expect(startPollingMock).toHaveBeenCalledWith('dep1', 't1');
  });

  it('returns the error when the lifecycle op throws', async () => {
    fusionMock.stopApp.mockRejectedValue(new Error('nope'));
    expect(await deploy.lifecycleAction('slug', 'dep1', 'stop')).toEqual({ ok: false, error: 'nope' });
  });
});

// --------------------------------------------------------- rollback (targets + do) ----
describe('getRollbackTargetsAction', () => {
  it('keeps only FINISHED+DEPLOY entries other than the current one', async () => {
    fusionMock.appDeployments.mockResolvedValue([
      { id: 'h1', status: 'FINISHED', operation: 'DEPLOY' },
      { id: 'h2', status: 'FAILED', operation: 'DEPLOY' },
      { id: 'd0', status: 'FINISHED', operation: 'DEPLOY' }, // current lastDeploymentId
      { id: 'h3', status: 'FINISHED', operation: 'STOP' },
    ]);
    const res = await deploy.getRollbackTargetsAction('slug', 'dep1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual([{ id: 'h1', status: 'FINISHED', operation: 'DEPLOY' }]);
  });

  it('errors when the deployment is missing', async () => {
    prismaMock.deployment.findFirst.mockResolvedValue(null);
    expect(await deploy.getRollbackTargetsAction('slug', 'dep1')).toEqual({ ok: false, error: 'Despliegue no encontrado' });
  });

  it('returns the error when appDeployments throws', async () => {
    fusionMock.appDeployments.mockRejectedValue(new Error('history fail'));
    expect(await deploy.getRollbackTargetsAction('slug', 'dep1')).toEqual({ ok: false, error: 'history fail' });
  });
});

describe('rollbackDeploymentAction', () => {
  it('rolls back, updates, audits and polls', async () => {
    fusionMock.rollbackApp.mockResolvedValue({ deploymentId: 'dr' });
    const res = await deploy.rollbackDeploymentAction('slug', 'dep1', 'fd5');
    expect(res.ok).toBe(true);
    expect(fusionMock.rollbackApp).toHaveBeenCalledWith('a1', 'fd5', 't1');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'deploy.rollback', payload: { to: 'fd5' } }));
    expect(startPollingMock).toHaveBeenCalledWith('dep1', 't1');
  });

  it('errors when not found', async () => {
    prismaMock.deployment.findFirst.mockResolvedValue(null);
    expect(await deploy.rollbackDeploymentAction('slug', 'dep1', 'fd5')).toEqual({ ok: false, error: 'Despliegue no encontrado' });
  });

  it('returns the error when rollbackApp throws', async () => {
    fusionMock.rollbackApp.mockRejectedValue(new Error('rb fail'));
    expect(await deploy.rollbackDeploymentAction('slug', 'dep1', 'fd5')).toEqual({ ok: false, error: 'rb fail' });
  });
});

// ------------------------------------------------------------------ env editor ----
describe('getDeployEnvKeysAction', () => {
  it('returns the keys', async () => {
    fusionMock.getAppEnvKeys.mockResolvedValue({ keys: ['A', 'B'] });
    const res = await deploy.getDeployEnvKeysAction('slug', 'dep1');
    expect(res).toEqual({ ok: true, data: ['A', 'B'] });
  });

  it('errors when not found', async () => {
    prismaMock.deployment.findFirst.mockResolvedValue(null);
    expect(await deploy.getDeployEnvKeysAction('slug', 'dep1')).toEqual({ ok: false, error: 'Despliegue no encontrado' });
  });

  it('returns the error when the client throws', async () => {
    fusionMock.getAppEnvKeys.mockRejectedValue(new Error('env fail'));
    expect(await deploy.getDeployEnvKeysAction('slug', 'dep1')).toEqual({ ok: false, error: 'env fail' });
  });
});

describe('setDeployEnvAction', () => {
  it('sets env then redeploys, updates, audits and polls', async () => {
    fusionMock.setAppEnv.mockResolvedValue({ id: 'a1' });
    fusionMock.redeployApp.mockResolvedValue({ deploymentId: 'de' });
    const res = await deploy.setDeployEnvAction('slug', 'dep1', { set: { K: 'v' }, unset: ['OLD'] });
    expect(res.ok).toBe(true);
    expect(fusionMock.setAppEnv).toHaveBeenCalledWith('a1', { envSet: { K: 'v' }, envUnset: ['OLD'] }, 't1');
    expect(fusionMock.redeployApp).toHaveBeenCalledWith('a1', 't1');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'deploy.env', payload: { set: ['K'], unset: ['OLD'] } }));
    expect(startPollingMock).toHaveBeenCalledWith('dep1', 't1');
  });

  it('defaults the audit payload when set/unset omitted', async () => {
    fusionMock.setAppEnv.mockResolvedValue({ id: 'a1' });
    fusionMock.redeployApp.mockResolvedValue({ deploymentId: 'de' });
    await deploy.setDeployEnvAction('slug', 'dep1', {});
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ payload: { set: [], unset: [] } }));
  });

  it('errors when not found', async () => {
    prismaMock.deployment.findFirst.mockResolvedValue(null);
    expect(await deploy.setDeployEnvAction('slug', 'dep1', {})).toEqual({ ok: false, error: 'Despliegue no encontrado' });
  });

  it('returns the error when setAppEnv throws', async () => {
    fusionMock.setAppEnv.mockRejectedValue(new Error('save fail'));
    expect(await deploy.setDeployEnvAction('slug', 'dep1', {})).toEqual({ ok: false, error: 'save fail' });
  });
});

// ------------------------------------------------------------------------ logs ----
describe('getDeploymentLogsAction', () => {
  it('returns empty lines when there is no lastDeploymentId', async () => {
    prismaMock.deployment.findFirst.mockResolvedValue({ ...depRow, lastDeploymentId: null, status: 'PENDING' });
    const res = await deploy.getDeploymentLogsAction('slug', 'dep1');
    expect(res).toEqual({ ok: true, data: { status: 'PENDING', lines: [] } });
    expect(fusionMock.getDeployment).not.toHaveBeenCalled();
  });

  it('maps the control-plane log lines', async () => {
    fusionMock.getDeployment.mockResolvedValue({
      status: 'IN_PROGRESS',
      logs: [{ seq: 1, stream: 'stdout', text: 'building', id: 'x', createdAt: '' }],
    });
    const res = await deploy.getDeploymentLogsAction('slug', 'dep1');
    expect(res).toEqual({ ok: true, data: { status: 'IN_PROGRESS', lines: [{ seq: 1, stream: 'stdout', text: 'building' }] } });
  });

  it('errors when not found', async () => {
    prismaMock.deployment.findFirst.mockResolvedValue(null);
    expect(await deploy.getDeploymentLogsAction('slug', 'dep1')).toEqual({ ok: false, error: 'Despliegue no encontrado' });
  });

  it('returns the error when getDeployment throws', async () => {
    fusionMock.getDeployment.mockRejectedValue(new Error('logs fail'));
    expect(await deploy.getDeploymentLogsAction('slug', 'dep1')).toEqual({ ok: false, error: 'logs fail' });
  });
});

// -------------------------------------------------------------------- databases ----
describe('getDbCatalogAction', () => {
  it('rejects when not configured', async () => {
    fusionMock.isFusionConfigured.mockReturnValue(false);
    expect((await deploy.getDbCatalogAction('slug')).ok).toBe(false);
  });

  it('returns the catalog', async () => {
    fusionMock.dbCatalog.mockResolvedValue([{ engine: 'POSTGRES', versions: ['16'], default_port: 5432 }]);
    const res = await deploy.getDbCatalogAction('slug');
    expect(res.ok).toBe(true);
  });

  it('returns the error when dbCatalog throws', async () => {
    fusionMock.dbCatalog.mockRejectedValue(new Error('cat fail'));
    expect(await deploy.getDbCatalogAction('slug')).toEqual({ ok: false, error: 'cat fail' });
  });
});

describe('provisionDatabaseAction', () => {
  const input = { name: 'mydb', engine: 'POSTGRES' as const, version: '16' };

  it('errors when there is no target', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValue(null);
    expect(await deploy.provisionDatabaseAction('slug', input)).toEqual({
      ok: false,
      error: 'Conecta el proyecto a la infraestructura primero',
    });
  });

  it('creates the DB row and starts polling when a deployment exists', async () => {
    fusionMock.createDatabase.mockResolvedValue({ id: 'db1', name: 'mydb', latestDeployment: { id: 'ld1', operation: 'DEPLOY', status: 'QUEUED' } });
    prismaMock.deployment.create.mockResolvedValue({ id: 'dbrow' });
    const res = await deploy.provisionDatabaseAction('slug', input);
    expect(res.ok).toBe(true);
    expect(prismaMock.deployment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'DATABASE', status: 'BUILDING', lastDeploymentId: 'ld1' }) }),
    );
    expect(startPollingMock).toHaveBeenCalledWith('dbrow', 't1');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'deploy.db.create' }));
  });

  it('does not poll when the DB has no latestDeployment', async () => {
    fusionMock.createDatabase.mockResolvedValue({ id: 'db1', name: 'mydb', latestDeployment: null });
    prismaMock.deployment.create.mockResolvedValue({ id: 'dbrow' });
    const res = await deploy.provisionDatabaseAction('slug', input);
    expect(res.ok).toBe(true);
    expect(startPollingMock).not.toHaveBeenCalled();
  });

  it('returns the error when createDatabase throws', async () => {
    fusionMock.createDatabase.mockRejectedValue(new Error('db fail'));
    expect(await deploy.provisionDatabaseAction('slug', input)).toEqual({ ok: false, error: 'db fail' });
  });
});

describe('getDbCredentialsAction', () => {
  it('rejects when the deployment is not a database', async () => {
    prismaMock.deployment.findFirst.mockResolvedValue({ ...depRow, kind: 'APP' });
    expect(await deploy.getDbCredentialsAction('slug', 'dep1')).toEqual({ ok: false, error: 'No es una base de datos' });
  });

  it('returns the credentials', async () => {
    prismaMock.deployment.findFirst.mockResolvedValue({ ...depRow, kind: 'DATABASE' });
    fusionMock.getDbCredentials.mockResolvedValue({ local: { host: 'h' } });
    const res = await deploy.getDbCredentialsAction('slug', 'dep1');
    expect(res.ok).toBe(true);
  });

  it('errors when not found', async () => {
    prismaMock.deployment.findFirst.mockResolvedValue(null);
    expect(await deploy.getDbCredentialsAction('slug', 'dep1')).toEqual({ ok: false, error: 'Despliegue no encontrado' });
  });

  it('returns the error when getDbCredentials throws', async () => {
    prismaMock.deployment.findFirst.mockResolvedValue({ ...depRow, kind: 'DATABASE' });
    fusionMock.getDbCredentials.mockRejectedValue(new Error('cred fail'));
    expect(await deploy.getDbCredentialsAction('slug', 'dep1')).toEqual({ ok: false, error: 'cred fail' });
  });
});

// ------------------------------------------------------------ import / link ----
describe('listImportableAppsAction', () => {
  it('errors when there is no target', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValue(null);
    expect(await deploy.listImportableAppsAction('slug')).toEqual({
      ok: false,
      error: 'Conecta el proyecto a la infraestructura primero',
    });
  });

  it('excludes linked + deleted apps and maps the rest', async () => {
    fusionMock.listApps.mockResolvedValue([
      { id: 'a1', name: 'live', kind: 'APP', hostname: 'h1', latestDeployment: { operation: 'DEPLOY', status: 'FINISHED' }, deletedAt: null },
      { id: 'a2', name: 'deleted', kind: 'APP', hostname: 'h2', latestDeployment: null, deletedAt: '2020' },
      { id: 'a3', name: 'linked', kind: 'APP', hostname: null, latestDeployment: null, deletedAt: null },
    ]);
    prismaMock.deployment.findMany.mockResolvedValue([{ fusionAppId: 'a3' }]);
    const res = await deploy.listImportableAppsAction('slug');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual([{ id: 'a1', name: 'live', kind: 'APP', status: 'LIVE', url: 'https://h1' }]);
    }
  });

  it('returns the error when listApps throws', async () => {
    fusionMock.listApps.mockRejectedValue(new Error('list fail'));
    expect(await deploy.listImportableAppsAction('slug')).toEqual({ ok: false, error: 'list fail' });
  });
});

describe('linkExistingAppAction', () => {
  it('errors when there is no target', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValue(null);
    expect(await deploy.linkExistingAppAction('slug', 'a1')).toEqual({
      ok: false,
      error: 'Conecta el proyecto a la infraestructura primero',
    });
  });

  it('upserts the deployment (with repo) and audits', async () => {
    fusionMock.getApp.mockResolvedValue({ id: 'a1', kind: 'APP', name: 'x', hostname: 'h', buildPack: 'DOCKERFILE', exposedPort: 3000, latestDeployment: { operation: 'DEPLOY', status: 'FINISHED' } });
    prismaMock.projectRepo.findFirst.mockResolvedValue({ id: 'r1' });
    const res = await deploy.linkExistingAppAction('slug', 'a1', { repoId: 'r1' });
    expect(res.ok).toBe(true);
    expect(prismaMock.deployment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deployTargetId_fusionAppId: { deployTargetId: 'dt1', fusionAppId: 'a1' } },
        create: expect.objectContaining({ kind: 'APP', status: 'LIVE', projectRepoId: 'r1', imported: true }),
        update: { projectRepoId: 'r1', status: 'LIVE' },
      }),
    );
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'deploy.import' }));
  });

  it('maps a DATABASE app kind', async () => {
    fusionMock.getApp.mockResolvedValue({ id: 'a1', kind: 'DATABASE', name: 'db', hostname: null, buildPack: 'DOCKER_IMAGE', exposedPort: null, latestDeployment: null });
    const res = await deploy.linkExistingAppAction('slug', 'a1');
    expect(res.ok).toBe(true);
    expect(prismaMock.deployment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ kind: 'DATABASE', projectRepoId: null }) }),
    );
  });

  it('errors when the given repo does not belong to the project', async () => {
    fusionMock.getApp.mockResolvedValue({ id: 'a1', kind: 'APP', name: 'x', hostname: 'h', buildPack: 'DOCKERFILE', exposedPort: null, latestDeployment: null });
    prismaMock.projectRepo.findFirst.mockResolvedValue(null);
    expect(await deploy.linkExistingAppAction('slug', 'a1', { repoId: 'bad' })).toEqual({ ok: false, error: 'Repo no encontrado' });
  });

  it('returns the error when getApp throws', async () => {
    fusionMock.getApp.mockRejectedValue(new Error('link fail'));
    expect(await deploy.linkExistingAppAction('slug', 'a1')).toEqual({ ok: false, error: 'link fail' });
  });
});

// -------------------------------------------------------------- delete / refresh ----
describe('deleteDeploymentAction', () => {
  it('unlinks without destroying by default', async () => {
    const res = await deploy.deleteDeploymentAction('slug', 'dep1');
    expect(res.ok).toBe(true);
    expect(fusionMock.deleteApp).not.toHaveBeenCalled();
    expect(prismaMock.deployment.delete).toHaveBeenCalledWith({ where: { id: 'dep1' } });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'deploy.unlink' }));
  });

  it('destroys the remote app when requested', async () => {
    const res = await deploy.deleteDeploymentAction('slug', 'dep1', { destroy: true });
    expect(res.ok).toBe(true);
    expect(fusionMock.deleteApp).toHaveBeenCalledWith('a1', 't1');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'deploy.destroy' }));
  });

  it('errors when not found', async () => {
    prismaMock.deployment.findFirst.mockResolvedValue(null);
    expect(await deploy.deleteDeploymentAction('slug', 'dep1')).toEqual({ ok: false, error: 'Despliegue no encontrado' });
  });

  it('returns the error when deleteApp throws', async () => {
    fusionMock.deleteApp.mockRejectedValue(new Error('del fail'));
    expect(await deploy.deleteDeploymentAction('slug', 'dep1', { destroy: true })).toEqual({ ok: false, error: 'del fail' });
  });
});

describe('refreshDeploymentsAction', () => {
  it('returns the current view when there is no target', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValue(null);
    const res = await deploy.refreshDeploymentsAction('slug');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.connected).toBe(false);
  });

  it('syncs each deployment status, swallowing per-item errors', async () => {
    // 1st findUnique (refresh): bare deployments; 2nd (loadView): full-shape rows.
    prismaMock.deployTarget.findUnique
      .mockResolvedValueOnce({
        ...target,
        deployments: [
          { id: 'dep1', fusionAppId: 'a1', hostname: 'old1' },
          { id: 'dep2', fusionAppId: 'a2', hostname: 'old2' },
        ],
      })
      .mockResolvedValue(target);
    fusionMock.getApp
      .mockResolvedValueOnce({ hostname: 'new1', latestDeployment: { operation: 'DEPLOY', status: 'FINISHED' } })
      .mockRejectedValueOnce(new Error('transient'));
    const res = await deploy.refreshDeploymentsAction('slug');
    expect(res.ok).toBe(true);
    expect(prismaMock.deployment.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.deployment.update).toHaveBeenCalledWith({
      where: { id: 'dep1' },
      data: { status: 'LIVE', hostname: 'new1', error: null },
    });
  });
});

describe('getGovernanceAction', () => {
  it('returns an empty list when the project has no deploy target', async () => {
    prismaMock.deployTarget.findUnique.mockResolvedValue(null);
    const res = await deploy.getGovernanceAction('slug');
    expect(res).toEqual({ ok: true, data: [] });
    expect(fusionMock.getProjectGovernance).not.toHaveBeenCalled();
  });

  it('fetches the fusion project governance for the connected target', async () => {
    const summaries = [
      { environmentId: 'e1', environmentName: 'production', policy: null },
    ];
    fusionMock.getProjectGovernance.mockResolvedValue(summaries);
    const res = await deploy.getGovernanceAction('slug');
    expect(fusionMock.getProjectGovernance).toHaveBeenCalledWith('fp1', 't1');
    expect(res).toEqual({ ok: true, data: summaries });
  });

  it('surfaces fusion-infra errors', async () => {
    fusionMock.getProjectGovernance.mockRejectedValue(new Error('fusion-infra 500: boom'));
    const res = await deploy.getGovernanceAction('slug');
    expect(res).toEqual({ ok: false, error: 'fusion-infra 500: boom' });
  });

  it('propagates the membership guard failure', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'Proyecto no encontrado' });
    const res = await deploy.getGovernanceAction('slug');
    expect(res).toEqual({ ok: false, error: 'Proyecto no encontrado' });
  });
});
