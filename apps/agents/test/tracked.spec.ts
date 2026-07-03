import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runTrackedLoop } from '../src/runtime/tracked.js';
import type { AxonApi } from '../src/api/client.js';
import type { CompletionResult, LlmProvider } from '../src/runtime/types.js';

function completion(over: Partial<CompletionResult> = {}): CompletionResult {
  return {
    content: 'listo',
    toolCalls: [],
    usage: { promptTokens: 1000, completionTokens: 500 },
    stopReason: 'stop',
    ...over,
  };
}

function api(over: Partial<Record<keyof AxonApi, unknown>> = {}): AxonApi {
  return {
    openRun: vi.fn().mockResolvedValue({ id: 'run1', tokenBudget: 10_000 }),
    finishRun: vi.fn().mockResolvedValue({ ok: true }),
    ...over,
  } as unknown as AxonApi;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('runTrackedLoop', () => {
  it('abre el run, corre con el presupuesto del Agent y cierra SUCCEEDED con costo', async () => {
    const a = api();
    const provider: LlmProvider = { complete: vi.fn().mockResolvedValue(completion()) };
    const res = await runTrackedLoop('meta', {
      api: a,
      projectSlug: 'axon',
      storyId: 't1',
      payload: { via: 'test' },
      provider,
      system: 's',
      tools: [],
      usdPerMTok: 10,
    });
    expect(a.openRun).toHaveBeenCalledWith('axon', { storyId: 't1', payload: { via: 'test' } });
    expect(res).toMatchObject({ runId: 'run1', status: 'SUCCEEDED', stopped: 'completed' });
    expect(a.finishRun).toHaveBeenCalledWith('axon', 'run1', {
      status: 'SUCCEEDED',
      promptTokens: 1000,
      completionTokens: 500,
      costUsd: (1500 / 1_000_000) * 10,
    });
  });

  it('el presupuesto del run (tokenBudget del Agent) corta la corrida en seco', async () => {
    const a = api({ openRun: vi.fn().mockResolvedValue({ id: 'run2', tokenBudget: 1200 }) });
    const provider: LlmProvider = {
      complete: vi
        .fn()
        .mockResolvedValue(completion({ toolCalls: [{ id: 'c', name: 'x', arguments: '{}' }], stopReason: 'tool_calls' })),
    };
    const res = await runTrackedLoop('meta', {
      api: a,
      projectSlug: 'axon',
      provider,
      system: 's',
      tools: [{ name: 'x', description: '', inputSchema: {}, execute: async () => 'ok' }],
    });
    expect(res.status).toBe('BUDGET_EXCEEDED');
    expect(res.iterations).toBe(1); // 1500 ≥ 1200 en la primera iteración
    expect(a.finishRun).toHaveBeenCalledWith(
      'axon',
      'run2',
      expect.objectContaining({ status: 'BUDGET_EXCEEDED', error: expect.stringContaining('budget_exceeded') }),
    );
  });

  it('cierra FAILED y re-lanza cuando el proveedor revienta', async () => {
    const a = api();
    const provider: LlmProvider = { complete: vi.fn().mockRejectedValue(new Error('modelo caido')) };
    await expect(
      runTrackedLoop('meta', { api: a, projectSlug: 'axon', provider, system: 's', tools: [] }),
    ).rejects.toThrow('modelo caido');
    expect(a.finishRun).toHaveBeenCalledWith(
      'axon',
      'run1',
      expect.objectContaining({ status: 'FAILED', error: 'modelo caido' }),
    );
  });

  it('si cerrar el run falla, no rompe el resultado (best-effort logueado)', async () => {
    const a = api({ finishRun: vi.fn().mockRejectedValue(new Error('api caida')) });
    const provider: LlmProvider = { complete: vi.fn().mockResolvedValue(completion()) };
    const res = await runTrackedLoop('meta', { api: a, projectSlug: 'axon', provider, system: 's', tools: [] });
    expect(res.status).toBe('SUCCEEDED');
  });

  it('sin usdPerMTok el costo es 0 (modelo propio)', async () => {
    const a = api();
    const provider: LlmProvider = { complete: vi.fn().mockResolvedValue(completion()) };
    await runTrackedLoop('meta', { api: a, projectSlug: 'axon', provider, system: 's', tools: [] });
    expect(a.finishRun).toHaveBeenCalledWith('axon', 'run1', expect.objectContaining({ costUsd: 0 }));
  });
});
