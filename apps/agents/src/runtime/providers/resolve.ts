/**
 * Selección de provider LLM: ÚNICA fuente de "claude vs qwen / qué modelo".
 * Antes vivía dispersa entre `anthropicFor` (SM-retro/QA/REVIEWER) y la lógica
 * inline del DEV en bootstrap. Centralizarla evita que las dos reglas de
 * resolución de modelo (fallback ANTHROPIC_MODEL vs DEV_STRONG_MODEL) se
 * desincronicen.
 */
import { createOpenAiProvider } from './openai.js';
import { createAnthropicProvider } from './anthropic.js';
import type { LlmProvider } from '../types.js';

/** Subconjunto de config que basta para elegir/armar providers (ISP). */
export interface ProvidersConfig {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL: string;
  FUSION_MODEL_URL?: string;
  FUSION_TOKEN?: string;
  QWEN_MODEL: string;
  DEV_STRONG_MODEL: string;
}

/**
 * Provider Anthropic para un agente, usando SU modelo (si es `claude-*`) o el
 * `fallbackModel` (por defecto ANTHROPIC_MODEL). El DEV-strong pasa
 * DEV_STRONG_MODEL como fallback. `null` si no hay credencial.
 */
export function resolveAnthropicProvider(
  deps: ProvidersConfig,
  llmModel: string,
  fallbackModel: string = deps.ANTHROPIC_MODEL,
): LlmProvider | null {
  if (!deps.ANTHROPIC_API_KEY) return null;
  const model = llmModel.startsWith('claude-') ? llmModel : fallbackModel;
  return createAnthropicProvider({ apiKey: deps.ANTHROPIC_API_KEY, model });
}

/**
 * Providers del rol DEV: Qwen primario (obligatorio) + strong Claude opcional
 * (para UI/complejas). `null` si falta la config de Qwen (el DEV no puede correr).
 */
export function resolveDevProviders(
  deps: ProvidersConfig,
  devLlmModel: string,
): { qwen: LlmProvider; strongProvider: LlmProvider | undefined } | null {
  if (!deps.FUSION_MODEL_URL || !deps.FUSION_TOKEN) return null;
  const qwen = createOpenAiProvider({
    baseUrl: deps.FUSION_MODEL_URL,
    apiKey: deps.FUSION_TOKEN,
    model: deps.QWEN_MODEL,
  });
  // El strong usa el modelo del Dev si es claude-*, si no el DEV_STRONG_MODEL.
  const strongProvider = resolveAnthropicProvider(deps, devLlmModel, deps.DEV_STRONG_MODEL) ?? undefined;
  return { qwen, strongProvider };
}
