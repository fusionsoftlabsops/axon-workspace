/**
 * Rol Scrum Master — sweep de HUs ESTANCADAS (axon#11).
 *
 * No es event-driven (el estancamiento es ausencia de eventos): un barrido
 * periódico busca HUs en trabajo (IN_PROGRESS/REVIEW) sin actividad por más
 * de `staleAfterMs` y comenta un siguiente paso accionable. Reglas:
 *  1ª detección → comentario accionable (LLM vía runtime si hay provider,
 *     fallback determinista); queda marcado con SEGUIMIENTO.
 *  2ª detección (ya hay seguimiento y sigue quieta) → ESCALACIÓN a humanos.
 *  Ya escalada → no insistir (los humanos están notificados).
 */
import type { AxonApi } from '../api/client.js';
import type { LlmProvider } from '../runtime/types.js';
import { runTrackedLoop } from '../runtime/tracked.js';
import { contextTools } from '../tools/context.js';

export const STALE_FOLLOWUP_MARK = '🤖 **SM** (seguimiento)';
export const STALE_ESCALATION_MARK = '🤖 **SM** ⚠️ ESCALACIÓN';

export interface SmStaleSweepOptions {
  api: AxonApi;
  projectId: string;
  projectSlug: string;
  /** Sin actividad por este tiempo = estancada (default 4h). */
  staleAfterMs?: number;
  /** Proveedor LLM (Anthropic) para el comentario accionable. Opcional. */
  provider?: LlmProvider;
  system?: string;
  now?: () => number;
}

const WORK_CATEGORIES = new Set(['IN_PROGRESS', 'REVIEW']);

function fallbackComment(state: string): string {
  return (
    `${STALE_FOLLOWUP_MARK}: esta HU lleva demasiado tiempo en **${state}** sin actividad.\n` +
    `Siguiente paso sugerido: publicar en un comentario el bloqueo concreto (error, decisión pendiente ` +
    `o dependencia) para que el equipo pueda destrabarla; si no hay bloqueo, retomar y registrar avance.`
  );
}

export function createSmStaleSweep(opts: SmStaleSweepOptions) {
  const staleAfterMs = opts.staleAfterMs ?? 4 * 60 * 60 * 1000;
  const now = opts.now ?? Date.now;

  async function actionableComment(storyNumber: number, state: string): Promise<string> {
    if (!opts.provider) return fallbackComment(state);
    try {
      const result = await runTrackedLoop(
        `La HU #${storyNumber} del proyecto está estancada en "${state}". Analizá su detalle y el cerebro ` +
          `del proyecto y proponé UN siguiente paso accionable y concreto para destrabarla (máx. 5 líneas).`,
        {
          api: opts.api,
          projectSlug: opts.projectSlug,
          payload: { via: 'sm-stale', storyNumber },
          provider: opts.provider,
          system:
            opts.system ??
            'Sos el Scrum Master del proyecto. Respondé SOLO con el texto del comentario accionable, sin preámbulos.',
          tools: contextTools(opts.api, opts.projectSlug),
          maxIterations: 6,
        },
      );
      if (result.status === 'SUCCEEDED' && result.finalText.trim()) {
        return `${STALE_FOLLOWUP_MARK}: ${result.finalText.trim()}`;
      }
      return fallbackComment(state);
    } catch {
      return fallbackComment(state);
    }
  }

  /** Corre un barrido. Devuelve cuántas HUs recibieron comentario. */
  async function sweepOnce(): Promise<number> {
    let enabled = false;
    try {
      enabled = (await opts.api.getMe(opts.projectSlug)).enabled;
    } catch {
      enabled = false;
    }
    if (!enabled) return 0;

    const { tasks } = await opts.api.listTasks(opts.projectSlug);
    const cutoff = now() - staleAfterMs;
    const stale = tasks.filter(
      (t) => WORK_CATEGORIES.has(t.stateCategory) && Date.parse(t.updatedAt) < cutoff,
    );

    let commented = 0;
    for (const t of stale) {
      try {
        const detail = (await opts.api.getTask(opts.projectSlug, t.number)) as {
          comments?: Array<{ body: string }>;
        };
        const comments = detail.comments ?? [];
        const escalated = comments.some((c) => c.body.includes(STALE_ESCALATION_MARK));
        if (escalated) continue; // humanos ya notificados
        const followedUp = comments.some((c) => c.body.includes(STALE_FOLLOWUP_MARK));

        const body = followedUp
          ? `${STALE_ESCALATION_MARK}: la HU sigue sin actividad después del seguimiento. ` +
            `Requiere intervención humana (reasignar, re-alcance o descartar).`
          : await actionableComment(t.number, t.state);

        await opts.api.comment(opts.projectSlug, t.number, body);
        commented += 1;
      } catch (err) {
        console.error(`[agents] sm-stale fallo en HU #${t.number}:`, err instanceof Error ? err.message : err);
      }
    }
    return commented;
  }

  return { sweepOnce, staleAfterMs };
}
