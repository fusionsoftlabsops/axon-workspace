/**
 * Client for the self-hosted LLM on fusion-infra, reachable on the internal
 * `fusion` Docker network (e.g. the GPU-backed vLLM server serving Qwen3-Coder).
 * Used for context-graph summaries so that cost stays off the Anthropic API.
 * Optional: when INFRA_LLM_URL / _MODEL are unset, isInfraLlmConfigured() is
 * false and callers degrade gracefully.
 *
 * Uses the OpenAI-compatible chat API (vLLM and Ollama both expose it):
 *   POST {base}/v1/chat/completions { model, messages } → { choices: [{ message: { content } }] }.
 */
import { env } from '@/lib/env';

export function isInfraLlmConfigured(): boolean {
  const e = env();
  return Boolean(e.INFRA_LLM_URL && e.INFRA_LLM_MODEL);
}

export function infraModelName(): string {
  return env().INFRA_LLM_MODEL ?? 'infra';
}

export async function infraChat(
  system: string,
  user: string,
  opts?: { maxTokens?: number; timeoutMs?: number },
): Promise<string> {
  const e = env();
  if (!e.INFRA_LLM_URL || !e.INFRA_LLM_MODEL) throw new Error('Modelo de infraestructura no configurado');
  const base = e.INFRA_LLM_URL.replace(/\/+$/, '');
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: e.INFRA_LLM_MODEL,
      stream: false,
      temperature: 0.4,
      max_tokens: opts?.maxTokens ?? 800,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 60_000),
  });
  if (!res.ok) throw new Error(`Modelo de infraestructura: HTTP ${res.status}`);
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = j?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('Respuesta vacía del modelo');
  return content.trim();
}
