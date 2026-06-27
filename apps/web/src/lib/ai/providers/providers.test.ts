import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- SDK mocks (shared spies) ----
const anthropicCreate = vi.fn();
const anthropicCtor = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = { create: anthropicCreate };
    constructor(opts: unknown) {
      anthropicCtor(opts);
    }
  },
}));

const googleStream = vi.fn();
const googleCtor = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContentStream: googleStream };
    constructor(opts: unknown) {
      googleCtor(opts);
    }
  },
}));

const openaiCreate = vi.fn();
const openaiCtor = vi.fn();
vi.mock('openai', () => ({
  default: class OpenAI {
    chat = { completions: { create: openaiCreate } };
    constructor(opts: unknown) {
      openaiCtor(opts);
    }
  },
}));

import { AnthropicProvider } from './anthropic';
import { GoogleProvider } from './google';
import { OpenAIProvider, createOpenAIProvider } from './openai';
import { MoonshotProvider } from './moonshot';
import { getProvider, listProviders, defaultModelFor, estimateTokenCount } from './registry';
import type { ChatChunk } from './types';

async function* gen<T>(items: T[]): AsyncIterable<T> {
  for (const i of items) yield i;
}

async function collect(it: AsyncIterable<ChatChunk>): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('estimateTokenCount', () => {
  it('uses 4 chars/token prose and 6 chars/token code', () => {
    expect(estimateTokenCount('a'.repeat(12))).toBe(3);
    expect(estimateTokenCount('a'.repeat(12), { code: true })).toBe(2);
  });
});

describe('AnthropicProvider', () => {
  it('streams text + tool-json deltas and final usage; forwards json/tool mode + temperature', async () => {
    anthropicCreate.mockResolvedValue(
      gen([
        { type: 'message_start', message: { usage: { input_tokens: 11 } } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"a"' } },
        { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'ignored' } },
        { type: 'message_delta', usage: { output_tokens: 7 } },
        { type: 'message_stop' },
      ]),
    );
    const chunks = await collect(
      AnthropicProvider.chatStream(
        {
          model: 'claude-sonnet-4-6',
          temperature: 0.2,
          messages: [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'hi' },
          ],
          jsonMode: { schema: { type: 'object' } },
        },
        'key',
      ),
    );
    expect(chunks.map((c) => c.delta).join('')).toBe('Hello{"a"');
    const last = chunks.at(-1)!;
    expect(last.done).toBe(true);
    expect(last.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
    const callArg = anthropicCreate.mock.calls[0]![0];
    expect(callArg.system).toBe('sys');
    expect(callArg.tools[0].name).toBe('StructuredOutput');
    expect(callArg.tool_choice).toEqual({ type: 'tool', name: 'StructuredOutput' });
    expect(callArg.temperature).toBe(0.2);
  });

  it('omits tool mode + uses default max_tokens when no jsonMode/temperature', async () => {
    anthropicCreate.mockResolvedValue(gen([{ type: 'message_stop' }]));
    await collect(
      AnthropicProvider.chatStream({ model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: 'x' }] }, 'k'),
    );
    const callArg = anthropicCreate.mock.calls[0]![0];
    expect(callArg.tools).toBeUndefined();
    expect(callArg.max_tokens).toBe(2048);
    expect(callArg.temperature).toBeUndefined();
  });

  it('uses a custom tool name when provided', async () => {
    anthropicCreate.mockResolvedValue(gen([{ type: 'message_stop' }]));
    await collect(
      AnthropicProvider.chatStream(
        { model: 'claude-sonnet-4-6', maxOutputTokens: 100, messages: [{ role: 'user', content: 'x' }], jsonMode: { schema: {}, name: 'MyTool' } },
        'k',
      ),
    );
    expect(anthropicCreate.mock.calls[0]![0].tools[0].name).toBe('MyTool');
  });

  it('estimateCost uses model pricing and defaults to sonnet for unknowns', () => {
    expect(AnthropicProvider.estimateCost('claude-haiku-4-5-20251001', 1_000_000, 0)).toBeCloseTo(0.8, 6);
    expect(AnthropicProvider.estimateCost('mystery', 1_000_000, 0)).toBeCloseTo(3, 6); // sonnet default
    expect(AnthropicProvider.info.name).toBe('ANTHROPIC');
  });
});

