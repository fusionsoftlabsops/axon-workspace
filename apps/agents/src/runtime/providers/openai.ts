/**
 * Adaptador OpenAI function-calling → LlmProvider. Es el camino del rol Dev:
 * el modelo Qwen propio se sirve vía vLLM, que expone una API compatible
 * OpenAI en FUSION_MODEL_URL (auth Bearer FUSION_TOKEN).
 *
 * fetch puro, sin SDK: el contrato chat/completions es JSON simple y así el
 * worker no arrastra dependencias pesadas.
 */
import type { ChatMessage, CompletionResult, LlmProvider, ToolCall, ToolDef } from '../types.js';

export interface OpenAiProviderOptions {
  baseUrl: string; // p.ej. https://modelo.fusion-soft-lab.com/v1
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

type OpenAiMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    }
  | { role: 'tool'; content: string; tool_call_id: string };

function toOpenAiMessages(system: string, messages: ChatMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: 'function' as const,
                function: { name: c.name, arguments: c.arguments },
              })),
            }
          : {}),
      });
    } else {
      out.push({ role: 'tool', content: m.content, tool_call_id: m.toolCallId });
    }
  }
  return out;
}

function mapStopReason(reason: string | null | undefined): CompletionResult['stopReason'] {
  if (reason === 'tool_calls') return 'tool_calls';
  if (reason === 'stop') return 'stop';
  if (reason === 'length') return 'length';
  return 'other';
}

export function createOpenAiProvider(opts: OpenAiProviderOptions): LlmProvider {
  return {
    async complete(input): Promise<CompletionResult> {
      const res = await fetch(`${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model: opts.model,
          messages: toOpenAiMessages(input.system, input.messages),
          ...(input.tools.length
            ? {
                tools: input.tools.map((t: ToolDef) => ({
                  type: 'function',
                  function: { name: t.name, description: t.description, parameters: t.inputSchema },
                })),
              }
            : {}),
          ...(input.maxOutputTokens ? { max_tokens: input.maxOutputTokens } : {}),
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 300_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`openai-provider ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = (await res.json()) as {
        choices: Array<{
          message: {
            content: string | null;
            tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
          };
          finish_reason?: string | null;
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = data.choices?.[0];
      if (!choice) throw new Error('openai-provider: respuesta sin choices');
      const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((c) => ({
        id: c.id,
        name: c.function.name,
        arguments: c.function.arguments ?? '{}',
      }));
      return {
        content: choice.message.content ?? '',
        toolCalls,
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
        },
        stopReason: toolCalls.length > 0 ? 'tool_calls' : mapStopReason(choice.finish_reason),
      };
    },
  };
}
