import { describe, it, expect, vi, beforeEach } from 'vitest';

const anthropicCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = { create: anthropicCreate };
    constructor(_opts: unknown) {}
  },
}));

const aiInteractionCreate = vi.fn();
vi.mock('@/lib/db', () => ({ prisma: { aiInteraction: { create: (...a: unknown[]) => aiInteractionCreate(...a) } } }));

vi.mock('@prisma/client', () => ({
  Prisma: { Decimal: class Decimal { constructor(public value: unknown) {} toString() { return String(this.value); } } },
}));

let envConfig: Record<string, unknown>;
vi.mock('@/lib/env', () => ({ env: () => envConfig }));

const BASE_ENV = {
  ANTHROPIC_API_KEY: 'sk-ant-test',
  AI_MODEL_FAST: 'claude-haiku-4-5-20251001',
  AI_MODEL_BALANCED: 'claude-sonnet-4-6',
  AI_MODEL_DEEP: 'claude-opus-4-8',
};

import { invokeAi } from './router';

beforeEach(() => {
  envConfig = { ...BASE_ENV };
  anthropicCreate.mockReset();
  aiInteractionCreate.mockReset();
  aiInteractionCreate.mockResolvedValue({});
});

function reply(over: Record<string, unknown> = {}) {
  return {
    content: [
      { type: 'text', text: 'first' },
      { type: 'tool_use', name: 'x', input: {} },
      { type: 'text', text: 'second' },
    ],
    usage: { input_tokens: 1000, output_tokens: 500 },
    ...over,
  };
}

describe('invokeAi', () => {
  it('routes a balanced purpose to the balanced model, returns text and records cost', async () => {
    anthropicCreate.mockResolvedValue(reply());
    const r = await invokeAi({ purpose: 'task.draft', context: 'ctx', userId: 'u1', projectId: 'p1', taskId: 't1' });

    expect(r.model).toBe('claude-sonnet-4-6');
    expect(r.output).toBe('first\nsecond'); // only text blocks, joined + trimmed
    expect(r.inputTokens).toBe(1000);
    expect(r.outputTokens).toBe(500);
    // sonnet: 1000/1e6*3 + 500/1e6*15 = 0.003 + 0.0075 = 0.0105
    expect(r.estimatedCostUsd).toBeCloseTo(0.0105, 8);

    const createArg = anthropicCreate.mock.calls[0]![0];
    expect(createArg.model).toBe('claude-sonnet-4-6');
    expect(createArg.system).toContain('PM senior'); // task.draft prompt
    expect(createArg.messages).toEqual([{ role: 'user', content: 'ctx' }]);

    const rec = aiInteractionCreate.mock.calls[0]![0].data;
    expect(rec.userId).toBe('u1');
    expect(rec.model).toBe('claude-sonnet-4-6');
    expect(rec.purpose).toBe('task.draft');
    expect(rec.cacheReadTokens).toBe(0); // missing in usage → defaults to 0
    expect(String(rec.estimatedCostUsd)).toBe('0.010500');
  });

  it('routes a fast purpose to the fast model', async () => {
    anthropicCreate.mockResolvedValue(reply());
    const r = await invokeAi({ purpose: 'task.summarize', context: 'c', userId: 'u' });
    expect(r.model).toBe('claude-haiku-4-5-20251001');
  });

  it('honors a model override and counts cache-read tokens', async () => {
    anthropicCreate.mockResolvedValue(reply({ usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 } }));
    const r = await invokeAi({ purpose: 'task.summarize', context: 'c', userId: 'u', modelOverride: 'deep' });
    expect(r.model).toBe('claude-opus-4-8');
    // opus cacheRead 1.5/M * 1M = 1.5
    expect(r.estimatedCostUsd).toBeCloseTo(1.5, 6);
  });

  it('returns 0 cost when the resolved model has no pricing entry', async () => {
    envConfig.AI_MODEL_FAST = 'unpriced-model';
    anthropicCreate.mockResolvedValue(reply());
    const r = await invokeAi({ purpose: 'commit.message', context: 'c', userId: 'u' });
    expect(r.model).toBe('unpriced-model');
    expect(r.estimatedCostUsd).toBe(0);
  });

  it('throws when ANTHROPIC_API_KEY is unset (fresh module)', async () => {
    vi.resetModules();
    envConfig = { ...BASE_ENV, ANTHROPIC_API_KEY: undefined };
    const mod = await import('./router');
    await expect(mod.invokeAi({ purpose: 'task.draft', context: 'c', userId: 'u' })).rejects.toThrow('ANTHROPIC_API_KEY is not set');
  });
});
