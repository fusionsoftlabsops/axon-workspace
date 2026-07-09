/**
 * Rol QA — revisión ADVERSARIAL (axon#16).
 *
 * Ante una HU en Verificación, el QA intenta REFUTAR que esté lista: clona la
 * rama del Dev (agent/hu-N si existe, si no la default) en un workspace de
 * SOLO LECTURA, contrasta los criterios de aceptación contra el código real y
 * emite veredicto vía qa-decision (approve → Hecho / reject → Desarrollo con
 * feedback accionable). El guardarraíl anti auto-aprobación aplica server-side
 * (identidades distintas por diseño). Si el QA no puede correr, comenta y deja
 * la HU en Verificación para un humano.
 */
import type { AxonApi } from '../api/client.js';
import type { DomainEventV1 } from '../events.js';
import type { RoleHandler } from '../router.js';
import type { LlmProvider, ToolDef } from '../runtime/types.js';
import { runTrackedLoop } from '../runtime/tracked.js';
import { contextTools } from '../tools/context.js';
import { repoTools } from '../tools/repo.js';
import { GitWorkspace, type CommandRunner } from '../git/workspace.js';
import { getGitProvider, DEFAULT_GIT_CONFIG, type GitProviderConfig } from '../git/provider.js';
import { parsePrNumber } from '../git/pr-ref.js';
import { narrate } from './narrate.js';

export interface QaOptions {
  api: AxonApi;
  projectId: string;
  projectSlug: string;
  provider: LlmProvider;
  gitToken?: string;
  /** Proveedor git (host/API base/shape). Default GitHub. */
  gitConfig?: GitProviderConfig;
  run?: CommandRunner;
  meCacheMs?: number;
  maxIterations?: number;
  /** Tope de reloj del run completo (defensa contra hangs sin timeout propio). */
  maxDurationMs?: number;
}

const QA_SYSTEM = `Sos el QA adversarial del equipo. Tu trabajo NO es confirmar que la HU está bien:
es intentar demostrar que NO lo está. Contrastá cada criterio de aceptación contra el código real,
buscá casos borde sin cubrir, tests faltantes y promesas del resumen del dev que el código no cumple.

Sé DECISIVO — tenés un número LIMITADO de turnos y presupuesto de tokens. Método (seguilo en orden):
1. Si tenés la tool git_diff, EMPEZÁ por ella: te da el cambio exacto en una llamada. Solo leé un archivo completo si el diff no alcanza para juzgar un criterio.
2. Máximo ~5 lecturas en total. NO re-leas un archivo que ya viste. Después, DECIDÍ.
3. Verificá cada criterio de aceptación contra lo que viste; si un criterio no tiene evidencia clara en el código, es reject.
4. NO explores archivos no relacionados con el cambio.
Cuando tengas el veredicto, TERMINÁ: respondé SOLO un JSON (sin más tool calls):
{"decision": "approve" | "reject", "comment": "veredicto accionable en markdown (si reject: qué falta, concreto)"}`;

/** Tools de repo SIN write_file: QA lee, jamás modifica. */
function readOnlyRepoTools(root: string): ToolDef[] {
  return repoTools(root).filter((t) => t.name !== 'write_file');
}

/** Tool git_diff: el cambio exacto de la rama del dev vs. la base, en una llamada. */
export function gitDiffTool(ws: GitWorkspace, baseBranch: string): ToolDef {
  return {
    name: 'git_diff',
    description:
      'Diff exacto del cambio bajo revisión (rama del dev vs. la rama base): archivos cambiados + patch. Empezá por acá.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: async () => ws.diffAgainst(baseBranch),
  };
}

