/**
 * Rol Release / DevOps (agente Marco).
 *
 * Cuando una HU llega a Hecho (DONE), Marco verifica el estado de RELEASE del PR
 * asociado y comenta si está listo para desplegar: consulta GitHub (solo lectura)
 * si el PR está mergeado y si el CI está verde, y deja un veredicto de readiness.
 *
 * GUARDARRAÍL (regla de prod): Marco NO mergea y NO despliega a producción por su
 * cuenta — solo verifica y avisa. El deploy autónomo a prod es una capacidad
 * opt-in aparte que requiere autorización explícita; esta versión es advisory.
 */
import type { AxonApi } from '../api/client.js';
import type { DomainEventV1 } from '../events.js';
import type { RoleHandler } from '../router.js';
import { getGitProvider, DEFAULT_GIT_CONFIG, type GitProviderConfig } from '../git/provider.js';
import { parsePrNumber } from '../git/pr-ref.js';
import { narrate } from './narrate.js';

export { parsePrNumber };

export interface ReleaseOptions {
  api: AxonApi;
  projectId: string;
  projectSlug: string;
  gitToken?: string;
  /** Proveedor git (host/API base/shape). Default GitHub. */
  gitConfig?: GitProviderConfig;
  meCacheMs?: number;
  /** Inyectable para tests (default: fetch global). */
  fetchImpl?: typeof fetch;
}

export function createReleaseHandler(opts: ReleaseOptions): RoleHandler {
  const doFetch = opts.fetchImpl ?? fetch;
  const provider = getGitProvider(opts.gitConfig ?? DEFAULT_GIT_CONFIG, doFetch);
  let meCache: { enabled: boolean; at: number } | null = null;
  const meCacheMs = opts.meCacheMs ?? 60_000;

  async function releaseEnabled(): Promise<boolean> {
    const now = Date.now();
    if (meCache && now - meCache.at < meCacheMs) return meCache.enabled;
    try {
      meCache = { enabled: (await opts.api.getMe(opts.projectSlug)).enabled, at: now };
    } catch {
      meCache = { enabled: false, at: now };
    }
    return meCache.enabled;
  }

  async function gh(path: string): Promise<unknown> {
    const res = await provider.apiFetch(path, opts.gitToken, { timeoutMs: 20_000 });
    if (!res.ok) throw new Error(`git ${res.status}`);
    return res.json();
  }

  return {
    role: 'RELEASE',
    matches(event: DomainEventV1): boolean {
      return (
        event.projectId === opts.projectId &&
        event.type === 'story.state_changed' &&
        event.toState?.category === 'DONE' &&
        !!event.storyNumber
      );
    },

    async handle(event: DomainEventV1): Promise<void> {
      if (!(await releaseEnabled())) return;
      const n = event.storyNumber!;
      const story = (await opts.api.getTask(opts.projectSlug, n)) as {
        title?: string;
        comments?: Array<{ body: string }>;
      };
      const pr = parsePrNumber(story.comments ?? []);
      if (!pr) return; // sin PR asociado no hay release que verificar

      const { repos } = await opts.api.listRepos(opts.projectSlug);
      const repo = repos.find((r) => r.githubFullName || r.url);
      const ref = repo?.url ? provider.parseRepoRef(repo.url) : null;
      const full = repo?.githubFullName ?? (ref ? `${ref.owner}/${ref.repo}` : undefined);
      if (!full || !opts.gitToken) return;

      let verdict: string;
      try {
        const prData = (await gh(`/repos/${full}/pulls/${pr}`)) as {
          merged?: boolean;
          state?: string;
          head?: { sha?: string };
        };
        if (prData.merged) {
          let ci = 'desconocido';
          try {
            const status = (await gh(`/repos/${full}/commits/${prData.head?.sha}/status`)) as { state?: string };
            ci = status.state ?? 'desconocido';
          } catch {
            /* CI status opcional */
          }
          verdict =
            ci === 'success' || ci === 'desconocido'
              ? `🚀 **Release**: PR #${pr} **mergeado**${ci === 'success' ? ' y CI verde' : ''} — **listo para desplegar** a producción.`
              : `🚀 **Release**: PR #${pr} mergeado pero el CI está **${ci}** — revisar antes de desplegar.`;
        } else {
          verdict = `🚀 **Release**: PR #${pr} **sin mergear** (estado ${prData.state ?? '?'}) — falta el merge humano antes de desplegar.`;
        }
      } catch (err) {
        verdict = `🚀 **Release**: no pude verificar el PR #${pr} en GitHub (${err instanceof Error ? err.message : 'error'}).`;
      }

      await opts.api.comment(opts.projectSlug, n, verdict);
      await narrate(opts.api, opts.projectSlug, `Release de la HU #${n}: ${verdict.replace(/\*\*/g, '')}`, {
        kind: 'STATUS',
        storyNumber: n,
      });
    },
  };
}
