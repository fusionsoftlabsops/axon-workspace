import { describe, it, expect, vi, beforeEach } from 'vitest';

let envConfig: Record<string, unknown>;
vi.mock('@/lib/env', () => ({ env: () => envConfig }));

import { isInfraLlmConfigured, infraModelName, infraChat } from './infra-llm';

const fetchMock = vi.fn();

beforeEach(() => {
  envConfig = { INFRA_LLM_URL: 'http://llm.internal/', INFRA_LLM_MODEL: 'qwen' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('isInfraLlmConfigured / infraModelName', () => {
  it('is configured when both url and model are set', () => {
    expect(isInfraLlmConfigured()).toBe(true);
    expect(infraModelName()).toBe('qwen');
  });

  it('is not configured when something is missing; model name defaults to infra', () => {
    envConfig = { INFRA_LLM_URL: undefined, INFRA_LLM_MODEL: undefined };
    expect(isInfraLlmConfigured()).toBe(false);
    expect(infraModelName()).toBe('infra');
  });
});

describe('infraChat', () => {
  it('posts to the OpenAI-compatible endpoint and returns trimmed content', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '  hello world  ' } }] }),
    });
    const out = await infraChat('sys', 'user', { maxTokens: 50, timeoutMs: 1000 });
    expect(out).toBe('hello world');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://llm.internal/v1/chat/completions'); // trailing slash trimmed
    const body = JSON.parse(init.body);
    expect(body.model).toBe('qwen');
    expect(body.max_tokens).toBe(50);
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'user' },
    ]);
  });

  it('uses default max_tokens when no opts given', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) });
    await infraChat('s', 'u');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).max_tokens).toBe(800);
  });

  it('throws when not configured', async () => {
    envConfig = { INFRA_LLM_URL: undefined, INFRA_LLM_MODEL: undefined };
    await expect(infraChat('s', 'u')).rejects.toThrow('no configurado');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a non-ok HTTP response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    await expect(infraChat('s', 'u')).rejects.toThrow('HTTP 502');
  });

  it('throws when the model returns empty content', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '   ' } }] }) });
    await expect(infraChat('s', 'u')).rejects.toThrow('Respuesta vacía');
  });

  it('throws when content is not a string', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 42 } }] }) });
    await expect(infraChat('s', 'u')).rejects.toThrow('Respuesta vacía');
  });
});
