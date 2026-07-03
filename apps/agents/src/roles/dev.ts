/**
 * Rol Dev — pipeline de implementación (axon#13).
 *
 * Ante una HU que entra a Desarrollo asignada a ESTE agente:
 *   1. Contexto: detalle de la HU + cerebro + grafo (tools de contexto).
 *   2. Workspace: clone superficial del repo del proyecto + rama agent/hu-N.
 *   3. Loop Qwen con tools de repo (leer/listar/buscar/escribir) — el modelo
 *      NO commitea: escribir es suyo, versionar es del pipeline.
 *   4. Si hubo cambios: commit + push + PR (pasos deterministas).
 *   5. submit_qa_review con el resumen (+link del PR) → HU a Verificación.
 *   Sin cambios o corrida fallida → comentario explicando y la HU se queda en
 *   Desarrollo (el sweep de estancadas del SM la levantará si nadie actúa).
 */
import type { AxonApi } from '../api/client.js';
import type { DomainEventV1 } from '../events.js';
import type { RoleHandler } from '../router.js';
import type { LlmProvider } from '../runtime/types.js';
import { runTrackedLoop } from '../runtime/tracked.js';
import { contextTools } from '../tools/context.js';
import { repoTools } from '../tools/repo.js';
import { GitWorkspace, type CommandRunner } from '../git/workspace.js';
import { narrate } from './narrate.js';

export interface DevOptions {
  api: AxonApi;
  projectId: string;
  projectSlug: string;
  provider: LlmProvider;
  /** Token de GitHub para clone/push/PR (repos privados). */
  gitToken?: string;
  /** Runner de comandos inyectable (tests). */
  run?: CommandRunner;
  meCacheMs?: number;
  maxIterations?: number;
  /** Tope de reloj del run completo (defensa contra hangs sin timeout propio). */
  maxDurationMs?: number;
}

// Tuning post-dogfooding (primer ciclo vivo: 24 iteraciones agotadas explorando):
// prompt DECISIVO — ir directo a los archivos nombrados, escribir temprano,
// presupuesto de exploración explícito y cierre obligatorio con resumen.
const DEV_SYSTEM = `Sos el desarrollador full-stack senior del equipo. Implementás UNA historia de usuario
por corrida, con cambios mínimos y consistentes con el código existente. Tenés un número LIMITADO de
turnos: sé decisivo.
Método (seguilo en orden, sin vueltas):
1. Si la HU nombra archivos concretos, leelos DIRECTO con read_file (no listes ni busques primero).
2. Máximo 4 turnos de exploración en total (list_files/search_files/read_file). Después de eso, ESCRIBÍ.
3. write_file reemplaza el archivo COMPLETO: incluí todo el contenido final, no fragmentos.
4. Modificá SOLO lo que la HU pide + su test. Nada de refactors oportunistas.
5. Cuando los archivos estén escritos, TERMINÁ: respondé sin tool calls con un resumen markdown de
   qué cambiaste y por qué (es el handoff a QA). No re-verifiques leyendo lo que acabás de escribir.`;

