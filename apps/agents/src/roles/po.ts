/**
 * Rol Product Owner (agente Iris).
 *
 * Dos responsabilidades, ambas DETERMINISTAS (la IA vive server-side en el
 * endpoint de refinamiento):
 *  - **DoR (Definition of Ready)**: cuando una HU entra al backlog (Preparación)
 *    SIN criterios de aceptación, el PO la refina (descripción + criterios +
 *    prioridad, vía IA) y la marca lista. Eso dispara `story.refined` → el SM la
 *    asigna al Dev. HUs que ya traen criterios se dejan pasar (nada que refinar).
 *  - **DoD (Definition of Done)**: cuando una HU llega a Hecho (DONE, tras la
 *    aprobación de QA), el PO firma la aceptación de producto.
 */
import type { AxonApi } from '../api/client.js';
import type { DomainEventV1 } from '../events.js';
import type { RoleHandler } from '../router.js';
import { narrate } from './narrate.js';

export interface PoOptions {
  api: AxonApi;
  projectId: string;
  projectSlug: string;
  meCacheMs?: number;
}

export function createPoHandler(opts: PoOptions): RoleHandler {
  let meCache: { enabled: boolean; at: number } | null = null;
  const meCacheMs = opts.meCacheMs ?? 60_000;

  async function poEnabled(): Promise<boolean> {
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
    role: 'PO',
    matches(event: DomainEventV1): boolean {
      if (event.projectId !== opts.projectId || !event.storyNumber) return false;
      if (event.type === 'story.created') return true; // refinar (DoR)
      if (event.type === 'story.state_changed') {
        const cat = event.toState?.category;
        return cat === 'TODO' || cat === 'DONE'; // DoR en backlog, DoD en done
      }
      return false;
    },

    async handle(event: DomainEventV1): Promise<void> {
      if (!(await poEnabled())) return;
      const n = event.storyNumber!;
      const story = (await opts.api.getTask(opts.projectSlug, n)) as {
        state?: string;
        title?: string;
        acceptanceCriteria?: string;
      };
      const stateName = (story.state ?? '').toLowerCase();

      // --- DoD: HU en Hecho (tras aprobación de QA) → aceptación de producto ---
      if (event.toState?.category === 'DONE') {
        await opts.api.comment(
          opts.projectSlug,
          n,
          `🤖 **PO**: HU aceptada — cumple la Definition of Done (QA aprobó y los criterios de aceptación se verificaron). 🎉`,
        );
        await narrate(
          opts.api,
          opts.projectSlug,
          `Acepté la HU #${n} «${story.title ?? ''}» — cumple el DoD. Cerrada. 🎉`,
          { kind: 'HANDOFF', storyNumber: n },
        );
        return;
      }

      // --- DoR: HU en el backlog → refinar si le faltan criterios ---
      if (!stateName.startsWith('prepara')) return; // ya salió del backlog
      if ((story.acceptanceCriteria ?? '').trim().length > 0) return; // ya está lista

      await opts.api.refineTask(opts.projectSlug, n); // IA server-side → persiste + publica story.refined
      await opts.api.comment(
        opts.projectSlug,
        n,
        `🤖 **PO**: refiné la HU — descripción y criterios de aceptación listos (Definition of Ready). Lista para asignar.`,
      );
      await narrate(
        opts.api,
        opts.projectSlug,
        `Refiné la HU #${n} «${story.title ?? ''}»: criterios de aceptación + descripción listos (DoR). SM, a asignar.`,
        { kind: 'HANDOFF', storyNumber: n },
      );
    },
  };
}