export function createQaHandler(opts: QaOptions): RoleHandler {
  let meCache: { enabled: boolean; at: number } | null = null;
  const meCacheMs = opts.meCacheMs ?? 60_000;

  async function qaEnabled(): Promise<boolean> {
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
    role: 'QA',
    matches(event: DomainEventV1): boolean {
      return (
        event.projectId === opts.projectId &&
        event.type === 'story.state_changed' &&
        event.toState?.category === 'REVIEW' &&
        !!event.storyNumber
      );
    },

    async handle(event: DomainEventV1): Promise<void> {
      if (!(await qaEnabled())) return;
      const n = event.storyNumber!;

      const story = (await opts.api.getTask(opts.projectSlug, n)) as {
        title?: string;
        description?: string;
        acceptanceCriteria?: string;
        comments?: Array<{ body: string }>;
      };

      const { repos } = await opts.api.listRepos(opts.projectSlug);
      const repo = repos.find((r) => r.url);

      let ws: GitWorkspace | null = null;
      if (repo?.url) {
        // Rama del Dev si existe; fallback a la default (revisión sin diff).
        try {
          ws = await GitWorkspace.clone({
            repoUrl: repo.url,
            branch: `agent/hu-${n}`,
            gitToken: opts.gitToken,
            run: opts.run,
          });
        } catch {
          try {
            ws = await GitWorkspace.clone({
              repoUrl: repo.url,
              branch: repo.defaultBranch,
              gitToken: opts.gitToken,
              run: opts.run,
            });
          } catch {
            ws = null;
          }
        }
      }

      try {
        const handoff = (story.comments ?? [])
          .map((c) => c.body)
          .filter((b) => b.includes('QA') || b.includes('Verificación') || b.includes('PR'))
          .slice(-3)
          .join('\n---\n');

        const goal =
          `Revisión adversarial de la HU #${n} «${story.title ?? ''}».\n\n` +
          `Descripción:\n${story.description ?? '(ver get_story)'}\n\n` +
          `Criterios de aceptación (verificá CADA uno contra el código):\n${story.acceptanceCriteria?.trim() || '(sin criterios explícitos)'}\n\n` +
          `Handoff del dev (nombra los archivos tocados — leé DIRECTO esos):\n${handoff || '(sin handoff)'}\n\n` +
          (ws
            ? `El repo está clonado en tu workspace (rama del dev). Leé solo los archivos del cambio, verificá los criterios y decidí.`
            : `SIN acceso al repo (no se pudo clonar): evaluá con el detalle de la HU y el contexto disponible, y sé conservador.`) +
          `\nAl final respondé SOLO el JSON del veredicto.`;

        const result = await runTrackedLoop(goal, {
          api: opts.api,
          projectSlug: opts.projectSlug,
          storyId: event.storyId,
          payload: { via: 'qa', storyNumber: n },
          provider: opts.provider,
          system: QA_SYSTEM,
          tools: [
            ...(ws ? [gitDiffTool(ws, repo?.defaultBranch ?? 'main'), ...readOnlyRepoTools(ws.dir)] : []),
            ...contextTools(opts.api, opts.projectSlug),
          ],
          maxIterations: opts.maxIterations ?? 16,
          maxDurationMs: opts.maxDurationMs,
        });

        if (result.status !== 'SUCCEEDED') {
          await opts.api.comment(
            opts.projectSlug,
            n,
            `🤖 **QA**: no pude completar la revisión (${result.status}). La HU queda en Verificación para revisión humana.`,
          );
          return;
        }

        let verdict: { decision?: string; comment?: string } = {};
        try {
          const m = result.finalText.match(/\{[\s\S]*\}/);
          verdict = m ? (JSON.parse(m[0]) as { decision?: string; comment?: string }) : {};
        } catch {
          verdict = {};
        }

        if (verdict.decision !== 'approve' && verdict.decision !== 'reject') {
          await opts.api.comment(
            opts.projectSlug,
            n,
            `🤖 **QA**: revisión completada pero sin veredicto parseable — queda para revisión humana.\n\n${result.finalText}`,
          );
          return;
        }

        await opts.api.qaDecision(opts.projectSlug, n, {
          decision: verdict.decision,
          comment: verdict.comment?.trim() || (verdict.decision === 'reject' ? 'Revisión adversarial: criterios sin evidencia en el código.' : undefined),
        });

        // Best-effort: además del veredicto en Axon, dejarlo también en el PR real
        // si hay uno linkeado en los comentarios — nunca rompe el veredicto ya persistido.
        try {
          const pr = parsePrNumber(story.comments ?? []);
          if (pr && repo?.url) {
            const gitProvider = getGitProvider(opts.gitConfig ?? DEFAULT_GIT_CONFIG);
            await gitProvider.postIssueComment({
              repoUrl: repo.url,
              number: pr,
              body: `🤖 **QA** (${verdict.decision}): ${
                verdict.comment?.trim() ||
                (verdict.decision === 'reject'
                  ? 'Revisión adversarial: criterios sin evidencia en el código.'
                  : 'Aprobada.')
              }`,
              token: opts.gitToken,
            });
          }
        } catch {
          /* comentar en el PR es advisory: no bloquea nada si falla */
        }

        // Aprendizaje: veredicto → cerebro PERSONAL del QA; un rechazo además
        // deja un GOTCHA en el cerebro COMPARTIDO (el equipo aprende qué faltó).
        try {
          await opts.api.captureMemory(opts.projectSlug, {
            type: 'NOTE',
            title: `QA HU #${n}: ${verdict.decision}`,
            body: (verdict.comment ?? '').slice(0, 2000) || verdict.decision,
            tags: ['qa', 'veredicto'],
            scope: 'LOCAL',
            sourceTaskNumber: n,
          });
          if (verdict.decision === 'reject') {
            await opts.api.captureMemory(opts.projectSlug, {
              type: 'GOTCHA',
              title: `QA rechazó la HU #${n} — qué faltó`,
              body: (verdict.comment ?? 'criterios sin evidencia').slice(0, 2000),
              tags: ['qa', 'reject'],
              scope: 'PROJECT',
              sourceTaskNumber: n,
            });
          }
        } catch {
          /* el aprendizaje es best-effort: jamás rompe el veredicto */
        }
        await narrate(
          opts.api,
          opts.projectSlug,
          verdict.decision === 'approve'
            ? `Revisé la HU #${n} contra el código real y no logré refutarla: APROBADA → Terminada. 🎉`
            : `Revisé la HU #${n} y la RECHACÉ: ${verdict.comment?.trim() ?? 'criterios sin evidencia'}. ` +
              `Vuelve a Desarrollo — Dev, te toca.`,
          { kind: 'HANDOFF', storyNumber: n },
        );
      } finally {
        if (ws) await ws.cleanup();
      }
    },
  };
}
