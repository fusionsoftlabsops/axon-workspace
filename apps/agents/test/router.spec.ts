import { describe, it, expect, vi } from 'vitest';
import { EventRouter, type RoleHandler } from '../src/router.js';
import type { DomainEventV1 } from '../src/events.js';

const EVT: DomainEventV1 = {
  v: 1,
  type: 'story.state_changed',
  projectId: 'p1',
  storyId: 't1',
  actorId: 'u1',
  ts: 'now',
};

function handler(over: Partial<RoleHandler> = {}): RoleHandler {
  return {
    role: 'SM',
    matches: () => true,
    handle: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('EventRouter', () => {
  it('despacha solo a los handlers que hacen match', async () => {
    const router = new EventRouter();
    const sm = handler({ role: 'SM' });
    const dev = handler({ role: 'DEV', matches: () => false });
    router.register(sm);
    router.register(dev);
    const results = await router.dispatch(EVT);
    expect(results).toEqual([{ role: 'SM', ok: true }]);
    expect(sm.handle).toHaveBeenCalledWith(EVT);
    expect(dev.handle).not.toHaveBeenCalled();
  });

  it('aísla errores: un handler que truena no bloquea a los demás', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const router = new EventRouter();
    router.register(handler({ role: 'SM', handle: vi.fn().mockRejectedValue(new Error('boom')) }));
    const qa = handler({ role: 'QA' });
    router.register(qa);
    const results = await router.dispatch(EVT);
    expect(results).toEqual([
      { role: 'SM', ok: false, error: 'boom' },
      { role: 'QA', ok: true },
    ]);
    expect(qa.handle).toHaveBeenCalled();
    err.mockRestore();
  });

  it('un matches() que truena cuenta como no interesado', async () => {
    const router = new EventRouter();
    const h = handler({
      matches: () => {
        throw new Error('bad matcher');
      },
    });
    router.register(h);
    expect(await router.dispatch(EVT)).toEqual([]);
    expect(h.handle).not.toHaveBeenCalled();
  });

  it('expone el número de handlers registrados', () => {
    const router = new EventRouter();
    expect(router.size).toBe(0);
    router.register(handler());
    expect(router.size).toBe(1);
  });
});
