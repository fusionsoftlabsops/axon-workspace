/**
 * Rol Branding / SEO / Marketing (agente Sol).
 *
 * Para HUs de go-to-market (landing, SEO, branding, lanzamiento) genera un kit de
 * marketing (copy + SEO + social, vía IA server-side) + un asset de marca/hero
 * (gpt-image-1) y lo deja en `marketingKit` + un comentario. ADVISORY: no gatea
 * el flujo. Determinista (la IA vive server-side). Solo actúa en HUs de marketing.
 */
import type { AxonApi } from '../api/client.js';
import type { DomainEventV1 } from '../events.js';
import type { RoleHandler } from '../router.js';
import { looksLikeMarketing } from '../ui-story.js';
import { narrate } from './narrate.js';

export interface MarketingOptions {
  api: AxonApi;
  projectId: string;
  projectSlug: string;
  meCacheMs?: number;
}

export function createMarketingHandler(opts: MarketingOptions): RoleHandler {
  let meCache: { enabled: boolean; at: number } | null = null;
  const meCacheMs = opts.meCacheMs ?? 60_000;

  async function marketingEnabled(): Promise<boolean> {
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
    role: 'MARKETING',
    matches(event: DomainEventV1): boolean {
      if (event.projectId !== opts.projectId || !event.storyNumber) return false;
      return event.type === 'story.refined' || event.type === 'story.created';
    },

    async handle(event: DomainEventV1): Promise<void> {
      if (!(await marketingEnabled())) return;
      const n = event.storyNumber!;
      const story = (await opts.api.getTask(opts.projectSlug, n)) as {
        state?: string;
        title?: string;
        description?: string;
        category?: string | null;
        acceptanceCriteria?: string;
        marketingKit?: string | null;
      };
      const stateName = (story.state ?? '').toLowerCase();

      if (!stateName.startsWith('prepara')) return; // ya salió del backlog
      if ((story.marketingKit ?? '').trim().length > 0) return; // ya tiene kit
      if ((story.acceptanceCriteria ?? '').trim().length === 0) return; // esperar al PO (DoR)
      if (!looksLikeMarketing(story)) return; // no es de marketing

      await opts.api.marketingKit(opts.projectSlug, n); // IA server-side → persiste marketingKit
      await opts.api.comment(
        opts.projectSlug,
        n,
        `📣 **Branding**: preparé el kit de marketing (copy de landing + SEO + social + asset de marca) para el lanzamiento.`,
      );
      await narrate(
        opts.api,
        opts.projectSlug,
        `La HU #${n} «${story.title ?? ''}» es de go-to-market: dejé el kit de marketing (copy + SEO + asset).`,
        { kind: 'STATUS', storyNumber: n },
      );
    },
  };
}
