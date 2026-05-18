/**
 * Estimación pre-flight de tokens y costo USD para un prompt dado +
 * un provider/model. Heurística rápida: ~4 chars/token texto plano,
 * ~6 chars/token código. El número real lo devuelve el provider después
 * de la llamada en `ChatChunk.usage`.
 */
import type { LlmProvider } from '@prisma/client';
import { getProvider } from './providers/registry';
import { estimateTokenCount } from './providers/types';

export interface CostEstimateInput {
  provider: LlmProvider;
  model: string;
  promptText: string;          // suma de todos los mensajes (system + user)
  expectedOutputTokens?: number; // default 1500
  codeRatio?: number;            // 0..1, qué fracción del prompt es código
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
}

export function estimateCost(input: CostEstimateInput): CostEstimate {
  const provider = getProvider(input.provider);
  const codeRatio = input.codeRatio ?? 0.5;
  const codeChars = Math.floor(input.promptText.length * codeRatio);
  const proseChars = input.promptText.length - codeChars;

  const inputTokens =
    estimateTokenCount(input.promptText.slice(0, proseChars), { code: false }) +
    estimateTokenCount(input.promptText.slice(proseChars), { code: true });

  const outputTokens = input.expectedOutputTokens ?? 1500;

  // El método estimateCost del provider devuelve total USD.
  const totalCostUsd = provider.estimateCost(input.model, inputTokens, outputTokens);

  // Aproximamos cost split por la proporción de tokens.
  const total = inputTokens + outputTokens || 1;
  const inputCostUsd = totalCostUsd * (inputTokens / total);
  const outputCostUsd = totalCostUsd - inputCostUsd;

  return {
    inputTokens,
    outputTokens,
    inputCostUsd,
    outputCostUsd,
    totalCostUsd,
  };
}

export function formatUsd(usd: number): string {
  if (usd < 0.001) return '<$0.001';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
