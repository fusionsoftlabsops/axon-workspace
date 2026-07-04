/**
 * Rol Diseño (agente Aria).
 *
 * Especialista pre-Dev: cuando una HU de UI ya está refinada (criterios listos,
 * DoR) pero aún sin diseño, Aria genera el spec de diseño (notas implementables
 * + un mockup de concepto con gpt-image-1, vía IA server-side en el endpoint
 * `/design`). Eso persiste `designSpec` y dispara `story.designed` → el SM la
 * asigna al Dev, que implementa contra el diseño.
 *
 * Determinista (la IA vive server-side). Solo actúa sobre HUs que parecen de UI
 * (heurística `looksLikeUi`); las de backend pasan de largo.
 */
import type { AxonApi } from '../api/client.js';
import type { DomainEventV1 } from '../events.js';
import type { RoleHandler } from '../router.js';
import { looksLikeUi } from '../ui-story.js';
import { narrate } from './narrate.js';

export interface DesignOptions {
  api: AxonApi;
  projectId: string;
  projectSlug: string;
  meCacheMs?: number;
}

export function createDesignHandler(opts: DesignOptions): RoleHandler {
  let meCache: { enabled: boolean; at: number } | null = null;
  const meCacheMs = opts.meCacheMs ?? 60_000;

  async function designEnabled(): Promise<boolean> {
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
    role: 'DESIGN',
    matches(event: DomainEventV1): boolean {
      if (event.projectId !== opts.projectId || !event.storyNumber) return false;
      // story.refined = el PO dejó criterios listos → candidato a diseñar.
      // story.created = por si la HU ya vino con criterios (skip-PO).
      if (event.type === 'story.refined' || event.type === 'story.created') return true;
      if (event.type === 'story.state_changed') return event.toState?.category === 'TODO';
      return false;
    },

    async handle(event: DomainEventV1): Promise<void> {
      if (!(await designEnabled())) return;
      const n = event.storyNumber!;
      const story = (await opts.api.getTask(opts.projectSlug, n)) as {
        state?: string;
        title?: string;
        description?: string;
        category?: string | null;
        acceptanceCriteria?: string;
        designSpec?: string | null;
      };
      const stateName = (story.state ?? '').toLowerCase();

      if (!stateName.startsWith('prepara')) return; // ya salió del backlog
      if ((story.designSpec ?? '').trim().length > 0) return; // ya tiene diseño
      if ((story.acceptanceCriteria ?? '').trim().length === 0) return; // esperar al PO (DoR)
      if (!looksLikeUi(story)) return; // no es de UI → el SM la asigna directo

      await opts.api.designTask(opts.projectSlug, n); // IA server-side → persiste designSpec + publica story.designed
      await opts.api.comment(
        opts.projectSlug,
        n,
        `🎨 **Diseño**: preparé el spec de diseño (notas de UI/UX + mockup de concepto). Lista para desarrollar contra el diseño.`,
      );
      await narrate(
        opts.api,
        opts.projectSlug,
        `Diseñé la HU #${n} «${story.title ?? ''}»: notas de UI + mockup listos. SM, a asignar al Dev.`,
        { kind: 'HANDOFF', storyNumber: n },
      );
    },
  };
}
