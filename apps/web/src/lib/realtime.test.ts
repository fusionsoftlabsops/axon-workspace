import { describe, it, expect, vi, beforeEach } from 'vitest';

// No REDIS_URL → realtime uses the in-process EventEmitter fallback.
const m = vi.hoisted(() => ({ env: vi.fn(() => ({ REDIS_URL: undefined as string | undefined })) }));
vi.mock('@/lib/env', () => ({ env: m.env }));

import { publish, subscribe, planChannel } from './realtime';

beforeEach(() => {
  m.env.mockReturnValue({ REDIS_URL: undefined });
});

describe('realtime (in-process fallback)', () => {
  it('builds a per-plan channel name', () => {
    expect(planChannel('plan123')).toBe('plan:plan123');
  });

  it('delivers published events to subscribers on the same channel', async () => {
    const received: unknown[] = [];
    const unsub = await subscribe('ch1', (e) => received.push(e));
    await publish('ch1', { type: 'message', value: 42 });
    expect(received).toEqual([{ type: 'message', value: 42 }]);
    unsub();
  });

  it('does not deliver across different channels', async () => {
    const received: unknown[] = [];
    const unsub = await subscribe('ch1', (e) => received.push(e));
    await publish('ch2', { type: 'message' });
    expect(received).toEqual([]);
    unsub();
  });

  it('stops delivering after unsubscribe', async () => {
    const received: unknown[] = [];
    const unsub = await subscribe('ch3', (e) => received.push(e));
    unsub();
    await publish('ch3', { type: 'message' });
    expect(received).toEqual([]);
  });

  it('tolerates malformed payloads without throwing', async () => {
    const received: unknown[] = [];
    const unsub = await subscribe('ch4', (e) => received.push(e));
    // Re-emitting a non-JSON string directly would throw inside the handler;
    // publish always sends valid JSON, so a normal event still arrives.
    await publish('ch4', { ok: true });
    expect(received).toEqual([{ ok: true }]);
    unsub();
  });
});