export function createDevHandler(opts: DevOptions): RoleHandler {
  let meCache: { enabled: boolean; userId: string | null; at: number } | null = null;
  const meCacheMs = opts.meCacheMs ?? 60_000;

  async function me(): Promise<{ enabled: boolean; userId: string | null }> {
    const now = Date.now();
    if (meCache && now - meCache.at < meCacheMs) return meCache;
    try {
      const m = (await opts.api.getMe(opts.projectSlug)) as { enabled: boolean; userId?: string };
      meCache = { enabled: m.enabled, userId: m.userId ?? null, at: now };
    } catch {
      meCache = { enabled: false, userId: null, at: now };
    }
    return meCache;
  }

  return {
    role: 'DEV',
    matches(event: DomainEventV1): boolean {
      return (
        event.projectId === opts.projectId &&
        event.type === 'story.state_changed' &&
        event.toState?.category === 'IN_PROGRESS' &&
        !!event.storyNumber &&
        !!event.assigneeId
      );
    },

    async handle(event: DomainEventV1): Promise<void> {
      const self = await me();
      if (!self.enabled) return;
      // Solo HUs asignadas a ESTE agente (identidad resuelta server-side).
      if (!self.userId || event.assigneeId !== self.userId) return;

      const n = event.storyNumber!;
      const story = (await opts.api.getTask(opts.projectSlug, n)) as {
        title?: string;
        description?: string;
      };

      // Repo del proyecto: el primero vinculado (v1: un repo por proyecto).
      const { repos } = await opts.api.listRepos(opts.projectSlug);
      const repo = repos.find((r) => r.url);
      if (!repo?.url) {
        await opts.api.comment(
          opts.projectSlug,
          n,
          '🤖 **Dev**: no puedo implementar — el proyecto no tiene un repo con URL vinculado.',
        );
        return;
      }

      const branch = `agent/hu-${n}`;
      await narrate(
        opts.api,
        opts.projectSlug,
        `Tomo la HU #${n} «${story.title ?? ''}». Clonando el repo y arrancando la implementación.`,
        { kind: 'STATUS', storyNumber: n },
      );
      const ws = await GitWorkspace.clone({
        repoUrl: repo.url,
        branch: repo.defaultBranch,
        gitToken: opts.gitToken,
        run: opts.run,
      });

      try {
        await ws.createBranch(branch);

        const goal =
          `Implementá la HU #${n} «${story.title ?? ''}».\n\n` +
          `Descripción / criterios:\n${story.description ?? '(ver get_story)'}\n\n` +
          `El repo ya está clonado en tu workspace (rama ${branch}). Explorá, implementá y al final ` +
          `respondé SOLO el resumen markdown del cambio.`;

        const result = await runTrackedLoop(goal, {
          api: opts.api,
          projectSlug: opts.projectSlug,
          storyId: event.storyId,
          payload: { via: 'dev', storyNumber: n, branch },
          provider: opts.provider,
          system: DEV_SYSTEM,
          tools: [...repoTools(ws.dir), ...contextTools(opts.api, opts.projectSlug)],
          maxIterations: opts.maxIterations ?? 40,
          maxDurationMs: opts.maxDurationMs,
        });

        if (result.status !== 'SUCCEEDED') {
          await opts.api.comment(
            opts.projectSlug,
            n,
            `🤖 **Dev**: la corrida terminó ${result.status} (${result.stopped}) tras ${result.iterations} ` +
              `iteraciones y ${result.usage.totalTokens} tokens. La HU sigue en Desarrollo.`,
          );
          await narrate(
            opts.api,
            opts.projectSlug,
            `No pude cerrar la HU #${n} en esta corrida (${result.stopped}, ${result.iterations} iteraciones). ` +
              `Queda en Desarrollo — si alguien ve el bloqueo, comente en la HU.`,
            { kind: 'STATUS', storyNumber: n },
          );
          return;
        }

        if (!(await ws.hasChanges())) {
          await opts.api.comment(
            opts.projectSlug,
            n,
            `🤖 **Dev**: la corrida terminó sin cambios en el repo. Resumen del análisis:\n\n${result.finalText}`,
          );
          await narrate(
            opts.api,
            opts.projectSlug,
            `Analicé la HU #${n} pero no produje cambios en el repo (detalle en la HU).`,
            { kind: 'STATUS', storyNumber: n },
          );
          return;
        }

        await ws.commitAll(`feat: HU #${n} ${story.title ?? ''} (agente dev)`.slice(0, 120));
        await ws.push(branch);
        const prUrl = await ws.openPr({
          title: `HU #${n}: ${story.title ?? ''}`.slice(0, 120),
          body: `${result.finalText}\n\n---\nImplementada por el Agente Dev. HU: #${n}.`,
          head: branch,
          base: repo.defaultBranch,
        });

        await opts.api.submitQaReview(opts.projectSlug, n, {
          executedTasks: [`Implementación en rama ${branch}`, `PR: ${prUrl}`],
          notes: `${result.finalText}\n\nPR: ${prUrl}`,
          suggestedTests: ['Revisar el PR y correr la suite del repo'],
          moveToVerification: true,
        });
        await narrate(
          opts.api,
          opts.projectSlug,
          `Terminé la HU #${n}: PR abierto en ${prUrl} (${result.usage.totalTokens} tokens, ` +
            `${result.iterations} iteraciones). Pasa a Verificación — QA, te toca.`,
          { kind: 'HANDOFF', storyNumber: n },
        );
      } finally {
        await ws.cleanup();
      }
    },
  };
}
