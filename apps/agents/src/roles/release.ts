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
import { narrate } from './narrate.js';

export interface ReleaseOptions {
  api: AxonApi;
  projectId: string;
  projectSlug: string;
  gitToken?: string;
  meCacheMs?: number;
  /** Inyectable para tests (default: fetch global). */
  fetchImpl?: typeof fetch;
}

/** Extrae el número de PR del primer link github .../pull/N en los comentarios. */
export function parsePrNumber(comments: Array<{ body: string }>): number | null {
  for (const c of [...comments].reverse()) {
    const m = c.body.match(/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/i);
    if (m) return parseInt(m[1]!, 10);
  }
  return null;
}

export function createReleaseHandler(opts: ReleaseOptions): RoleHandler {
  const doFetch = opts.fetchImpl ?? fetch;
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
    const res = await doFetch(`https://api.github.com${path}`, {
      headers: {
        authorization: `Bearer ${opts.gitToken}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'axon-release',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`github ${res.status}`);
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
      const full = repo?.githubFullName ?? repo?.url?.match(/github\.com[/:]([^/]+\/[^/.]+)/i)?.[1];
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
