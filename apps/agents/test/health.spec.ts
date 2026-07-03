import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Server } from 'node:http';
import { createHealthServer, type HealthState } from '../src/health.js';

let server: Server | null = null;

afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r));
  server = null;
});

function baseState(): HealthState {
  return { enabled: true, subscribed: true, eventsReceived: 3, eventsDispatched: 2, startedAt: 'x' };
}

async function listen(state: HealthState): Promise<number> {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  server = createHealthServer(state, 0);
  await new Promise((r) => server!.once('listening', r));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  return addr.port;
}

describe('createHealthServer', () => {
  it('sirve /health con el estado vivo del worker', async () => {
    const state = baseState();
    const port = await listen(state);
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, enabled: true, eventsReceived: 3 });

    // El estado es por referencia: los contadores se reflejan sin reiniciar.
    state.eventsReceived = 10;
    const res2 = await fetch(`http://127.0.0.1:${port}/health`);
    expect((await res2.json()).eventsReceived).toBe(10);
  });

  it('404 en cualquier otra ruta', async () => {
    const port = await listen(baseState());
    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(res.status).toBe(404);
  });
});
