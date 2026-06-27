import { describe, it, expect } from 'vitest';
import { estimateCost, formatUsd } from './cost-estimator';

describe('estimateCost', () => {
  it('estimates tokens with the default code ratio and output tokens', () => {
    const r = estimateCost({
      provider: 'ANTHROPIC',
      model: 'claude-sonnet-4-6',
      promptText: 'a'.repeat(120),
    });
    // 60 prose chars (/4=15) + 60 code chars (/6=10) = 25 input tokens.
    expect(r.inputTokens).toBe(25);
    expect(r.outputTokens).toBe(1500); // default
    expect(r.totalCostUsd).toBeGreaterThan(0);
    // input + output cost split sums to total.
    expect(r.inputCostUsd + r.outputCostUsd).toBeCloseTo(r.totalCostUsd, 10);
  });

  it('honors explicit codeRatio and expectedOutputTokens', () => {
    const allProse = estimateCost({
      provider: 'OPENAI',
      model: 'gpt-5-mini',
      promptText: 'a'.repeat(120),
      codeRatio: 0,
      expectedOutputTokens: 500,
    });
    expect(allProse.inputTokens).toBe(30); // 120/4
    expect(allProse.outputTokens).toBe(500);
  });

  it('avoids divide-by-zero when there are no tokens', () => {
    const r = estimateCost({
      provider: 'GOOGLE',
      model: 'gemini-2.0-flash',
      promptText: '',
      expectedOutputTokens: 0,
    });
    expect(r.inputTokens).toBe(0);
    expect(r.outputTokens).toBe(0);
    expect(r.inputCostUsd).toBe(0);
    expect(r.outputCostUsd).toBe(0);
    expect(r.totalCostUsd).toBe(0);
  });

  it('falls back to the provider default model for an unknown model', () => {
    const r = estimateCost({ provider: 'MOONSHOT', model: 'who-knows', promptText: 'x'.repeat(40) });
    expect(r.totalCostUsd).toBeGreaterThan(0);
  });
});

describe('formatUsd', () => {
  it('formats across magnitude thresholds', () => {
    expect(formatUsd(0.0001)).toBe('<$0.001');
    expect(formatUsd(0.005)).toBe('$0.0050');
    expect(formatUsd(0.5)).toBe('$0.500');
    expect(formatUsd(12.345)).toBe('$12.35');
  });
});
