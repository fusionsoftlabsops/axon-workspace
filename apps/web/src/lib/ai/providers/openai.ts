import OpenAI from 'openai';
import type { ChatProvider, ChatOptions, ChatChunk, ProviderInfo } from './types';

const MODELS = [
  { id: 'gpt-5-mini', displayName: 'GPT-5 mini', inputPerMTokens: 0.25, outputPerMTokens: 2,   supportsJsonMode: true },
  { id: 'gpt-5',      displayName: 'GPT-5',      inputPerMTokens: 1.25, outputPerMTokens: 10,  supportsJsonMode: true },
  { id: 'gpt-4o-mini', displayName: 'GPT-4o mini', inputPerMTokens: 0.15, outputPerMTokens: 0.6, supportsJsonMode: true },
  { id: 'gpt-4o',      displayName: 'GPT-4o',      inputPerMTokens: 2.5,  outputPerMTokens: 10,  supportsJsonMode: true },
] as const;

const INFO: ProviderInfo = {
  name: 'OPENAI',
  displayName: 'OpenAI',
  models: [...MODELS],
  defaultModel: 'gpt-5-mini',
};

/**
 * Crea el provider OpenAI estándar (api.openai.com).
 * Para Moonshot/Kimi se reusa con un base_url distinto.
 */
export function createOpenAIProvider(opts: { baseURL?: string; info?: ProviderInfo } = {}): ChatProvider {
  const info = opts.info ?? INFO;

  return {
    info,
    async *chatStream(chatOpts: ChatOptions, apiKey: string): AsyncIterable<ChatChunk> {
      const client = new OpenAI({ apiKey, ...(opts.baseURL ? { baseURL: opts.baseURL } : {}) });

      const responseFormat = chatOpts.jsonMode
        ? ({ type: 'json_object' } as const)
        : undefined;

      const stream = await client.chat.completions.create({
        model: chatOpts.model,
        messages: chatOpts.messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(responseFormat ? { response_format: responseFormat } : {}),
        ...(chatOpts.maxOutputTokens ? { max_completion_tokens: chatOpts.maxOutputTokens } : {}),
        ...(chatOpts.temperature !== undefined ? { temperature: chatOpts.temperature } : {}),
      });

      let usage: { inputTokens: number; outputTokens: number } | undefined;
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield { delta };
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          };
        }
        const finish = chunk.choices[0]?.finish_reason;
        if (finish) {
          yield { delta: '', done: true, usage };
        }
      }
    },
    estimateCost(model: string, inputTokens: number, outputTokens: number): number {
      const m = info.models.find((x) => x.id === model) ?? info.models[0]!;
      return (
        (inputTokens / 1_000_000) * m.inputPerMTokens +
        (outputTokens / 1_000_000) * m.outputPerMTokens
      );
    },
  };
}

export const OpenAIProvider: ChatProvider = createOpenAIProvider();
