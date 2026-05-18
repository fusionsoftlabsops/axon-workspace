import { createOpenAIProvider } from './openai';
import type { ProviderInfo } from './types';

// Kimi / Moonshot expone una API OpenAI-compatible.
// Pricing estimado (USD por 1M tokens) — verificar con la cuenta del usuario.
const INFO: ProviderInfo = {
  name: 'MOONSHOT',
  displayName: 'Kimi (Moonshot)',
  models: [
    { id: 'kimi-latest',         displayName: 'Kimi Latest',     inputPerMTokens: 0.6, outputPerMTokens: 0.6, supportsJsonMode: true },
    { id: 'kimi-k2-turbo-preview', displayName: 'Kimi K2 Turbo', inputPerMTokens: 1.0, outputPerMTokens: 3.0, supportsJsonMode: true },
  ],
  defaultModel: 'kimi-latest',
};

export const MoonshotProvider = createOpenAIProvider({
  baseURL: 'https://api.moonshot.ai/v1',
  info: INFO,
});
