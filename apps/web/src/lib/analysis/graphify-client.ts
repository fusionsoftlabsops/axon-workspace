/**
 * Client for graphify-svc (self-hosted, on the internal `fusion` network) which
 * clones a project's repos and returns a code knowledge graph. Mirrors the
 * pattern of lib/ai/infra-llm.ts: env-configured, optional, graceful when unset.
 *
 * See apps/graphify-svc for the service.
 */
import { env } from '@/lib/env';
import type { CodeGraph } from './describe';

export interface GraphifyRepoInput {
  name: string;
  githubFullName?: string | null;
  cloneUrl?: string | null;
  branch?: string | null;
  kind?: string | null;
}

export interface GraphifyStats {
  nodes: number;
  edges: number;
  communities: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  backend?: string;
}

export interface GraphifyResult {
  graph: CodeGraph;
  stats: GraphifyStats;
  report: string | null;
  backend: string;
  repos: string[];
}

export function isGraphifyConfigured(): boolean {
  return Boolean(env().GRAPHIFY_URL);
}

/** Call graphify-svc /analyze. Long timeout: extraction clones + runs an LLM
 *  pass over the repos and can take minutes. Throws on transport/HTTP errors. */
export interface GraphifyProgress {
  phase: 'cloning' | 'extracting' | 'building' | 'done' | 'failed' | 'unknown';
  percent: number;
  repo?: string;
  chunksDone?: number;
  chunksTotal?: number;
  codeFiles?: number;
}

export async function analyzeRepos(
  repos: GraphifyRepoInput[],
  opts?: { backend?: string; timeoutMs?: number; jobId?: string },
): Promise<GraphifyResult> {
  const e = env();
  if (!e.GRAPHIFY_URL) throw new Error('graphify-svc no está configurado (GRAPHIFY_URL)');
  const base = e.GRAPHIFY_URL.replace(/\/+$/, '');
  const backend = opts?.backend ?? e.GRAPHIFY_BACKEND;

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (e.GRAPHIFY_AUTH_TOKEN) headers.authorization = `Bearer ${e.GRAPHIFY_AUTH_TOKEN}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 25 * 60_000);
  try {
    const res = await fetch(`${base}/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ repos, ...(backend ? { backend } : {}), ...(opts?.jobId ? { jobId: opts.jobId } : {}) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`graphify-svc ${res.status}: ${detail.slice(0, 300)}`);
    }
    return (await res.json()) as GraphifyResult;
  } finally {
    clearTimeout(timeout);
  }
}

/** Poll the live progress of an in-flight analysis (by jobId). Best-effort. */
export async function getProgress(jobId: string): Promise<GraphifyProgress | null> {
  const e = env();
  if (!e.GRAPHIFY_URL) return null;
  const headers: Record<string, string> = {};
  if (e.GRAPHIFY_AUTH_TOKEN) headers.authorization = `Bearer ${e.GRAPHIFY_AUTH_TOKEN}`;
  try {
    const res = await fetch(`${e.GRAPHIFY_URL.replace(/\/+$/, '')}/progress/${jobId}`, {
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as GraphifyProgress;
  } catch {
    return null;
  }
}

export async function graphifyHealthy(): Promise<boolean> {
  const e = env();
  if (!e.GRAPHIFY_URL) return false;
  try {
    const res = await fetch(`${e.GRAPHIFY_URL.replace(/\/+$/, '')}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
