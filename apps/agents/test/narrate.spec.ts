import { describe, it, expect, vi, beforeEach } from 'vitest';
import { narrate } from '../src/roles/narrate.js';
import type { AxonApi } from '../src/api/client.js';

function api(over: Partial<Record<string, unknown>> = {}): AxonApi {
  return {
    postTeamChat: vi.fn().mockResolvedValue({ message: { id: 'm1' } }),
    ...over,
  } as unknown as AxonApi;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('narrate', () => {
  it('posts to the team chat con kind STATUS por defecto', async () => {
    const a = api();
    await narrate(a, 'axon', 'Tomo la HU #24');
    expect(a.postTeamChat).toHaveBeenCalledWith('axon', { body: 'Tomo la HU #24', kind: 'STATUS', storyNumber: undefined });
  });

  it('respeta kind y storyNumber explícitos', async () => {
    const a = api();
    await narrate(a, 'axon', 'PR listo, te toca QA', { kind: 'HANDOFF', storyNumber: 24 });
    expect(a.postTeamChat).toHaveBeenCalledWith('axon', {
      body: 'PR listo, te toca QA',
      kind: 'HANDOFF',
      storyNumber: 24,
    });
  });

  it('nunca rompe el trabajo del rol si el post falla (best-effort)', async () => {
    const a = api({ postTeamChat: vi.fn().mockRejectedValue(new Error('red caída')) });
    await expect(narrate(a, 'axon', 'hola')).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('[agents] narrate falló:', 'red caída');
  });

  it('loguea el valor crudo cuando el fallo no es un Error', async () => {
    const a = api({ postTeamChat: vi.fn().mockRejectedValue('boom') });
    await narrate(a, 'axon', 'hola');
    expect(console.error).toHaveBeenCalledWith('[agents] narrate falló:', 'boom');
  });
});
