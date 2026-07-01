/**
 * Lightweight realtime pub/sub for collaborative plan chat (live messages,
 * typing indicators, presence). Backed by Redis when REDIS_URL is set so it
 * works across replicas; otherwise it degrades to an in-process EventEmitter
 * (correct for a single replica — the SSE route and the publishing server
 * action run in the same Node process).
 *
 * ioredis is imported lazily so the dependency is only loaded when Redis is
 * actually configured.
 */
import { EventEmitter } from 'node:events';
import type { Redis } from 'ioredis';
import { env } from '@/lib/env';

export type RealtimeEvent = Record<string, unknown>;

/** Channel name for a plan's collaborative chat. */
export function planChannel(planId: string): string {
  return `plan:${planId}`;
}

// In-process bus (fallback / single-replica). No listener cap — many concurrent
// SSE streams may subscribe to the same channel.
const local = new EventEmitter();
local.setMaxListeners(0);

function redisUrl(): string | undefined {
  try {
    return env().REDIS_URL;
  } catch {
    return undefined;
  }
}

let pubClient: Redis | null | undefined;

async function getPublisher(): Promise<Redis | null> {
  if (pubClient !== undefined) return pubClient;
  const url = redisUrl();
  if (!url) {
    pubClient = null;
    return null;
  }
  const { default: Redis } = await import('ioredis');
  const client = new Redis(url, { maxRetriesPerRequest: null });
  client.on('error', (e: Error) => console.error('[realtime] redis pub error:', e.message));
  pubClient = client;
  return client;
}

/** Broadcast an event to everyone subscribed to `channel`. Best-effort. */
export async function publish(channel: string, event: RealtimeEvent): Promise<void> {
  const payload = JSON.stringify(event);
  const pub = await getPublisher();
  if (pub) {
    try {
      await pub.publish(channel, payload);
      return;
    } catch (e) {
      console.error('[realtime] publish failed, using local bus:', e instanceof Error ? e.message : e);
    }
  }
  local.emit(channel, payload);
}

/**
 * Subscribe to `channel`. Returns an async unsubscribe function. With Redis, a
 * dedicated subscriber connection is opened per subscription (required: a
 * subscriber connection can't issue normal commands) and closed on unsubscribe.
 */
export async function subscribe(
  channel: string,
  onEvent: (event: RealtimeEvent) => void,
): Promise<() => void> {
  const url = redisUrl();
  if (url) {
    const { default: Redis } = await import('ioredis');
    const sub = new Redis(url, { maxRetriesPerRequest: null });
    sub.on('error', (e: Error) => console.error('[realtime] redis sub error:', e.message));
    const handler = (ch: string, msg: string) => {
      if (ch !== channel) return;
      try {
        onEvent(JSON.parse(msg) as RealtimeEvent);
      } catch {
        /* ignore malformed payloads */
      }
    };
    sub.on('message', handler);
    await sub.subscribe(channel);
    return () => {
      sub.removeListener('message', handler);
      void sub.quit().catch(() => {});
    };
  }

  const handler = (msg: string) => {
    try {
      onEvent(JSON.parse(msg) as RealtimeEvent);
    } catch {
      /* ignore */
    }
  };
  local.on(channel, handler);
  return () => {
    local.removeListener(channel, handler);
  };
}
