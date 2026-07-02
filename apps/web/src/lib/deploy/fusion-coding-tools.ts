/**
 * Fusion Code onboarding client — mints per-user model tokens (fsn_…) against
 * the fusion-infra control-plane and discovers the exposed model endpoint, so
 * the Develop page can hand out a pre-configured installer one-liner.
 *
 * Kept as its own module (instead of growing lib/deploy/fusion-client.ts):
 * these are Coding-Tools/onboarding calls, not deploy-lifecycle ones. It reuses
 * the exported plumbing (teamOf, FusionError, isFusionConfigured) and mirrors
 * fusion-client's private `api()` (Bearer fapi_ + x-team-id).
 */
import { env } from '@/lib/env';
import { FusionError, teamOf } from './fusion-client';

export { isFusionConfigured } from './fusion-client';

const TIMEOUT_MS = 30_000;

/** An app exposed as a token-gated model API (GET /coding-tools/model). */
export interface FusionExposedModel {
  appId: string;
  name: string;
  /** Public base, e.g. https://vllm-api.fusion-soft-lab.com (no /v1 suffix). */
  url: string;
}

/** A freshly minted per-user model token — plaintext returned ONCE. */
export interface FusionModelToken {
  id: string;
  name: string;
  createdAt: string;
  token: string;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function api<T>(
  method: string,
  path: string,
  opts: { teamId?: string; body?: unknown } = {},
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
    signal: AbortSignal.timeout(TIMEOUT_MS),
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

/** The team's exposed model endpoints (appId + name + public URL). */
export async function getExposedModels(teamId?: string): Promise<FusionExposedModel[]> {
  const team = await teamOf(teamId);
  return api<FusionExposedModel[]>('GET', '/coding-tools/model', { teamId: team });
}

/**
 * Mint a per-user model token for an exposed app. The plaintext `token`
 * (fsn_…) is returned once and never retrievable again.
 */
export async function createModelToken(
  appId: string,
  name: string,
  teamId?: string,
): Promise<FusionModelToken> {
  const team = await teamOf(teamId);
  return api<FusionModelToken>('POST', `/applications/${appId}/tokens`, {
    teamId: team,
    // The control-plane caps the name at 80 chars (createModelTokenSchema).
    body: { name: name.slice(0, 80) },
  });
}
