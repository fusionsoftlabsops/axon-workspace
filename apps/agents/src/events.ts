/**
 * Contrato de eventos de dominio (lado consumidor). El productor es axon-web
 * (lib/agents/events.ts): canal único global, esquema versionado. El worker
 * valida cada mensaje y DESCARTA en silencio lo que no sea un v1 bien formado
 * — versiones futuras no deben tumbar el worker.
 */
import { z } from 'zod';

export const AGENT_EVENTS_CHANNEL = 'axon:agents:events:v1';

const stateRef = z.object({
  id: z.string(),
  name: z.string().optional(),
  category: z.string().optional(),
});

export const domainEventV1Schema = z.object({
  v: z.literal(1),
  type: z.enum(['story.created', 'story.state_changed', 'story.commented', 'story.refined', 'story.designed']),
  projectId: z.string().min(1),
  storyId: z.string().min(1),
  storyNumber: z.number().int().positive().optional(),
  fromState: stateRef.nullish(),
  toState: stateRef.nullish(),
  actorId: z.string().min(1),
  assigneeId: z.string().nullish(),
  payload: z.record(z.unknown()).optional(),
  ts: z.string(),
});

export type DomainEventV1 = z.infer<typeof domainEventV1Schema>;

/** Parsea un mensaje crudo del canal. null = descartar (malformado / otra versión). */
export function parseDomainEvent(raw: string): DomainEventV1 | null {
  try {
    const parsed = domainEventV1Schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
