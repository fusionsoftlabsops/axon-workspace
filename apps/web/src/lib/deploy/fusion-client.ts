/**
 * Client for the fusion-infra control-plane (the user's PaaS). axon-web runs as
 * an app ON fusion-infra (the internal `fusion` Docker network), so it reaches
 * the control-plane directly at FUSION_INFRA_URL (= http://control-plane:3030/api,
 * no public hop). Mirrors lib/analysis/graphify-client.ts (env-configured,
 * optional, graceful when unset) and the fusion-infra MCP server's `api()` helper
 * (Bearer fapi_ token + x-team-id, team resolved from GET /context).
 */
import { env } from '@/lib/env';

const TIMEOUT_MS = 30_000;

export function isFusionConfigured(): boolean {
  const e = env();
  return Boolean(e.FUSION_INFRA_URL && e.FUSION_INFRA_TOKEN);
}

/** Error carrying the control-plane HTTP status (for friendly action messages). */
export class FusionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'FusionError';
  }
}

// ---- response shapes (subset of the control-plane contract we use) ----

export type AgentStatus = 'PENDING' | 'ONLINE' | 'OFFLINE' | 'DEGRADED';
export type DeploymentStatus = 'QUEUED' | 'IN_PROGRESS' | 'FINISHED' | 'FAILED' | 'CANCELLED';
export type DeploymentOperation = 'DEPLOY' | 'STOP' | 'START' | 'REMOVE' | 'ROLLBACK' | 'SCRIPT';
export type BuildPack = 'DOCKER_IMAGE' | 'DOCKERFILE' | 'STATIC';
export type DbEngine = 'POSTGRES' | 'MYSQL' | 'MARIADB' | 'REDIS' | 'MONGO' | 'KEYDB';

export interface FusionEnvironment {
  envClass?: FusionEnvClass;
  id: string;
  name: string;
}

