'use server';

import { revalidatePath } from 'next/cache';
import type { MemberRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { audit } from '@/lib/audit';
import { assertProjectMember } from '@/lib/auth/membership';
import * as fusion from '@/lib/deploy/fusion-client';
import { deriveState, startPolling, type DeployState } from '@/lib/deploy/poll';
import type { ActionResult } from './projects';

// ---- view shapes ----

export interface DeploymentView {
  id: string;
  fusionAppId: string;
  kind: 'APP' | 'DATABASE';
  name: string;
  status: DeployState;
  hostname: string | null;
  url: string | null;
  error: string | null;
  buildPack: string;
  exposedPort: number | null;
  imported: boolean;
  repoId: string | null;
  repoName: string | null;
  lastDeploymentId: string | null;
  updatedAt: string;
}

export interface DeployRepoView {
  id: string;
  name: string;
  kind: string;
  url: string | null;
  deployed: boolean;
}

export interface DeployView {
  configured: boolean;
  connected: boolean;
  target: {
    fusionTeamId: string;
    fusionProjectId: string;
    environmentId: string;
    serverId: string;
  } | null;
  repos: DeployRepoView[];
  deployments: DeploymentView[];
}

export interface ConnectOption {
  servers: Array<{ id: string; name: string; agentStatus: fusion.AgentStatus }>;
  defaultTeamId: string | null;
}

const NOT_CONFIGURED = 'El despliegue no está configurado en esta instancia (FUSION_INFRA_URL / FUSION_INFRA_TOKEN)';

// ---- guards ----

type Guarded = { projectId: string; userId: string; role: MemberRole; name: string };

async function guard(
  slug: string,
  opts: { mutate?: boolean } = {},
): Promise<{ ok: true; ctx: Guarded } | { ok: false; error: string }> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (opts.mutate && ctx.role !== 'OWNER' && ctx.role !== 'ADMIN') {
    return { ok: false, error: 'Solo OWNER/ADMIN pueden gestionar despliegues' };
  }
  const project = await prisma.project.findUnique({ where: { id: ctx.projectId }, select: { name: true } });
  return {
    ok: true,
    ctx: { projectId: ctx.projectId, userId: ctx.userId, role: ctx.role, name: project?.name ?? slug },
  };
}

function urlOf(hostname: string | null): string | null {
  return hostname ? `https://${hostname}` : null;
}

function toDeploymentView(
  d: {
    id: string;
    fusionAppId: string;
    kind: string;
    name: string;
    status: string;
    hostname: string | null;
    error: string | null;
    buildPack: string;
    exposedPort: number | null;
    imported: boolean;
    lastDeploymentId: string | null;
    updatedAt: Date;
    projectRepo: { id: string; name: string } | null;
  },
): DeploymentView {
  return {
    id: d.id,
    fusionAppId: d.fusionAppId,
    kind: d.kind === 'DATABASE' ? 'DATABASE' : 'APP',
    name: d.name,
    status: (d.status as DeployState) ?? 'PENDING',
    hostname: d.hostname,
    url: urlOf(d.hostname),
    error: d.error,
    buildPack: d.buildPack,
    exposedPort: d.exposedPort,
    imported: d.imported,
    repoId: d.projectRepo?.id ?? null,
    repoName: d.projectRepo?.name ?? null,
    lastDeploymentId: d.lastDeploymentId,
    updatedAt: d.updatedAt.toISOString(),
  };
}

