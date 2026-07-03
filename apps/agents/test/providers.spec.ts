import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOpenAiProvider } from '../src/runtime/providers/openai.js';
import { createAnthropicProvider } from '../src/runtime/providers/anthropic.js';
import type { ChatMessage, ToolDef } from '../src/runtime/types.js';

const fetchMock = vi.fn();
const realFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const TOOL: ToolDef = {
  name: 'get_task',
  description: 'lee una HU',
  inputSchema: { type: 'object', properties: { n: { type: 'number' } } },
  execute: async () => 'x',
};

const TRANSCRIPT: ChatMessage[] = [
  { role: 'user', content: 'implementa la HU 7' },
  { role: 'assistant', content: 'leo la HU', toolCalls: [{ id: 'c1', name: 'get_task', arguments: '{"n":7}' }] },
  { role: 'tool', content: '{"title":"HU 7"}', toolCallId: 'c1', toolName: 'get_task' },
];

describe('createOpenAiProvider (Qwen/vLLM)', () => {
  const provider = createOpenAiProvider({ baseUrl: 'https://modelo.local/v1/', apiKey: 'fsn_tok', model: 'qwen3' });

  it('traduce transcript y tools al formato chat/completions y parsea tool_calls', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: 'c2', function: { name: 'get_task', arguments: '{"n":8}' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 30 },
      }),
    );
    const res = await provider.complete({ system: 'sos el dev', messages: TRANSCRIPT, tools: [TOOL], maxOutputTokens: 900 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://modelo.local/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer fsn_tok');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('qwen3');
    expect(body.max_tokens).toBe(900);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sos el dev' });
    expect(body.messages[2]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_task', arguments: '{"n":7}' } }],
    });
    expect(body.messages[3]).toEqual({ role: 'tool', content: '{"title":"HU 7"}', tool_call_id: 'c1' });
    expect(body.tools[0]).toEqual({
      type: 'function',
      function: { name: 'get_task', description: 'lee una HU', parameters: TOOL.inputSchema },
    });

    expect(res.toolCalls).toEqual([{ id: 'c2', name: 'get_task', arguments: '{"n":8}' }]);
    expect(res.usage).toEqual({ promptTokens: 120, completionTokens: 30 });
    expect(res.stopReason).toBe('tool_calls');
  });

  it('mapea stop/length y omite tools cuando no hay', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: 'fin' }, finish_reason: 'length' }] }),
    );
    const res = await provider.complete({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] });
    expect(res).toMatchObject({ content: 'fin', stopReason: 'length', usage: { promptTokens: 0 } });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).not.toHaveProperty('tools');
  });

  it('lanza error descriptivo en non-200 y en respuesta sin choices', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'boom' }, 500));
    await expect(provider.complete({ system: 's', messages: [], tools: [] })).rejects.toThrow('openai-provider 500');
    fetchMock.mockResolvedValue(jsonResponse({ choices: [] }));
    await expect(provider.complete({ system: 's', messages: [], tools: [] })).rejects.toThrow('sin choices');
  });
});

describe('createAnthropicProvider (Claude)', () => {
  const provider = createAnthropicProvider({ apiKey: 'sk-ant-x', model: 'claude-sonnet-4-6' });

  it('traduce transcript (tool_use/tool_result agrupado) y parsea bloques', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        content: [
          { type: 'text', text: 'reviso' },
          { type: 'tool_use', id: 'tu1', name: 'get_task', input: { n: 9 } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 200, output_tokens: 40 },
      }),
    );
    const res = await provider.complete({ system: 'sos el SM', messages: TRANSCRIPT, tools: [TOOL] });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-x');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe('sos el SM');
    expect(body.tools[0]).toEqual({ name: 'get_task', description: 'lee una HU', input_schema: TOOL.inputSchema });
    // assistant → bloques text + tool_use; tool → user con tool_result
    expect(body.messages[1].content).toEqual([
      { type: 'text', text: 'leo la HU' },
      { type: 'tool_use', id: 'c1', name: 'get_task', input: { n: 7 } },
    ]);
    expect(body.messages[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"title":"HU 7"}' }],
    });

    expect(res.content).toBe('reviso');
    expect(res.toolCalls).toEqual([{ id: 'tu1', name: 'get_task', arguments: '{"n":9}' }]);
    expect(res.usage).toEqual({ promptTokens: 200, completionTokens: 40 });
    expect(res.stopReason).toBe('tool_calls');
  });

  it('agrupa tool_results consecutivos en un solo mensaje user', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }));
    const messages: ChatMessage[] = [
      { role: 'user', content: 'x' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'a', name: 't1', arguments: '{}' },
          { id: 'b', name: 't2', arguments: '{malformado' },
        ],
      },
      { role: 'tool', content: 'r1', toolCallId: 'a', toolName: 't1' },
      { role: 'tool', content: 'r2', toolCallId: 'b', toolName: 't2' },
    ];
    await provider.complete({ system: 's', messages, tools: [] });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.messages).toHaveLength(3); // user, assistant, user(tool_results agrupados)
    expect(body.messages[2].content).toHaveLength(2);
    expect(body.messages[2].content.map((b: { tool_use_id: string }) => b.tool_use_id)).toEqual(['a', 'b']);
    // args malformados no revientan la traducción: van como _raw
    expect(body.messages[1].content[1].input).toEqual({ _raw: '{malformado' });
  });

  it('mapea end_turn/max_tokens y lanza en non-200', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'fin' }], stop_reason: 'max_tokens' }));
    const res = await provider.complete({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] });
    expect(res.stopReason).toBe('length');

    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, 429));
    await expect(provider.complete({ system: 's', messages: [], tools: [] })).rejects.toThrow('anthropic-provider 429');
  });
});
