/**
 * Rol Scrum Master — handler de ASIGNACIÓN (axon#10).
 *
 * Cuando una HU aparece o entra al estado de Preparación (categoría TODO), el
 * SM la asigna al agente Dev y la mueve a Desarrollo, comentando contexto
 * inicial recolectado del cerebro. Deliberadamente DETERMINISTA (sin LLM):
 * asignar es lógica de plataforma; el juicio del SM (estancadas, retros) vive
 * en otros handlers. Todo pasa por la Admin API con el token del SM.
 */
import type { AxonApi } from '../api/client.js';
import type { DomainEventV1 } from '../events.js';
import type { RoleHandler } from '../router.js';
import { narrate } from './narrate.js';

export interface SmAssignOptions {
  api: AxonApi;
  projectId: string;
  projectSlug: string;
  /** Nombre del estado de trabajo al que se mueve la HU (default Desarrollo). */
  developmentState?: string;
  /** TTL del cache de config del agente (ms). */
  meCacheMs?: number;
}

const TODO_CATEGORY = 'TODO';

function excerpt(text: string, max = 240): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function createSmAssignHandler(opts: SmAssignOptions): RoleHandler {
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
      if (event.projectId !== opts.projectId) return false;
      if (!event.storyNumber) return false;
      if (event.type === 'story.created') return true;
      return event.type === 'story.state_changed' && event.toState?.category === TODO_CATEGORY;
    },

    async handle(event: DomainEventV1): Promise<void> {
      if (!(await smEnabled())) return;

      // Confirmar el estado REAL de la HU (story.created no trae categoría).
      const story = (await opts.api.getTask(opts.projectSlug, event.storyNumber!)) as {
        state?: string;
        title?: string;
        assignee?: { id: string } | null;
      };
      const stateName = (story.state ?? '').toLowerCase();
      if (!stateName.startsWith('prepara')) return; // ya la movió alguien
      if (story.assignee) return; // ya tiene dueño humano — no pisar

      // Contexto inicial del cerebro (best-effort: sin cerebro igual se asigna).
      let contextNote = '';
      try {
        const recall = (await opts.api.recallBrain(opts.projectSlug, story.title, 3)) as {
          memories?: Array<{ title?: string; body?: string }>;
        };
        const memories = recall.memories ?? [];
        if (memories.length > 0) {
          contextNote =
            '\n\nContexto del cerebro del proyecto:\n' +
            memories.map((m) => `- **${m.title ?? 'memoria'}**: ${excerpt(m.body ?? '')}`).join('\n');
        }
      } catch {
        /* el recall es opcional */
      }

      await opts.api.patchTask(opts.projectSlug, event.storyNumber!, {
        toState: opts.developmentState ?? 'Desarrollo',
        assignToAgentRole: 'DEV',
      });
      await opts.api.comment(
        opts.projectSlug,
        event.storyNumber!,
        `🤖 **SM**: HU asignada al Agente Dev y movida a ${opts.developmentState ?? 'Desarrollo'}.${contextNote}`,
      );
      await narrate(
        opts.api,
        opts.projectSlug,
        `Tomé la HU #${event.storyNumber} «${story.title ?? ''}» del backlog y se la asigné al Dev. ` +
          `Queda en ${opts.developmentState ?? 'Desarrollo'} — te toca.`,
        { kind: 'HANDOFF', storyNumber: event.storyNumber! },
      );
    },
  };
}
