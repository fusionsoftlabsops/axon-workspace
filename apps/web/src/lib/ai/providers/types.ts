/**
 * Provider abstraction para chat LLMs. Cada implementación adapta el SDK
 * nativo a este interface uniforme. La diferencia clave: streaming en
 * formato unificado y mode JSON estructurado.
 */
import type { LlmProvider } from '@prisma/client';

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  model: string;
  /** Si está, fuerza al modelo a emitir JSON que respete el schema. */
  jsonMode?: { schema: object; name?: string };
  maxOutputTokens?: number;
  temperature?: number;
}

export interface ChatChunk {
  /** Delta de texto incremental (vacío en el chunk final). */
  delta: string;
  /** True en el último chunk. */
  done?: boolean;
  /** Disponible típicamente en el último chunk. */
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ProviderModelInfo {
  id: string;
  displayName: string;
  inputPerMTokens: number;   // USD por 1M input tokens
  outputPerMTokens: number;  // USD por 1M output tokens
  supportsJsonMode: boolean;
}

export interface ProviderInfo {
  name: LlmProvider;
  displayName: string;
  models: ProviderModelInfo[];
  defaultModel: string;
}

export interface ChatProvider {
  info: ProviderInfo;
  chatStream(opts: ChatOptions, apiKey: string): AsyncIterable<ChatChunk>;
  estimateCost(model: string, inputTokens: number, outputTokens: number): number;
}

/**
 * Heurística rápida para estimar tokens sin tokenizador real: ~4 chars/token
 * para texto en inglés/español, ~6 chars/token para código mono-espacio.
 * Se usa para mostrar costo pre-flight; los counts reales vienen del provider.
 */
export function estimateTokenCount(text: string, opts: { code?: boolean } = {}): number {
  const charsPerToken = opts.code ? 6 : 4;
  return Math.ceil(text.length / charsPerToken);
}
