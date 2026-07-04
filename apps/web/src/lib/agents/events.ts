/**
 * Eventos de dominio de la plataforma agéntica (v1).
 *
 * axon-web publica un evento en Redis (axon-redis) cada vez que una HU se
 * crea, cambia de estado o recibe un comentario; el worker axon-agents se
 * suscribe al canal y enruta cada evento a los handlers de rol (SM/Dev/QA).
 *
 * Reglas de diseño:
 * - Opt-in: sin AGENT_EVENTS_ENABLED no se publica nada (la feature se
 *   despliega oscura, disciplina del repo).
 * - Best-effort y fire-and-forget: publicar jamás puede hacer fallar la
 *   mutación del usuario. Los errores se loguean y se descartan.
 * - Llamar SIEMPRE después del commit de la transacción: un evento nunca debe
 *   filtrar estado no confirmado (el worker leería una HU que no existe).
 * - Esquema versionado: los consumidores filtran por `v === 1` y pueden
 *   ignorar campos desconocidos de versiones futuras.
 */
import { publish } from '@/lib/realtime';
import { env } from '@/lib/env';

/** Canal único global: el worker se suscribe una vez y filtra por proyecto. */
export const AGENT_EVENTS_CHANNEL = 'axon:agents:events:v1';

/** Snapshot mínimo de un estado del workflow (name/category cuando el punto de
 *  emisión ya los tiene cargados — evita round-trips del worker). */
export interface StoryStateRef {
  id: string;
  name?: string;
  category?: string;
}

export type DomainEventType =
  | 'story.created'
  | 'story.state_changed'
  | 'story.commented'
  | 'story.refined' // el PO terminó de refinar la HU (criterios/DoR listos) → el SM puede asignar
  | 'story.designed'; // Aria terminó el spec de diseño de una HU de UI → el SM puede asignar

export interface DomainEventV1 {
  v: 1;
  type: DomainEventType;
  projectId: string;
  storyId: string;
  storyNumber?: number;
  fromState?: StoryStateRef | null;
  toState?: StoryStateRef | null;
  actorId: string;
  assigneeId?: string | null;
  payload?: Record<string, unknown>;
  ts: string;
}

export function agentEventsEnabled(): boolean {
  try {
    const v = env().AGENT_EVENTS_ENABLED?.toLowerCase();
    return v === '1' || v === 'true' || v === 'on';
  } catch {
    return false;
  }
}

/**
 * Publica un evento de dominio (fire-and-forget, best-effort). Invocar
 * únicamente DESPUÉS del commit de la transacción que originó el cambio.
 */
export function publishDomainEvent(evt: Omit<DomainEventV1, 'v' | 'ts'>): void {
  if (!agentEventsEnabled()) return;
  const full: DomainEventV1 = { ...evt, v: 1, ts: new Date().toISOString() };
  void publish(AGENT_EVENTS_CHANNEL, full as unknown as Record<string, unknown>).catch((e) => {
    console.error('[agents] domain event publish failed:', e instanceof Error ? e.message : e);
  });
}