async function loadView(projectId: string): Promise<DeployView> {
  const [target, repos] = await Promise.all([
    prisma.deployTarget.findUnique({
      where: { projectId },
      include: {
        deployments: {
          orderBy: { createdAt: 'desc' },
          include: { projectRepo: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.projectRepo.findMany({
      where: { projectId },
      select: { id: true, name: true, kind: true, url: true, deployments: { select: { id: true } } },
      orderBy: { name: 'asc' },
    }),
  ]);
  return {
    configured: fusion.isFusionConfigured(),
    connected: Boolean(target),
    target: target
      ? {
          fusionTeamId: target.fusionTeamId,
          fusionProjectId: target.fusionProjectId,
          environmentId: target.environmentId,
          serverId: target.serverId,
        }
      : null,
    repos: repos.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      url: r.url,
      deployed: r.deployments.length > 0,
    })),
    deployments: (target?.deployments ?? []).map(toDeploymentView),
  };
}

async function loadTarget(projectId: string) {
  return prisma.deployTarget.findUnique({ where: { projectId } });
}

// ---- read ----

/** Current deploy state for a project (used on load + polling). */
export async function getDeployViewAction(slug: string): Promise<ActionResult<DeployView>> {
  const g = await guard(slug);
  if (!g.ok) return g;
  return { ok: true, data: await loadView(g.ctx.projectId) };
}

/** Servers available to connect to (only needed when rendering the connect form). */
export async function getConnectOptionsAction(slug: string): Promise<ActionResult<ConnectOption>> {
  const g = await guard(slug, { mutate: true });
  if (!g.ok) return g;
  if (!fusion.isFusionConfigured()) return { ok: false, error: NOT_CONFIGURED };
  try {
    const ctx = await fusion.getContext();
    const teamId = env().FUSION_INFRA_TEAM_ID ?? ctx.defaultTeamId ?? undefined;
    const servers = ctx.servers
      .filter((s) => !teamId || s.teamId === teamId)
      .map((s) => ({ id: s.id, name: s.name, agentStatus: s.agentStatus }));
    return { ok: true, data: { servers, defaultTeamId: ctx.defaultTeamId } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudo consultar fusion-infra' };
  }
}

// ---- connect (auto-create the fusion-infra project/environment) ----

export async function connectDeployTargetAction(
  slug: string,
  input: { serverId?: string } = {},
): Promise<ActionResult<DeployView>> {
  const g = await guard(slug, { mutate: true });
  if (!g.ok) return g;
  if (!fusion.isFusionConfigured()) return { ok: false, error: NOT_CONFIGURED };

  const existing = await loadTarget(g.ctx.projectId);
  if (existing) return { ok: true, data: await loadView(g.ctx.projectId) };

  try {
    const ctx = await fusion.getContext();
    const teamId = env().FUSION_INFRA_TEAM_ID ?? ctx.defaultTeamId;
    if (!teamId) return { ok: false, error: 'fusion-infra: sin team por defecto; configura FUSION_INFRA_TEAM_ID' };

    // Resolve the target server: explicit → env override → the only ONLINE one.
    const teamServers = ctx.servers.filter((s) => s.teamId === teamId);
    const online = teamServers.filter((s) => s.agentStatus === 'ONLINE');
    const serverId = input.serverId ?? env().FUSION_INFRA_SERVER_ID ?? (online.length === 1 ? online[0]!.id : undefined);
    if (!serverId) {
      return {
        ok: false,
        error: online.length
          ? 'Elige un servidor de destino'
          : 'No hay servidores ONLINE en fusion-infra para desplegar',
      };
    }

    // Auto-create the fusion-infra project (it ships with a "production" env).
    const project = await fusion.createProject(g.ctx.name, teamId);
    const envs = project.environments?.length
      ? project.environments
      : await fusion.listEnvironments(project.id, teamId);
    const environment = envs.find((e) => e.name.toLowerCase() === 'production') ?? envs[0];
    if (!environment) return { ok: false, error: 'fusion-infra creó el proyecto sin entornos' };

    await prisma.deployTarget.create({
      data: {
        projectId: g.ctx.projectId,
        fusionTeamId: teamId,
        fusionProjectId: project.id,
        environmentId: environment.id,
        serverId,
      },
    });
    await audit({
      actorId: g.ctx.userId,
      action: 'deploy.connect',
      resourceType: 'deploy_target',
      resourceId: g.ctx.projectId,
      projectId: g.ctx.projectId,
      payload: { fusionProjectId: project.id, environmentId: environment.id, serverId },
    });

    revalidatePath(`/projects/${slug}/deploy`);
    return { ok: true, data: await loadView(g.ctx.projectId) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudo conectar a fusion-infra' };
  }
}

// ---- deploy / redeploy a repo ----

export async function deployRepoAction(
  slug: string,
  repoId: string,
  input: { exposedPort: number; dockerfilePath?: string; env?: Record<string, string> },
): Promise<ActionResult<DeployView>> {
  const g = await guard(slug, { mutate: true });
  if (!g.ok) return g;
  if (!fusion.isFusionConfigured()) return { ok: false, error: NOT_CONFIGURED };

  const target = await loadTarget(g.ctx.projectId);
  if (!target) return { ok: false, error: 'Conecta el proyecto a la infraestructura primero' };

  const repo = await prisma.projectRepo.findFirst({
    where: { id: repoId, projectId: g.ctx.projectId },
  });
  if (!repo) return { ok: false, error: 'Repo no encontrado' };
  if (!repo.url) return { ok: false, error: 'El repo no tiene URL de GitHub para desplegar' };

  try {
    const existing = await prisma.deployment.findFirst({
      where: { deployTargetId: target.id, projectRepoId: repo.id },
    });

    let deploymentRowId: string;
    let ack: fusion.DeployAck;

    if (existing) {
      ack = await fusion.redeployApp(existing.fusionAppId, target.fusionTeamId);
      deploymentRowId = existing.id;
      await prisma.deployment.update({
        where: { id: existing.id },
        data: { status: 'BUILDING', lastDeploymentId: ack.deploymentId, error: null },
      });
    } else {
      const app = await fusion.createApp(
        {
          name: `${slug}-${repo.name}`,
          environmentId: target.environmentId,
          serverId: target.serverId,
          buildPack: 'DOCKERFILE',
          repository: repo.url,
          branch: repo.defaultBranch ?? 'main',
          dockerfilePath: input.dockerfilePath || 'Dockerfile',
          exposedPort: input.exposedPort,
          gitToken: repo.private ? env().GITHUB_TOKEN : undefined,
          env: input.env,
        },
        target.fusionTeamId,
      );
      ack = await fusion.deployApp(app.id, target.fusionTeamId);
      const row = await prisma.deployment.create({
        data: {
          deployTargetId: target.id,
          projectRepoId: repo.id,
          fusionAppId: app.id,
          kind: 'APP',
          name: app.name,
          hostname: app.hostname,
          buildPack: 'DOCKERFILE',
          exposedPort: input.exposedPort,
          status: 'BUILDING',
          lastDeploymentId: ack.deploymentId,
        },
      });
      deploymentRowId = row.id;
    }

    await audit({
      actorId: g.ctx.userId,
      action: existing ? 'deploy.redeploy' : 'deploy.create',
      resourceType: 'deployment',
      resourceId: deploymentRowId,
      projectId: g.ctx.projectId,
      payload: { repo: repo.name },
    });
    startPolling(deploymentRowId, target.fusionTeamId);
    revalidatePath(`/projects/${slug}/deploy`);
    return { ok: true, data: await loadView(g.ctx.projectId) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Falló el despliegue' };
  }
}

// ---- lifecycle (stop / start / recreate) ----

const LIFECYCLE = {
  stop: fusion.stopApp,
  start: fusion.startApp,
  recreate: fusion.recreateApp,
} as const;

export async function lifecycleAction(
  slug: string,
  deploymentId: string,
  op: keyof typeof LIFECYCLE,
): Promise<ActionResult<DeployView>> {
  const g = await guard(slug, { mutate: true });
  if (!g.ok) return g;
  const r = await resolveDeployment(g.ctx.projectId, deploymentId);
  if (!r) return { ok: false, error: 'Despliegue no encontrado' };
  const { target, dep } = r;

  try {
    const ack = await LIFECYCLE[op](dep.fusionAppId, target.fusionTeamId);
    await prisma.deployment.update({
      where: { id: dep.id },
      data: { status: 'BUILDING', lastDeploymentId: ack.deploymentId, error: null },
    });
    await audit({
      actorId: g.ctx.userId,
      action: `deploy.${op}` as 'deploy.stop' | 'deploy.start' | 'deploy.recreate',
      resourceType: 'deployment',
      resourceId: dep.id,
      projectId: g.ctx.projectId,
    });
    startPolling(dep.id, target.fusionTeamId);
    revalidatePath(`/projects/${slug}/deploy`);
    return { ok: true, data: await loadView(g.ctx.projectId) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : `Falló ${op}` };
  }
}

// ---- rollback ----

export async function getRollbackTargetsAction(
  slug: string,
  deploymentId: string,
): Promise<ActionResult<Array<{ id: string; status: string; operation: string }>>> {
  const g = await guard(slug);
  if (!g.ok) return g;
  const r = await resolveDeployment(g.ctx.projectId, deploymentId);
  if (!r) return { ok: false, error: 'Despliegue no encontrado' };
  const { target, dep } = r;
  try {
    const history = await fusion.appDeployments(dep.fusionAppId, target.fusionTeamId);
    const targets = history
      .filter((d) => d.status === 'FINISHED' && d.operation === 'DEPLOY' && d.id !== dep.lastDeploymentId)
      .map((d) => ({ id: d.id, status: d.status, operation: d.operation }));
    return { ok: true, data: targets };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudo leer el historial' };
  }
}

export async function rollbackDeploymentAction(
  slug: string,
  deploymentId: string,
  fusionDeploymentId: string,
): Promise<ActionResult<DeployView>> {
  const g = await guard(slug, { mutate: true });
  if (!g.ok) return g;
  const r = await resolveDeployment(g.ctx.projectId, deploymentId);
  if (!r) return { ok: false, error: 'Despliegue no encontrado' };
  const { target, dep } = r;
  try {
    const ack = await fusion.rollbackApp(dep.fusionAppId, fusionDeploymentId, target.fusionTeamId);
    await prisma.deployment.update({
      where: { id: dep.id },
      data: { status: 'BUILDING', lastDeploymentId: ack.deploymentId, error: null },
    });
    await audit({
      actorId: g.ctx.userId,
      action: 'deploy.rollback',
      resourceType: 'deployment',
      resourceId: dep.id,
      projectId: g.ctx.projectId,
      payload: { to: fusionDeploymentId },
    });
    startPolling(dep.id, target.fusionTeamId);
    revalidatePath(`/projects/${slug}/deploy`);
    return { ok: true, data: await loadView(g.ctx.projectId) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Falló el rollback' };
  }
}

// ---- env editor ----

export async function getDeployEnvKeysAction(
  slug: string,
  deploymentId: string,
): Promise<ActionResult<string[]>> {
  const g = await guard(slug, { mutate: true });
  if (!g.ok) return g;
  const r = await resolveDeployment(g.ctx.projectId, deploymentId);
  if (!r) return { ok: false, error: 'Despliegue no encontrado' };
  const { target, dep } = r;
  try {
    const { keys } = await fusion.getAppEnvKeys(dep.fusionAppId, target.fusionTeamId);
    return { ok: true, data: keys };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudieron leer las variables' };
  }
}

export async function setDeployEnvAction(
  slug: string,
  deploymentId: string,
  patch: { set?: Record<string, string>; unset?: string[] },
): Promise<ActionResult<DeployView>> {
  const g = await guard(slug, { mutate: true });
  if (!g.ok) return g;
  const r = await resolveDeployment(g.ctx.projectId, deploymentId);
  if (!r) return { ok: false, error: 'Despliegue no encontrado' };
  const { target, dep } = r;
  try {
    await fusion.setAppEnv(
      dep.fusionAppId,
      { envSet: patch.set, envUnset: patch.unset },
      target.fusionTeamId,
    );
    // Apply the new env by redeploying.
    const ack = await fusion.redeployApp(dep.fusionAppId, target.fusionTeamId);
    await prisma.deployment.update({
      where: { id: dep.id },
      data: { status: 'BUILDING', lastDeploymentId: ack.deploymentId, error: null },
    });
    await audit({
      actorId: g.ctx.userId,
      action: 'deploy.env',
      resourceType: 'deployment',
      resourceId: dep.id,
      projectId: g.ctx.projectId,
      payload: { set: Object.keys(patch.set ?? {}), unset: patch.unset ?? [] },
    });
    startPolling(dep.id, target.fusionTeamId);
    revalidatePath(`/projects/${slug}/deploy`);
    return { ok: true, data: await loadView(g.ctx.projectId) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudieron guardar las variables' };
  }
}

// ---- logs ----

export async function getDeploymentLogsAction(
  slug: string,
  deploymentId: string,
): Promise<ActionResult<{ status: string; lines: Array<{ seq: number; stream: string; text: string }> }>> {
  const g = await guard(slug);
  if (!g.ok) return g;
  const r = await resolveDeployment(g.ctx.projectId, deploymentId);
  if (!r) return { ok: false, error: 'Despliegue no encontrado' };
  const { target, dep } = r;
  if (!dep.lastDeploymentId) return { ok: true, data: { status: dep.status, lines: [] } };
  try {
    const d = await fusion.getDeployment(dep.lastDeploymentId, target.fusionTeamId);
    return {
      ok: true,
      data: {
        status: d.status,
        lines: d.logs.map((l) => ({ seq: l.seq, stream: l.stream, text: l.text })),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudieron leer los logs' };
  }
}

// ---- databases ----

export async function getDbCatalogAction(slug: string): Promise<ActionResult<fusion.FusionDbCatalogEntry[]>> {
  const g = await guard(slug, { mutate: true });
  if (!g.ok) return g;
  if (!fusion.isFusionConfigured()) return { ok: false, error: NOT_CONFIGURED };
  try {
    return { ok: true, data: await fusion.dbCatalog() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudo leer el catálogo' };
  }
}

export async function provisionDatabaseAction(
  slug: string,
  input: { name: string; engine: fusion.DbEngine; version: string; exposePublic?: boolean; publicPort?: number },
): Promise<ActionResult<DeployView>> {
  const g = await guard(slug, { mutate: true });
  if (!g.ok) return g;
  const target = await loadTarget(g.ctx.projectId);
  if (!target) return { ok: false, error: 'Conecta el proyecto a la infraestructura primero' };
  try {
    const db = await fusion.createDatabase(
      {
        name: input.name,
        environmentId: target.environmentId,
        serverId: target.serverId,
        engine: input.engine,
        version: input.version,
        exposePublic: input.exposePublic,
        publicPort: input.publicPort,
      },
      target.fusionTeamId,
    );
    const row = await prisma.deployment.create({
      data: {
        deployTargetId: target.id,
        fusionAppId: db.id,
        kind: 'DATABASE',
        name: db.name,
        buildPack: 'DOCKER_IMAGE',
        status: deriveState(db.latestDeployment),
        lastDeploymentId: db.latestDeployment?.id ?? null,
      },
    });
    await audit({
      actorId: g.ctx.userId,
      action: 'deploy.db.create',
      resourceType: 'deployment',
      resourceId: row.id,
      projectId: g.ctx.projectId,
      payload: { engine: input.engine, version: input.version },
    });
    if (db.latestDeployment?.id) startPolling(row.id, target.fusionTeamId);
    revalidatePath(`/projects/${slug}/deploy`);
    return { ok: true, data: await loadView(g.ctx.projectId) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudo crear la base de datos' };
  }
}

export async function getDbCredentialsAction(
  slug: string,
  deploymentId: string,
): Promise<ActionResult<fusion.FusionDbCredentials>> {
  const g = await guard(slug, { mutate: true });
  if (!g.ok) return g;
  const r = await resolveDeployment(g.ctx.projectId, deploymentId);
  if (!r) return { ok: false, error: 'Despliegue no encontrado' };
  const { target, dep } = r;
  if (dep.kind !== 'DATABASE') return { ok: false, error: 'No es una base de datos' };
  try {
    return { ok: true, data: await fusion.getDbCredentials(dep.fusionAppId, target.fusionTeamId) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudieron leer las credenciales' };
  }
}

// ---- import / link existing ----

export async function listImportableAppsAction(
  slug: string,
): Promise<ActionResult<Array<{ id: string; name: string; kind: string; status: DeployState; url: string | null }>>> {
  const g = await guard(slug, { mutate: true });
  if (!g.ok) return g;
  const target = await loadTarget(g.ctx.projectId);
  if (!target) return { ok: false, error: 'Conecta el proyecto a la infraestructura primero' };
  try {
    const [apps, linked] = await Promise.all([
      fusion.listApps(target.environmentId, target.fusionTeamId),
      prisma.deployment.findMany({ where: { deployTargetId: target.id }, select: { fusionAppId: true } }),
    ]);
    const linkedIds = new Set(linked.map((l) => l.fusionAppId));
    const importable = apps
      .filter((a) => !linkedIds.has(a.id) && !a.deletedAt)
      .map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        status: deriveState(a.latestDeployment),
        url: urlOf(a.hostname ?? null),
      }));
    return { ok: true, data: importable };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudieron listar las apps' };
  }
}

export async function linkExistingAppAction(
  slug: string,
  fusionAppId: string,
  input: { repoId?: string } = {},
): Promise<ActionResult<DeployView>> {
  const g = await guard(slug, { mutate: true });
  if (!g.ok) return g;
  const target = await loadTarget(g.ctx.projectId);
  if (!target) return { ok: false, error: 'Conecta el proyecto a la infraestructura primero' };
  try {
    const app = await fusion.getApp(fusionAppId, target.fusionTeamId);
    if (input.repoId) {
      const repo = await prisma.projectRepo.findFirst({
        where: { id: input.repoId, projectId: g.ctx.projectId },
        select: { id: true },
      });
      if (!repo) return { ok: false, error: 'Repo no encontrado' };
    }
    await prisma.deployment.upsert({
      where: { deployTargetId_fusionAppId: { deployTargetId: target.id, fusionAppId } },
      create: {
        deployTargetId: target.id,
        projectRepoId: input.repoId ?? null,
        fusionAppId,
        kind: app.kind === 'DATABASE' ? 'DATABASE' : 'APP',
        name: app.name,
        hostname: app.hostname,
        buildPack: app.buildPack,
        exposedPort: app.exposedPort ?? null,
        status: deriveState(app.latestDeployment),
        lastDeploymentId: app.latestDeployment?.id ?? null,
        imported: true,
      },
      update: { projectRepoId: input.repoId ?? null, status: deriveState(app.latestDeployment) },
    });
    await audit({
      actorId: g.ctx.userId,
      action: 'deploy.import',
      resourceType: 'deployment',
      resourceId: fusionAppId,
      projectId: g.ctx.projectId,
    });
    revalidatePath(`/projects/${slug}/deploy`);
    return { ok: true, data: await loadView(g.ctx.projectId) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudo vincular la app' };
  }
}

// ---- unlink / delete ----

export async function deleteDeploymentAction(
  slug: string,
  deploymentId: string,
  input: { destroy?: boolean } = {},
): Promise<ActionResult<DeployView>> {
  const g = await guard(slug, { mutate: true });
  if (!g.ok) return g;
  const r = await resolveDeployment(g.ctx.projectId, deploymentId);
  if (!r) return { ok: false, error: 'Despliegue no encontrado' };
  const { target, dep } = r;
  try {
    if (input.destroy) {
      await fusion.deleteApp(dep.fusionAppId, target.fusionTeamId);
    }
    await prisma.deployment.delete({ where: { id: dep.id } });
    await audit({
      actorId: g.ctx.userId,
      action: input.destroy ? 'deploy.destroy' : 'deploy.unlink',
      resourceType: 'deployment',
      resourceId: dep.id,
      projectId: g.ctx.projectId,
    });
    revalidatePath(`/projects/${slug}/deploy`);
    return { ok: true, data: await loadView(g.ctx.projectId) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudo eliminar' };
  }
}

// ---- refresh (sync statuses from the control-plane) ----

export async function refreshDeploymentsAction(slug: string): Promise<ActionResult<DeployView>> {
  const g = await guard(slug);
  if (!g.ok) return g;
  const target = await prisma.deployTarget.findUnique({
    where: { projectId: g.ctx.projectId },
    include: { deployments: true },
  });
  if (!target) return { ok: true, data: await loadView(g.ctx.projectId) };

  await Promise.all(
    target.deployments.map(async (d) => {
      try {
        const app = await fusion.getApp(d.fusionAppId, target.fusionTeamId);
        await prisma.deployment.update({
          where: { id: d.id },
          data: {
            status: deriveState(app.latestDeployment),
            hostname: app.hostname ?? d.hostname,
            error: app.latestDeployment?.errorReason ?? null,
          },
        });
      } catch {
        /* leave stale on transient errors */
      }
    }),
  );
  return { ok: true, data: await loadView(g.ctx.projectId) };
}

// ---- shared resolver ----

async function resolveDeployment(projectId: string, deploymentId: string) {
  const target = await prisma.deployTarget.findUnique({ where: { projectId } });
  if (!target) return null;
  const dep = await prisma.deployment.findFirst({
    where: { id: deploymentId, deployTargetId: target.id },
  });
  if (!dep) return null;
  return { target, dep };
}
