/**
 * Rol Arquitecto / Tech Lead (agente Dax).
 *
 * Cuando una HU se refina (DoR) y parece COMPLEJA, Dax genera un diseño técnico
 * de alto nivel (arquitectura + decisiones + riesgos + descomposición, vía IA
 * server-side) ANTES de que el Dev implemente, y lo deja en `techDesign` + un
 * comentario. El Dev lo usa como guía (su impl-plan lo incorpora).
 *
 * ADVISORY: Dax NO gatea el flujo (para no sumar otro gate). Corre rápido (una
 * llamada), normalmente antes de que el Dev clone; si no llega, el Dev procede
 * igual. Determinista (la IA vive server-side). Solo actúa en HUs complejas.
 */
import type { AxonApi } from '../api/client.js';
import type { DomainEventV1 } from '../events.js';
import type { RoleHandler } from '../router.js';
import { looksComplex } from '../ui-story.js';
import { narrate } from './narrate.js';

export interface ArchitectOptions {
  api: AxonApi;
  projectId: string;
  projectSlug: string;
  meCacheMs?: number;
}

export function createArchitectHandler(opts: ArchitectOptions): RoleHandler {
  let meCache: { enabled: boolean; at: number } | null = null;
  const meCacheMs = opts.meCacheMs ?? 60_000;

  async function architectEnabled(): Promise<boolean> {
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
    role: 'ARCHITECT',
    matches(event: DomainEventV1): boolean {
      if (event.projectId !== opts.projectId || !event.storyNumber) return false;
      // Tras el refinamiento del PO (criterios/prioridad listos) evaluamos complejidad.
      return event.type === 'story.refined' || event.type === 'story.created';
    },

    async handle(event: DomainEventV1): Promise<void> {
      if (!(await architectEnabled())) return;
      const n = event.storyNumber!;
      const story = (await opts.api.getTask(opts.projectSlug, n)) as {
        state?: string;
        title?: string;
        description?: string;
        acceptanceCriteria?: string;
        priority?: string;
        techDesign?: string | null;
      };
      const stateName = (story.state ?? '').toLowerCase();

      if (!stateName.startsWith('prepara')) return; // ya salió del backlog
      if ((story.techDesign ?? '').trim().length > 0) return; // ya tiene diseño técnico
      if ((story.acceptanceCriteria ?? '').trim().length === 0) return; // esperar al PO (DoR)
      if (!looksComplex(story)) return; // HU no compleja → no amerita diseño técnico

      await opts.api.techDesign(opts.projectSlug, n); // IA server-side → persiste techDesign
      await opts.api.comment(
        opts.projectSlug,
        n,
        `🏛️ **Arquitecto**: dejé el diseño técnico (enfoque de arquitectura + decisiones + riesgos + descomposición) para guiar la implementación.`,
      );
      await narrate(
        opts.api,
        opts.projectSlug,
        `La HU #${n} «${story.title ?? ''}» es compleja: dejé el diseño técnico (arquitectura + descomposición) para el Dev.`,
        { kind: 'STATUS', storyNumber: n },
      );
    },
  };
}
