import type { LlmProvider } from '@prisma/client';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import { GoogleProvider } from './google';
import { MoonshotProvider } from './moonshot';
import type { ChatProvider, ProviderInfo } from './types';

const REGISTRY: Record<LlmProvider, ChatProvider> = {
  ANTHROPIC: AnthropicProvider,
  OPENAI:    OpenAIProvider,
  GOOGLE:    GoogleProvider,
  MOONSHOT:  MoonshotProvider,
};

export function getProvider(name: LlmProvider): ChatProvider {
  return REGISTRY[name];
}

export function listProviders(): ProviderInfo[] {
  return Object.values(REGISTRY).map((p) => p.info);
}

export function defaultModelFor(provider: LlmProvider): string {
  return REGISTRY[provider].info.defaultModel;
}

export type { ChatProvider, ChatOptions, ChatChunk, ProviderInfo, ChatMessage } from './types';
export { estimateTokenCount } from './types';