export interface FusionContext {
  user: { userId: string; email: string; systemRole: string; status: string };
  teams: Array<{ id: string; name: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' }>;
  defaultTeamId: string | null;
  projects: Array<{ id: string; name: string; teamId: string; environments: FusionEnvironment[] }>;
  servers: Array<{ id: string; name: string; teamId: string; agentStatus: AgentStatus }>;
}

export interface FusionProject {
  id: string;
  teamId: string;
  name: string;
  environments?: FusionEnvironment[];
  createdAt?: string;
}

export interface FusionLatestDeployment {
  id: string;
  operation: DeploymentOperation;
  status: DeploymentStatus;
  errorReason?: string | null;
}

export interface FusionApp {
  id: string;
  teamId: string;
  environmentId: string;
  serverId: string;
  name: string;
  kind: 'APP' | 'DATABASE';
  buildPack: BuildPack;
  engine?: DbEngine;
  repository?: string | null;
  branch?: string;
  dockerImage?: string | null;
  dockerfilePath?: string | null;
  exposedPort?: number | null;
  hostname: string;
  autoDeploy?: boolean;
  gitTokenSet?: boolean;
  latestDeployment: FusionLatestDeployment | null;
  createdAt?: string;
  deletedAt?: string | null;
}

export interface FusionLogLine {
  id: string;
  seq: number;
  stream: string;
  text: string;
  stepId?: string | null;
  createdAt: string;
}

export interface FusionDeployment {
  id: string;
  applicationId: string;
  status: DeploymentStatus;
  operation: DeploymentOperation;
  errorReason?: string | null;
  imageTag?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  logs: FusionLogLine[];
}

export interface FusionDbCatalogEntry {
  engine: DbEngine;
  versions: string[];
  default_port: number;
  docker_image?: string;
}

export interface FusionDbCredentials {
  local: {
    engine: DbEngine;
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
  };
  external?: unknown;
}

export interface CreateAppInput {
  name: string;
  environmentId: string;
  serverId: string;
  buildPack: BuildPack;
  // DOCKERFILE
  repository?: string;
  branch?: string;
  dockerfilePath?: string;
  gitToken?: string;
  // DOCKER_IMAGE
  dockerImage?: string;
  // common
  exposedPort?: number;
  healthCheckPath?: string;
  env?: Record<string, string>;
}

export interface CreateDbInput {
  name: string;
  environmentId: string;
  serverId: string;
  engine: DbEngine;
  version: string;
  database?: string;
  username?: string;
  password?: string;
  exposePublic?: boolean;
  publicPort?: number;
}

export interface DeployAck {
  deploymentId: string;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Call the control-plane API forwarding the platform token. `teamId` adds the
 * x-team-id header required by tenant-scoped routes (everything except /context).
 */
async function api<T>(
  method: string,
  path: string,
  opts: { teamId?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const e = env();
  if (!e.FUSION_INFRA_URL || !e.FUSION_INFRA_TOKEN) {
    throw new Error('fusion-infra no está configurado (FUSION_INFRA_URL / FUSION_INFRA_TOKEN)');
  }
  const base = e.FUSION_INFRA_URL.replace(/\/+$/, '');
  const headers: Record<string, string> = { authorization: `Bearer ${e.FUSION_INFRA_TOKEN}` };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.teamId) headers['x-team-id'] = opts.teamId;

  const res = await fetch(base + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'message' in data
        ? String((data as { message: unknown }).message)
        : text || res.statusText;
    throw new FusionError(res.status, `fusion-infra ${res.status}: ${String(msg).slice(0, 300)}`);
  }
  return data as T;
}

/** Resolve the team id: explicit → FUSION_INFRA_TEAM_ID → context.defaultTeamId. */
export async function teamOf(teamId?: string): Promise<string> {
  if (teamId) return teamId;
  const e = env();
  if (e.FUSION_INFRA_TEAM_ID) return e.FUSION_INFRA_TEAM_ID;
  const c = await api<FusionContext>('GET', '/context');
  if (!c.defaultTeamId) {
    throw new Error('fusion-infra: sin team por defecto; configura FUSION_INFRA_TEAM_ID');
  }
  return c.defaultTeamId;
}

// ---- discovery ----
export function getContext(): Promise<FusionContext> {
  return api<FusionContext>('GET', '/context');
}

// ---- projects / environments (auto-create per Axon project) ----
export function createProject(name: string, teamId: string): Promise<FusionProject> {
  return api<FusionProject>('POST', '/projects', { teamId, body: { name } });
}
export function listEnvironments(projectId: string, teamId: string): Promise<FusionEnvironment[]> {
  return api<FusionEnvironment[]>('GET', `/projects/${projectId}/environments`, { teamId });
}
export function createEnvironment(
  projectId: string,
  name: string,
  teamId: string,
): Promise<FusionEnvironment> {
  return api<FusionEnvironment>('POST', `/projects/${projectId}/environments`, {
    teamId,
    body: { name },
  });
}

export type FusionEnvClass = 'DEV' | 'QA' | 'PROD';

/** Reclasifica el ambiente (DEV/QA/PROD) — en PROD fusion-infra activa backups
 * diarios automáticos de las bases de datos. */
export function updateEnvironmentClass(
  projectId: string,
  environmentId: string,
  envClass: FusionEnvClass,
  teamId: string,
): Promise<FusionEnvironment> {
  return api<FusionEnvironment>('PATCH', `/projects/${projectId}/environments/${environmentId}`, {
    teamId,
    body: { envClass },
  });
}

// ---- applications ----
export function listApps(environmentId: string, teamId: string): Promise<FusionApp[]> {
  return api<FusionApp[]>(
    'GET',
    `/applications?environmentId=${encodeURIComponent(environmentId)}`,
    { teamId },
  );
}
export function getApp(id: string, teamId: string): Promise<FusionApp> {
  return api<FusionApp>('GET', `/applications/${id}`, { teamId });
}
export function createApp(input: CreateAppInput, teamId: string): Promise<FusionApp> {
  return api<FusionApp>('POST', '/applications', { teamId, body: input });
}
export function deleteApp(id: string, teamId: string): Promise<void> {
  return api<void>('DELETE', `/applications/${id}`, { teamId });
}

/** Lifecycle ops all return { deploymentId } (HTTP 202). */
export function deployApp(id: string, teamId: string): Promise<DeployAck> {
  return api<DeployAck>('POST', `/applications/${id}/deploy`, { teamId });
}
export function redeployApp(id: string, teamId: string): Promise<DeployAck> {
  return api<DeployAck>('POST', `/applications/${id}/redeploy`, { teamId });
}
export function stopApp(id: string, teamId: string): Promise<DeployAck> {
  return api<DeployAck>('POST', `/applications/${id}/stop`, { teamId });
}
export function startApp(id: string, teamId: string): Promise<DeployAck> {
  return api<DeployAck>('POST', `/applications/${id}/start`, { teamId });
}
export function recreateApp(id: string, teamId: string): Promise<DeployAck> {
  return api<DeployAck>('POST', `/applications/${id}/recreate`, { teamId });
}
export function rollbackApp(
  id: string,
  fusionDeploymentId: string,
  teamId: string,
): Promise<DeployAck> {
  return api<DeployAck>('POST', `/applications/${id}/rollback/${fusionDeploymentId}`, { teamId });
}

export function setAppEnv(
  id: string,
  patch: { envSet?: Record<string, string>; envUnset?: string[] },
  teamId: string,
): Promise<FusionApp> {
  return api<FusionApp>('PATCH', `/applications/${id}`, { teamId, body: patch });
}
export function getAppEnvKeys(id: string, teamId: string): Promise<{ keys: string[] }> {
  return api<{ keys: string[] }>('GET', `/applications/${id}/env`, { teamId });
}

// ---- deployments (status + logs) ----
export function getDeployment(fusionDeploymentId: string, teamId: string): Promise<FusionDeployment> {
  return api<FusionDeployment>('GET', `/deployments/${fusionDeploymentId}`, { teamId });
}
export function appDeployments(id: string, teamId: string): Promise<FusionLatestDeployment[]> {
  return api<FusionLatestDeployment[]>('GET', `/applications/${id}/deployments`, { teamId });
}

// ---- governance ----
export interface FusionQualityCheck {
  name: string;
  command: string;
  image: string;
}
export interface FusionPolicy {
  id: string | null;
  environmentId: string;
  requireApproval: boolean;
  approverRole: 'OWNER' | 'ADMIN' | 'MEMBER';
  deployerRole: 'OWNER' | 'ADMIN' | 'MEMBER';
  retentionBuilds: number;
  maxMemoryMb: number | null;
  maxCpuPercent: number | null;
  qualityChecks: FusionQualityCheck[];
  updatedAt: string | null;
  createdAt: string | null;
}
export interface FusionEnvPolicySummary {
  environmentId: string;
  environmentName: string;
  policy: FusionPolicy | null;
}

export function getEnvironmentPolicy(environmentId: string, teamId: string): Promise<FusionPolicy> {
  return api<FusionPolicy>('GET', `/environments/${environmentId}/policy`, { teamId });
}
export function getProjectGovernance(projectId: string, teamId: string): Promise<FusionEnvPolicySummary[]> {
  return api<FusionEnvPolicySummary[]>('GET', `/projects/${projectId}/governance`, { teamId });
}

// ---- databases ----
export function dbCatalog(): Promise<FusionDbCatalogEntry[]> {
  return api<FusionDbCatalogEntry[]>('GET', '/databases/catalog');
}
export function createDatabase(input: CreateDbInput, teamId: string): Promise<FusionApp> {
  return api<FusionApp>('POST', '/databases', { teamId, body: input });
}
export function getDbCredentials(id: string, teamId: string): Promise<FusionDbCredentials> {
  return api<FusionDbCredentials>('GET', `/applications/${id}/credentials`, { teamId });
}
