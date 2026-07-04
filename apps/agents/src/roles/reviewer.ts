/**
 * Rol Code Reviewer (agente Ren).
 *
 * Ante una HU en Verificación, Ren revisa la CALIDAD del código del PR
 * (mantenibilidad, patrones/consistencia con el repo, seguridad, deuda técnica,
 * tests) — distinto del QA, que valida los criterios de aceptación. Clona la
 * rama del Dev en SOLO LECTURA, revisa de forma ACOTADA (como el QA) y deja un
 * comentario de code-review con severidad + hallazgos accionables.
 *
 * ADVISORY: Ren NO mueve la HU (el QA es dueño del estado accept/reject). Su
 * valor es un segundo par de ojos sobre el código antes del merge humano.
 */
import type { AxonApi } from '../api/client.js';
import type { DomainEventV1 } from '../events.js';
import type { RoleHandler } from '../router.js';
import type { LlmProvider, ToolDef } from '../runtime/types.js';
import { runTrackedLoop } from '../runtime/tracked.js';
import { contextTools } from '../tools/context.js';
import { repoTools } from '../tools/repo.js';
import { GitWorkspace, type CommandRunner } from '../git/workspace.js';
import { gitDiffTool } from './qa.js';
import { narrate } from './narrate.js';

export interface ReviewerOptions {
  api: AxonApi;
  projectId: string;
  projectSlug: string;
  provider: LlmProvider;
  gitToken?: string;
  run?: CommandRunner;
  meCacheMs?: number;
  maxIterations?: number;
  maxDurationMs?: number;
}

const REVIEWER_SYSTEM = `Sos un code reviewer senior. Tu foco es la CALIDAD del código del cambio, NO los
criterios de aceptación (de eso se encarga el QA). Revisá: mantenibilidad y legibilidad, consistencia
con los patrones del repo, seguridad (inputs, secretos, inyección), manejo de errores/casos borde,
y cobertura de tests. Señalá deuda técnica y riesgos concretos; reconocé lo que está bien.

Sé DECISIVO — turnos y tokens limitados. Método:
1. Si tenés la tool git_diff, EMPEZÁ por ella: te da el cambio exacto en una llamada. Solo leé un archivo completo si el diff no alcanza.
2. Máximo ~5 lecturas; no re-leas. Después, emití el review.
3. NO evalúes criterios de aceptación (eso es del QA); enfocate en la calidad del código.
Terminá con SOLO un JSON (sin más tool calls):
{"severity": "ok" | "concerns" | "blocker", "comment": "review en markdown: hallazgos concretos por archivo/línea, o 'sin observaciones' si está limpio"}`;

function readOnlyRepoTools(root: string): ToolDef[] {
  return repoTools(root).filter((t) => t.name !== 'write_file');
}

export function createReviewerHandler(opts: ReviewerOptions): RoleHandler {
  let meCache: { enabled: boolean; at: number } | null = null;
  const meCacheMs = opts.meCacheMs ?? 60_000;

  async function reviewerEnabled(): Promise<boolean> {
    const now = Date.now();
    if (meCache && now - meCache.at < meCacheMs) return meCache.enabled;
    try {
      meCache = { enabled: (await opts.api.getMe(opts.projectSlug)).enabled, at: now };
    } catch {
      meCache = { enabled: false, at: now };
    }
    return meCache.enabled;
  }

  return {
    role: 'REVIEWER',
    matches(event: DomainEventV1): boolean {
      return (
        event.projectId === opts.projectId &&
        event.type === 'story.state_changed' &&
        event.toState?.category === 'REVIEW' &&
        !!event.storyNumber
      );
    },

    async handle(event: DomainEventV1): Promise<void> {
      if (!(await reviewerEnabled())) return;
      const n = event.storyNumber!;

      const story = (await opts.api.getTask(opts.projectSlug, n)) as {
        title?: string;
        comments?: Array<{ body: string }>;
      };

      const { repos } = await opts.api.listRepos(opts.projectSlug);
      const repo = repos.find((r) => r.url);
      if (!repo?.url) return; // sin repo no hay código que revisar

      let ws: GitWorkspace | null = null;
      try {
        ws = await GitWorkspace.clone({ repoUrl: repo.url, branch: `agent/hu-${n}`, gitToken: opts.gitToken, run: opts.run });
      } catch {
        return; // sin la rama del dev no hay diff que revisar
      }

      try {
        const handoff = (story.comments ?? [])
          .map((c) => c.body)
          .filter((b) => b.includes('QA') || b.includes('PR') || b.includes('Cierre'))
          .slice(-3)
          .join('\n---\n');

        const goal =
          `Code review de la HU #${n} «${story.title ?? ''}».\n\n` +
          `Handoff del dev (nombra los archivos tocados — leé DIRECTO esos):\n${handoff || '(sin handoff)'}\n\n` +
          `El repo está clonado (rama del dev). Revisá la calidad del código del cambio y emití el JSON del review.`;

        const result = await runTrackedLoop(goal, {
          api: opts.api,
          projectSlug: opts.projectSlug,
          storyId: event.storyId,
          payload: { via: 'reviewer', storyNumber: n },
          provider: opts.provider,
          system: REVIEWER_SYSTEM,
          tools: [gitDiffTool(ws, repo.defaultBranch ?? 'main'), ...readOnlyRepoTools(ws.dir), ...contextTools(opts.api, opts.projectSlug)],
          maxIterations: opts.maxIterations ?? 12,
          maxDurationMs: opts.maxDurationMs,
        });

        if (result.status !== 'SUCCEEDED') {
          await opts.api.comment(opts.projectSlug, n, `🔎 **Code Review**: no pude completar la revisión de código (${result.status}).`);
          return;
        }

        let review: { severity?: string; comment?: string } = {};
        try {
          const m = result.finalText.match(/\{[\s\S]*\}/);
          review = m ? (JSON.parse(m[0]) as { severity?: string; comment?: string }) : {};
        } catch {
          review = {};
        }

        const sev = review.severity === 'blocker' ? '🛑 blocker' : review.severity === 'concerns' ? '⚠️ observaciones' : '✅ ok';
        const body = review.comment?.trim() || 'Sin observaciones de calidad.';
        await opts.api.comment(opts.projectSlug, n, `🔎 **Code Review (${sev})**\n\n${body}`);
        await narrate(
          opts.api,
          opts.projectSlug,
          review.severity === 'blocker'
            ? `Revisé el código de la HU #${n} y hay un blocker de calidad: ${body.slice(0, 160)}`
            : review.severity === 'concerns'
              ? `Revisé el código de la HU #${n}: algunas observaciones de calidad para el merge.`
              : `Revisé el código de la HU #${n}: limpio, sin observaciones. 👍`,
          { kind: 'STATUS', storyNumber: n },
        );
      } finally {
        if (ws) await ws.cleanup();
      }
    },
  };
}
