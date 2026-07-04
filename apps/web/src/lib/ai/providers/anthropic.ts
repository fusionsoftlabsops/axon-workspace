import Anthropic from '@anthropic-ai/sdk';
import type { ChatProvider, ChatOptions, ChatChunk, ProviderInfo } from './types';

const MODELS = [
  { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', inputPerMTokens: 0.8, outputPerMTokens: 4, supportsJsonMode: true },
  { id: 'claude-sonnet-5',           displayName: 'Claude Sonnet 5',   inputPerMTokens: 3,    outputPerMTokens: 15, supportsJsonMode: true },
  { id: 'claude-sonnet-4-6',         displayName: 'Claude Sonnet 4.6', inputPerMTokens: 3,    outputPerMTokens: 15, supportsJsonMode: true },
  { id: 'claude-opus-4-7',           displayName: 'Claude Opus 4.7',   inputPerMTokens: 15,   outputPerMTokens: 75, supportsJsonMode: true },
] as const;

const INFO: ProviderInfo = {
  name: 'ANTHROPIC',
  displayName: 'Anthropic (Claude)',
  models: [...MODELS],
  defaultModel: 'claude-sonnet-5',
};

export const AnthropicProvider: ChatProvider = {
  info: INFO,

  async *chatStream(opts: ChatOptions, apiKey: string): AsyncIterable<ChatChunk> {
    const client = new Anthropic({ apiKey });
    const system = opts.messages.find((m) => m.role === 'system')?.content ?? '';
    const messages = opts.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    // Si el caller pidió jsonMode con schema, usamos Tool Use forzado para
    // garantizar JSON estructurado válido contra el schema. Eliminamos toda
    // la fragilidad de "el modelo devolvió texto cerca de JSON".
    const useToolMode = !!opts.jsonMode?.schema;
    const toolName = opts.jsonMode?.name ?? 'StructuredOutput';

    const stream = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxOutputTokens ?? 2048,
      system,
      messages,
      stream: true,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(useToolMode
        ? {
            tools: [
              {
                name: toolName,
                description: `Devuelve el output estructurado según el schema.`,
                input_schema: opts.jsonMode!.schema as Anthropic.Messages.Tool.InputSchema,
              },
            ],
            tool_choice: { type: 'tool' as const, name: toolName },
          }
        : {}),
    });

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of stream) {
      if (event.type === 'message_start') {
        inputTokens = event.message.usage?.input_tokens ?? 0;
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { delta: event.delta.text };
        } else if (event.delta.type === 'input_json_delta') {
          // Tool use streaming: cada chunk es una pieza del JSON serializado.
          yield { delta: event.delta.partial_json };
        }
      } else if (event.type === 'message_delta') {
        outputTokens = event.usage?.output_tokens ?? outputTokens;
      } else if (event.type === 'message_stop') {
        yield { delta: '', done: true, usage: { inputTokens, outputTokens } };
      }
    }
  },

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const m = MODELS.find((x) => x.id === model) ?? MODELS[1]; // default sonnet
    return (
      (inputTokens / 1_000_000) * m.inputPerMTokens +
      (outputTokens / 1_000_000) * m.outputPerMTokens
    );
  },
};
