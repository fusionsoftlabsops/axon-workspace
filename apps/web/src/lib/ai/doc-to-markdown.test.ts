import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ infraChat: vi.fn(), isInfraLlmConfigured: vi.fn() }));
vi.mock('@/lib/ai/infra-llm', () => ({ infraChat: h.infraChat, isInfraLlmConfigured: h.isInfraLlmConfigured }));

import { cleanToMarkdown } from './doc-to-markdown';

beforeEach(() => {
  h.infraChat.mockReset();
  h.isInfraLlmConfigured.mockReset();
});

describe('cleanToMarkdown', () => {
  it('returns empty for empty input', async () => {
    h.isInfraLlmConfigured.mockReturnValue(true);
    expect(await cleanToMarkdown('   ', 'a.pdf')).toBe('');
    expect(h.infraChat).not.toHaveBeenCalled();
  });

  it('uses the infra LLM to clean the text when configured', async () => {
    h.isInfraLlmConfigured.mockReturnValue(true);
    h.infraChat.mockResolvedValue('# Clean\n\nmd');
    const out = await cleanToMarkdown('raw text', 'spec.pdf');
    expect(out).toBe('# Clean\n\nmd');
    expect(h.infraChat).toHaveBeenCalled();
  });

  it('falls back to the raw text when the infra LLM is not configured (0 tokens)', async () => {
    h.isInfraLlmConfigured.mockReturnValue(false);
    const out = await cleanToMarkdown('raw text', 'spec.pdf');
    expect(out).toBe('raw text');
    expect(h.infraChat).not.toHaveBeenCalled();
  });

  it('falls back to raw text when the model errors', async () => {
    h.isInfraLlmConfigured.mockReturnValue(true);
    h.infraChat.mockRejectedValue(new Error('down'));
    expect(await cleanToMarkdown('raw text', 'spec.pdf')).toBe('raw text');
  });

  it('appends a truncation note for very long input', async () => {
    h.isInfraLlmConfigured.mockReturnValue(false);
    const long = 'x'.repeat(30_000);
    const out = await cleanToMarkdown(long, 'big.pdf');
    expect(out).toContain('documento truncado');
    expect(out.length).toBeLessThan(long.length);
  });
});
