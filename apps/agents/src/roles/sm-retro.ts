/**
 * Rol Scrum Master — RETRO al cerebro (axon#12).
 *
 * Cuando una HU llega a Hecho (categoría DONE), el SM destila el aprendizaje
 * de esa entrega (qué se hizo, decisiones, tropiezos visibles en comentarios)
 * y lo publica como memoria PROJECT en el cerebro — la mejora continua queda
 * institucionalizada, no en la cabeza de un agente. Requiere provider LLM:
 * sin él, el handler se queda quieto (una retro genérica no aporta).
 */
import type { AxonApi } from '../api/client.js';
import type { DomainEventV1 } from '../events.js';
import type { RoleHandler } from '../router.js';
import type { LlmProvider } from '../runtime/types.js';
import { runTrackedLoop } from '../runtime/tracked.js';
import { contextTools } from '../tools/context.js';

export interface SmRetroOptions {
  api: AxonApi;
  projectId: string;
  projectSlug: string;
  provider?: LlmProvider;
  meCacheMs?: number;
}

export const RETRO_TAG = 'retro-sm';

export function createSmRetroHandler(opts: SmRetroOptions): RoleHandler {
  let meCache: { enabled: boolean; at: number } | null = null;
  const meCacheMs = opts.meCacheMs ?? 60_000;

  async function smEnabled(): Promise<boolean> {
    const now = Date.now();
    if (meCache && now - meCache.at < meCacheMs) return meCache.enabled;
    try {
      const me = await opts.api.getMe(opts.projectSlug);
      meCache = { enabled: me.enabled, at: now };
      return me.enabled;
    } catch {
      meCache = { enabled: false, at: now };
      return false;
    }
  }

  return {
    role: 'SM',
    matches(event: DomainEventV1): boolean {
      return (
        event.projectId === opts.projectId &&
        event.type === 'story.state_changed' &&
        event.toState?.category === 'DONE' &&
        !!event.storyNumber &&
        !!opts.provider
      );
    },

    async handle(event: DomainEventV1): Promise<void> {
      if (!(await smEnabled())) return;

      const result = await runTrackedLoop(
        `La HU #${event.storyNumber} acaba de llegar a Hecho. Leé su detalle (get_story) y destilá UNA ` +
          `retro breve para el cerebro del proyecto: qué se entregó, qué decisión o aprendizaje vale la pena ` +
          `recordar, y qué tropiezo evitar la próxima vez. Respondé SOLO un JSON: ` +
          `{"title": "...", "body": "markdown de máx 10 líneas"}.`,
        {
          api: opts.api,
          projectSlug: opts.projectSlug,
          storyId: event.storyId,
          payload: { via: 'sm-retro', storyNumber: event.storyNumber },
          provider: opts.provider!,
          system:
            'Sos el Scrum Master. Escribís retros útiles y concretas, sin ceremonias. Español neutro.',
          tools: contextTools(opts.api, opts.projectSlug),
          maxIterations: 5,
        },
      );
      if (result.status !== 'SUCCEEDED') return;

      let retro: { title?: string; body?: string } = {};
      try {
        const match = result.finalText.match(/\{[\s\S]*\}/);
        retro = match ? (JSON.parse(match[0]) as { title?: string; body?: string }) : {};
      } catch {
        retro = {};
      }
      const title = retro.title?.trim() || `Retro HU #${event.storyNumber}`;
      const body = retro.body?.trim() || result.finalText.trim();
      if (!body) return;

      await opts.api.captureMemory(opts.projectSlug, {
        type: 'NOTE',
        title: title.slice(0, 200),
        body: body.slice(0, 20_000),
        tags: [RETRO_TAG],
        scope: 'PROJECT',
        sourceTaskNumber: event.storyNumber,
      });
    },
  };
}