describe('GoogleProvider', () => {
  it('streams text and final usage; forwards system/json/temperature/maxTokens', async () => {
    googleStream.mockResolvedValue(
      gen([
        { text: 'Ho', usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 } },
        { text: '', usageMetadata: undefined },
        { text: 'la', usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 } },
      ]),
    );
    const chunks = await collect(
      GoogleProvider.chatStream(
        {
          model: 'gemini-2.0-flash',
          temperature: 0.9,
          maxOutputTokens: 256,
          messages: [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'u' },
            { role: 'assistant', content: 'a' },
          ],
          jsonMode: { schema: { type: 'object' } },
        },
        'key',
      ),
    );
    expect(chunks.map((c) => c.delta).join('')).toBe('Hola');
    expect(chunks.at(-1)!.usage).toEqual({ inputTokens: 5, outputTokens: 3 });
    const cfg = googleStream.mock.calls[0]![0];
    expect(cfg.config.systemInstruction).toBe('sys');
    expect(cfg.config.responseMimeType).toBe('application/json');
    expect(cfg.config.responseSchema).toEqual({ type: 'object' });
    expect(cfg.contents[1].role).toBe('model'); // assistant → model
  });

  it('works without system/json/temperature and defaults usage to 0', async () => {
    googleStream.mockResolvedValue(gen([{ text: 'x', usageMetadata: undefined }]));
    const chunks = await collect(
      GoogleProvider.chatStream({ model: 'gemini-2.5-pro', messages: [{ role: 'user', content: 'u' }], jsonMode: { schema: undefined as never } }, 'k'),
    );
    expect(chunks.at(-1)!.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    const cfg = googleStream.mock.calls[0]![0];
    expect(cfg.config.systemInstruction).toBeUndefined();
    expect(cfg.config.responseSchema).toBeUndefined();
  });

  it('estimateCost defaults to the first model for unknowns', () => {
    expect(GoogleProvider.estimateCost('gemini-2.5-pro', 1_000_000, 0)).toBeCloseTo(1.25, 6);
    expect(GoogleProvider.estimateCost('nope', 1_000_000, 0)).toBeCloseTo(0.075, 6);
  });
});

describe('OpenAIProvider / Moonshot', () => {
  it('streams content deltas and final usage on finish', async () => {
    openaiCreate.mockResolvedValue(
      gen([
        { choices: [{ delta: { content: 'He' }, finish_reason: null }], usage: null },
        { choices: [{ delta: { content: 'y' }, finish_reason: null }], usage: { prompt_tokens: 3, completion_tokens: 2 } },
        { choices: [{ delta: {}, finish_reason: 'stop' }], usage: undefined },
      ]),
    );
    const chunks = await collect(
      OpenAIProvider.chatStream(
        { model: 'gpt-5-mini', temperature: 0.5, maxOutputTokens: 50, messages: [{ role: 'user', content: 'hi' }], jsonMode: { schema: {} } },
        'key',
      ),
    );
    expect(chunks.filter((c) => !c.done).map((c) => c.delta).join('')).toBe('Hey');
    expect(chunks.at(-1)!.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
    const callArg = openaiCreate.mock.calls[0]![0];
    expect(callArg.response_format).toEqual({ type: 'json_object' });
    expect(callArg.max_completion_tokens).toBe(50);
    expect(callArg.temperature).toBe(0.5);
  });

  it('omits response_format / max tokens when not requested', async () => {
    openaiCreate.mockResolvedValue(gen([{ choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }]));
    await collect(OpenAIProvider.chatStream({ model: 'gpt-4o', messages: [{ role: 'user', content: 'x' }] }, 'k'));
    const callArg = openaiCreate.mock.calls[0]![0];
    expect(callArg.response_format).toBeUndefined();
    expect(callArg.max_completion_tokens).toBeUndefined();
    expect(callArg.temperature).toBeUndefined();
  });

  it('passes baseURL through for a custom (Moonshot) provider', async () => {
    openaiCreate.mockResolvedValue(gen([{ choices: [{ delta: { content: 'k' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }]));
    await collect(MoonshotProvider.chatStream({ model: 'kimi-latest', messages: [{ role: 'user', content: 'x' }] }, 'k'));
    expect(openaiCtor).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://api.moonshot.ai/v1' }));
  });

  it('createOpenAIProvider with no opts omits baseURL', async () => {
    const p = createOpenAIProvider();
    openaiCreate.mockResolvedValue(gen([{ choices: [{ delta: { content: 'z' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }]));
    await collect(p.chatStream({ model: 'gpt-5', messages: [{ role: 'user', content: 'x' }] }, 'k'));
    expect(openaiCtor).toHaveBeenCalledWith(expect.not.objectContaining({ baseURL: expect.anything() }));
  });

  it('estimateCost defaults to the first model for unknowns', () => {
    expect(OpenAIProvider.estimateCost('gpt-4o', 1_000_000, 0)).toBeCloseTo(2.5, 6);
    expect(OpenAIProvider.estimateCost('unknown', 1_000_000, 0)).toBeCloseTo(0.25, 6);
    expect(MoonshotProvider.estimateCost('kimi-latest', 1_000_000, 0)).toBeCloseTo(0.6, 6);
  });
});

describe('registry', () => {
  it('resolves providers, lists info and default models', () => {
    expect(getProvider('ANTHROPIC')).toBe(AnthropicProvider);
    expect(getProvider('GOOGLE')).toBe(GoogleProvider);
    expect(getProvider('OPENAI')).toBe(OpenAIProvider);
    expect(getProvider('MOONSHOT')).toBe(MoonshotProvider);
    expect(listProviders().map((p) => p.name).sort()).toEqual(['ANTHROPIC', 'GOOGLE', 'MOONSHOT', 'OPENAI']);
    expect(defaultModelFor('ANTHROPIC')).toBe('claude-sonnet-4-6');
    expect(defaultModelFor('MOONSHOT')).toBe('kimi-latest');
  });
});
