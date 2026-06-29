/**
 * Convert a document's extracted raw text into clean, faithful Markdown — the
 * downloadable "context artifact" that also grounds AI planning.
 *
 * Uses the self-hosted infra LLM (GPU / Qwen, off the Anthropic API), so the
 * one-time conversion costs no Anthropic tokens. When the infra model is not
 * configured, it degrades to the raw text unchanged (still a valid .md).
 */
import { infraChat, isInfraLlmConfigured } from '@/lib/ai/infra-llm';

const MAX_INPUT_CHARS = 24_000;

const SYSTEM = [
  'Eres un conversor de documentos a Markdown.',
  'Reescribe el texto del documento como Markdown limpio y bien estructurado',
  '(encabezados, listas, tablas cuando aplique), FIEL al contenido original.',
  'No inventes, no resumas en exceso, no agregues información que no esté en el texto.',
  'Devuelve SOLO el Markdown, sin explicaciones ni comentarios.',
].join(' ');

/** Returns clean Markdown for the given extracted text. Falls back to the raw
 *  text (optionally truncated) when the infra LLM is unavailable or fails. */
export async function cleanToMarkdown(rawText: string, fileName: string): Promise<string> {
  const text = (rawText ?? '').trim();
  if (!text) return '';

  const truncated = text.length > MAX_INPUT_CHARS;
  const input = truncated ? text.slice(0, MAX_INPUT_CHARS) : text;
  const truncNote = truncated ? '\n\n> _(documento truncado para el contexto)_' : '';

  if (!isInfraLlmConfigured()) {
    // Graceful degradation: the raw extraction is still a usable .md.
    return input + truncNote;
  }

  try {
    const user = `Documento: ${fileName}\n\n---\n${input}\n---`;
    const md = await infraChat(SYSTEM, user, { maxTokens: 4096, timeoutMs: 120_000 });
    return (md.trim() || input) + truncNote;
  } catch {
    // The model errored — fall back to raw text rather than failing the artifact.
    return input + truncNote;
  }
}
