/**
 * Minimal GitHub REST client for the plan's Repositories section: create repos
 * and read collaborator access. Authenticated with an org PAT from env
 * (GITHUB_TOKEN), optionally scoped to GITHUB_ORG. Optional — when unset,
 * isGithubConfigured() is false and callers degrade gracefully. The token is
 * never logged.
 */
import { env } from '@/lib/env';

const API = 'https://api.github.com';

export function isGithubConfigured(): boolean {
  return Boolean(env().GITHUB_TOKEN);
}
export function githubOrg(): string | undefined {
  return env().GITHUB_ORG || undefined;
}

function headers(): Record<string, string> {
  return {
    authorization: `Bearer ${env().GITHUB_TOKEN}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'Axon-Planner',
  };
}

/** Parse a repo URL/identifier into `owner/repo` (drops host, .git, trailing slashes). */
export function parseRepoFullName(input: string): string | null {
  const s = (input || '').trim();
  if (!s) return null;
  // Already owner/repo?
  const direct = s.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (direct && !s.includes('://') && !s.includes('github.com')) return `${direct[1]}/${direct[2]}`;
  const m = s.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

export interface CreatedRepo {
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  existed: boolean;
}

/** Create a repo under the org (or the token's user if no org). Idempotent on
 *  "name already exists" — returns the existing repo's identity with existed=true. */
export async function createRepo(
  name: string,
  opts: { description?: string; private?: boolean } = {},
): Promise<CreatedRepo> {
  if (!isGithubConfigured()) throw new Error('GitHub no está configurado');
  const org = githubOrg();
  const url = org ? `${API}/orgs/${org}/repos` : `${API}/user/repos`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers(), 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      description: opts.description?.slice(0, 300) || undefined,
      private: opts.private ?? true,
      auto_init: true,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 201) {
    const j = (await res.json()) as { full_name: string; html_url: string; default_branch: string };
    return { fullName: j.full_name, htmlUrl: j.html_url, defaultBranch: j.default_branch || 'main', existed: false };
  }
  if (res.status === 422) {
    // Most likely "name already exists on this account" — treat as existing.
    const owner = org ?? (await currentLogin().catch(() => null));
    if (owner) {
      return {
        fullName: `${owner}/${name}`,
        htmlUrl: `https://github.com/${owner}/${name}`,
        defaultBranch: 'main',
        existed: true,
      };
    }
  }
  const body = await res.text().catch(() => '');
  throw new Error(`GitHub create repo: HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
}

async function currentLogin(): Promise<string | null> {
  const res = await fetch(`${API}/user`, { headers: headers(), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const j = (await res.json()) as { login?: string };
  return j.login ?? null;
}

export type RepoPermission = 'admin' | 'write' | 'read' | 'none';

/** Effective permission a user has on a repo. 404 (not a collaborator / no token
 *  visibility) maps to 'none'. */
export async function getCollaboratorPermission(fullName: string, login: string): Promise<RepoPermission> {
  if (!isGithubConfigured()) throw new Error('GitHub no está configurado');
  const res = await fetch(`${API}/repos/${fullName}/collaborators/${encodeURIComponent(login)}/permission`, {
    headers: headers(),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return 'none';
  if (!res.ok) throw new Error(`GitHub permission: HTTP ${res.status}`);
  const j = (await res.json()) as { permission?: string };
  const p = (j.permission ?? 'none').toLowerCase();
  if (p === 'admin' || p === 'write' || p === 'read') return p;
  return 'none';
}
