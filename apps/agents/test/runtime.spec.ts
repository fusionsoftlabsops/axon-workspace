import { describe, it, expect, vi } from 'vitest';
import { runAgentLoop } from '../src/runtime/runtime.js';
import type { CompletionResult, LlmProvider, ToolDef } from '../src/runtime/types.js';

function completion(over: Partial<CompletionResult> = {}): CompletionResult {
  return {
    content: '',
    toolCalls: [],
    usage: { promptTokens: 100, completionTokens: 50 },
    stopReason: 'stop',
    ...over,
  };
}

/** Provider fake que reproduce un guion de respuestas en orden. */
function scripted(...responses: CompletionResult[]): LlmProvider {
  let i = 0;
  return {
    complete: vi.fn(async () => {
      const r = responses[Math.min(i, responses.length - 1)]!;
      i += 1;
      return r;
    }),
  };
}

function tool(over: Partial<ToolDef> = {}): ToolDef {
  return {
    name: 'get_task',
    description: 'lee una HU',
    inputSchema: { type: 'object' },
    execute: vi.fn().mockResolvedValue('{"title":"HU"}'),
    ...over,
  };
}

const CALL = { id: 'c1', name: 'get_task', arguments: '{"n":7}' };

describe('runAgentLoop', () => {
  it('completa en una pasada cuando el modelo no pide tools', async () => {
    const res = await runAgentLoop('meta', {
      provider: scripted(completion({ content: 'listo' })),
      system: 's',
      tools: [],
    });
    expect(res).toMatchObject({ finalText: 'listo', stopped: 'completed', iterations: 1 });
    expect(res.usage).toEqual({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
  });

  it('ejecuta el ciclo tool_call→tool_result→modelo y arma el transcript', async () => {
    const t = tool();
    const provider = scripted(
      completion({ content: 'voy a leer la HU', toolCalls: [CALL], stopReason: 'tool_calls' }),
      completion({ content: 'hecho' }),
    );
    const res = await runAgentLoop('meta', { provider, system: 's', tools: [t] });
    expect(res.stopped).toBe('completed');
    expect(res.iterations).toBe(2);
    expect(t.execute).toHaveBeenCalledWith({ n: 7 });
    const roles = res.transcript.map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant']);
    const toolMsg = res.transcript[2]!;
    expect(toolMsg).toMatchObject({ role: 'tool', content: '{"title":"HU"}', toolCallId: 'c1' });
    // La segunda llamada al provider recibe el transcript con el tool_result
    // (misma referencia que muta después: se validan los 3 primeros mensajes).
    const secondCall = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[1]![0];
    expect(secondCall.messages.slice(0, 3).map((m: { role: string }) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
    ]);
  });

  it('los errores de tool vuelven al modelo como tool_result ERROR (no revientan)', async () => {
    const t = tool({ execute: vi.fn().mockRejectedValue(new Error('api caida')) });
    const res = await runAgentLoop('meta', {
      provider: scripted(
        completion({ toolCalls: [CALL], stopReason: 'tool_calls' }),
        completion({ content: 'me recupero' }),
      ),
      system: 's',
      tools: [t],
    });
    expect(res.stopped).toBe('completed');
    expect(res.transcript[2]!.content).toBe('ERROR: api caida');
  });

  it('tool desconocida y argumentos malformados devuelven ERROR descriptivo', async () => {
    const res = await runAgentLoop('meta', {
      provider: scripted(
        completion({
          toolCalls: [
            { id: 'a', name: 'nope', arguments: '{}' },
            { id: 'b', name: 'get_task', arguments: '{rotos' },
          ],
          stopReason: 'tool_calls',
        }),
        completion({ content: 'fin' }),
      ),
      system: 's',
      tools: [tool()],
    });
    expect(res.transcript[2]!.content).toContain('tool desconocida');
    expect(res.transcript[3]!.content).toContain('no son JSON válido');
  });

  it('corta por max_iterations ante un modelo que nunca termina', async () => {
    const res = await runAgentLoop('meta', {
      provider: scripted(completion({ content: 'sigo', toolCalls: [CALL], stopReason: 'tool_calls' })),
      system: 's',
      tools: [tool()],
      maxIterations: 3,
    });
    expect(res.stopped).toBe('max_iterations');
    expect(res.iterations).toBe(3);
    expect(res.finalText).toBe('sigo');
  });

  it('corta por presupuesto de tokens (corte duro acumulado)', async () => {
    const onIteration = vi.fn();
    const res = await runAgentLoop('meta', {
      provider: scripted(completion({ toolCalls: [CALL], stopReason: 'tool_calls' })),
      system: 's',
      tools: [tool()],
      maxTotalTokens: 250,
      onIteration,
    });
    // 150 tokens/iteración → en la 2ª (300 ≥ 250) corta.
    expect(res.stopped).toBe('budget_exceeded');
    expect(res.iterations).toBe(2);
    expect(res.usage.totalTokens).toBe(300);
    expect(onIteration).toHaveBeenCalledTimes(2);
  });

  it('propaga el truncamiento del proveedor como stopped=truncated', async () => {
    const res = await runAgentLoop('meta', {
      provider: scripted(completion({ content: 'a medias', stopReason: 'length' })),
      system: 's',
      tools: [],
    });
    expect(res.stopped).toBe('truncated');
    expect(res.finalText).toBe('a medias');
  });

  it('argumentos vacíos se tratan como {}', async () => {
    const t = tool();
    await runAgentLoop('meta', {
      provider: scripted(
        completion({ toolCalls: [{ id: 'x', name: 'get_task', arguments: '' }], stopReason: 'tool_calls' }),
        completion({ content: 'fin' }),
      ),
      system: 's',
      tools: [t],
    });
    expect(t.execute).toHaveBeenCalledWith({});
  });
});
