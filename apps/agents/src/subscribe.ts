/**
 * Suscripción Redis del worker: una conexión dedicada al canal de eventos
 * (una conexión en modo subscriber no puede ejecutar otros comandos). ioredis
 * reconecta solo; los mensajes malformados se descartan sin ruido.
 */
import { Redis } from 'ioredis';
import { AGENT_EVENTS_CHANNEL, parseDomainEvent, type DomainEventV1 } from './events.js';

export interface Subscription {
  close(): Promise<void>;
}

export async function subscribeToDomainEvents(
  redisUrl: string,
  onEvent: (event: DomainEventV1) => Promise<void>,
  channel: string = AGENT_EVENTS_CHANNEL,
): Promise<Subscription> {
  const sub = new Redis(redisUrl, { maxRetriesPerRequest: null });
  sub.on('error', (e: Error) => console.error('[agents] redis sub error:', e.message));

  sub.on('message', (ch: string, raw: string) => {
    if (ch !== channel) return;
    const event = parseDomainEvent(raw);
    if (!event) return;
    // Serializa el procesamiento por evento pero nunca revienta el listener.
    void onEvent(event).catch((err) => {
      console.error('[agents] event processing failed:', err instanceof Error ? err.message : err);
    });
  });

  await sub.subscribe(channel);
  console.log(`[agents] subscribed to ${channel}`);

  return {
    close: async () => {
      try {
        await sub.quit();
      } catch {
        sub.disconnect();
      }
    },
  };
}
