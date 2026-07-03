/**
 * Adaptador Anthropic tools → LlmProvider. Es el camino de los roles SM/QA
 * (Claude vía la credencial server de la instancia). fetch puro contra
 * /v1/messages — mismo motivo que el adaptador OpenAI: cero SDKs en el worker.
 */
import type { ChatMessage, CompletionResult, LlmProvider, ToolCall, ToolDef } from '../types.js';

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string; // default API pública
  timeoutMs?: number;
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

type AnthropicMessage = { role: 'user' | 'assistant'; content: string | ContentBlock[] };

/**
 * El transcript propio (user/assistant/tool) se traduce al formato Anthropic:
 * los tool_result van como bloques dentro de un mensaje `user`, y los tool
 * calls del assistant como bloques `tool_use`. Tool results consecutivos se
 * agrupan en un solo mensaje user (requisito del API).
 */
function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const blocks: ContentBlock[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) {
        let input: unknown = {};
        try {
          input = c.arguments.trim() ? JSON.parse(c.arguments) : {};
        } catch {
          input = { _raw: c.arguments };
        }
        blocks.push({ type: 'tool_use', id: c.id, name: c.name, input });
      }
      out.push({ role: 'assistant', content: blocks });
    } else {
      const block: ContentBlock = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
    }
  }
  return out;
}

function mapStopReason(reason: string | null | undefined): CompletionResult['stopReason'] {
  if (reason === 'tool_use') return 'tool_calls';
  if (reason === 'end_turn') return 'stop';
  if (reason === 'max_tokens') return 'length';
  return 'other';
}

export function createAnthropicProvider(opts: AnthropicProviderOptions): LlmProvider {
  const baseUrl = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  return {
    async complete(input): Promise<CompletionResult> {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': opts.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: input.maxOutputTokens ?? 4096,
          system: input.system,
          messages: toAnthropicMessages(input.messages),
          ...(input.tools.length
            ? {
                tools: input.tools.map((t: ToolDef) => ({
                  name: t.name,
                  description: t.description,
                  input_schema: t.inputSchema,
                })),
              }
            : {}),
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 300_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`anthropic-provider ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = (await res.json()) as {
        content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
        stop_reason?: string | null;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = data.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      const toolCalls: ToolCall[] = data.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: b.id ?? '', name: b.name ?? '', arguments: JSON.stringify(b.input ?? {}) }));
      return {
        content: text,
        toolCalls,
        usage: {
          promptTokens: data.usage?.input_tokens ?? 0,
          completionTokens: data.usage?.output_tokens ?? 0,
        },
        stopReason: mapStopReason(data.stop_reason),
      };
    },
  };
}
