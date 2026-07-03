import { describe, it, expect, vi, beforeEach } from 'vitest';

const redisMock = vi.hoisted(() => {
  const instances: FakeRedis[] = [];
  class FakeRedis {
    handlers = new Map<string, (...args: string[]) => void>();
    subscribe = vi.fn().mockResolvedValue(1);
    quit = vi.fn().mockResolvedValue('OK');
    disconnect = vi.fn();
    constructor(
      public url: string,
      public opts: Record<string, unknown>,
    ) {
      instances.push(this);
    }
    on(event: string, cb: (...args: string[]) => void) {
      this.handlers.set(event, cb);
      return this;
    }
    emit(event: string, ...args: string[]) {
      this.handlers.get(event)?.(...args);
    }
  }
  return { FakeRedis, instances };
});

vi.mock('ioredis', () => ({ Redis: redisMock.FakeRedis }));

import { subscribeToDomainEvents } from '../src/subscribe.js';

const VALID = JSON.stringify({
  v: 1,
  type: 'story.created',
  projectId: 'p1',
  storyId: 't1',
  actorId: 'u1',
  ts: 'now',
});

beforeEach(() => {
  redisMock.instances.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('subscribeToDomainEvents', () => {
  it('se suscribe al canal y entrega eventos v1 parseados', async () => {
    const onEvent = vi.fn().mockResolvedValue(undefined);
    await subscribeToDomainEvents('redis://x', onEvent);
    const sub = redisMock.instances[0]!;
    expect(sub.subscribe).toHaveBeenCalledWith('axon:agents:events:v1');

    sub.emit('message', 'axon:agents:events:v1', VALID);
    await new Promise((r) => setTimeout(r, 0));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'story.created' }));
  });

  it('ignora otros canales y mensajes malformados', async () => {
    const onEvent = vi.fn();
    await subscribeToDomainEvents('redis://x', onEvent);
    const sub = redisMock.instances[0]!;
    sub.emit('message', 'otro:canal', VALID);
    sub.emit('message', 'axon:agents:events:v1', '{malformado');
    sub.emit('message', 'axon:agents:events:v1', JSON.stringify({ v: 2 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('un onEvent que truena no revienta el listener', async () => {
    const onEvent = vi.fn().mockRejectedValue(new Error('handler down'));
    await subscribeToDomainEvents('redis://x', onEvent);
    const sub = redisMock.instances[0]!;
    expect(() => sub.emit('message', 'axon:agents:events:v1', VALID)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('close() hace quit y cae a disconnect si quit falla', async () => {
    const s1 = await subscribeToDomainEvents('redis://x', vi.fn());
    await s1.close();
    expect(redisMock.instances[0]!.quit).toHaveBeenCalled();

    const s2 = await subscribeToDomainEvents('redis://x', vi.fn());
    redisMock.instances[1]!.quit.mockRejectedValue(new Error('gone'));
    await s2.close();
    expect(redisMock.instances[1]!.disconnect).toHaveBeenCalled();
  });
});
