/**
 * AI router: selects the right Claude model for each `purpose`, executes the
 * call via the Anthropic SDK, and records cost telemetry in `AiInteraction`.
 *
 * Pricing constants are USD per 1M tokens (Anthropic public pricing as of
 * 2026 model launches). Adjust if pricing changes.
 */
import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import type { AiPurpose } from '@admin/shared/types';

type ModelKey = 'fast' | 'balanced' | 'deep';

interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
}

const PRICING: Record<string, ModelPricing> = {
  'claude-haiku-4-5-20251001': { inputPerM: 0.8, outputPerM: 4, cacheReadPerM: 0.08 },
  'claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3 },
  'claude-opus-4-8': { inputPerM: 15, outputPerM: 75, cacheReadPerM: 1.5 },
};

const ROUTING: Record<AiPurpose, ModelKey> = {
  'task.draft': 'balanced',
  'task.summarize': 'fast',
  'ac.generate': 'balanced',
  'epic.breakdown': 'balanced',
  'commit.message': 'fast',
  'pr.description': 'balanced',
  'bug.report': 'balanced',
  'brain.extract': 'balanced',
  // story.generate usa el provider multi-LLM (lib/ai/providers), no este router.
  // El valor aquí no se consulta — está solo para satisfacer el exhaustive type.
  'story.generate': 'deep',
};

const PROMPTS: Record<AiPurpose, string> = {
  'task.draft':
    'Eres un PM senior. Dado un título breve de tarea, redacta una descripción clara y concisa en español, en formato markdown. Incluye: objetivo (1 línea), contexto si es relevante (2-3 líneas), y "Definition of Done" como lista breve. No inventes detalles técnicos que no estén en el input.',
  'task.summarize':
    'Resume el siguiente contenido en 1-2 frases en español. Sé directo.',
  'ac.generate':
    'Eres un QA lead. Dada la siguiente descripción de tarea, genera 3-7 criterios de aceptación verificables en formato "Dado / Cuando / Entonces" o checklist. En español. No inventes funcionalidades no implicadas.',
  'epic.breakdown':
    'Eres un tech lead. Dado el siguiente epic, propón un breakdown en 3-7 subtareas accionables. Para cada una entrega: título corto, descripción de 1-2 líneas. Formato: lista markdown. En español.',
  'commit.message':
    'Eres un experto en Conventional Commits. Dado el siguiente resumen de cambios + número de tarea (PROJ-N), genera UN solo mensaje de commit en formato "tipo(scope): descripción — PROJ-N". El cuerpo del mensaje es opcional. En español. Sin emojis. No agregues nada fuera del mensaje.',
  'pr.description':
    'Genera una descripción de PR en español con dos secciones markdown: ## Resumen (1-3 bullets de qué cambia y por qué) y ## Test plan (lista breve de cómo probarlo). Usa el contexto de la tarea provisto.',
  'bug.report':
    'Eres un QA. Dada información cruda sobre un error encontrado durante desarrollo, redacta un bug ticket en español con secciones: ### Resumen, ### Pasos para reproducir, ### Resultado esperado, ### Resultado actual. Sé conciso y no inventes información que no está en el input.',
  'brain.extract':
    'Eres un capturador de conocimiento técnico de un proyecto de software. Leerás los datos de una tarea cerrada (descripción, comentarios, actividad) y producirás un array JSON con 0 a 3 memorias del shape: [{"type":"DECISION|GOTCHA|PATTERN|ANTIPATTERN|RUNBOOK|GLOSSARY|NOTE","title":"...","body":"markdown con el aprendizaje accionable","tags":["..."]}]. Reglas: (1) cada memoria DEBE ser accionable y NO obvia — algo que un dev futuro agradecería saber sin tener que leer la tarea entera. (2) NO captures cosas evidentes ("se creó un PR", "se cerró la tarea"). (3) NO inventes detalles que no estén en el input. (4) Si no hay nada que valga la pena, responde con []. (5) Emite SOLO el JSON, sin prefacio, sin code fence, sin texto explicativo. En español.',
  // story.generate tiene su propio prompt en lib/ai/story-prompt.ts y se
  // invoca por el flujo multi-LLM, no por este router.
  'story.generate': '',
};

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const key = env().ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  _client = new Anthropic({ apiKey: key });
  return _client;
}

function pickModel(purpose: AiPurpose, override?: ModelKey): string {
  const key = override ?? ROUTING[purpose];
  const e = env();
  switch (key) {
    case 'fast':
      return e.AI_MODEL_FAST;
    case 'balanced':
      return e.AI_MODEL_BALANCED;
    case 'deep':
      return e.AI_MODEL_DEEP;
  }
}

function estimateCost(model: string, input: number, output: number, cacheRead: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (
    (input / 1_000_000) * p.inputPerM +
    (output / 1_000_000) * p.outputPerM +
    (cacheRead / 1_000_000) * p.cacheReadPerM
  );
}

export interface InvokeOptions {
  purpose: AiPurpose;
  context: string;
  userId: string;
  projectId?: string;
  taskId?: string;
  modelOverride?: ModelKey;
}

export interface InvokeResult {
  output: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

/** Run a single AI invocation. Records the call in `AiInteraction`. */
export async function invokeAi(opts: InvokeOptions): Promise<InvokeResult> {
  const model = pickModel(opts.purpose, opts.modelOverride);
  const system = PROMPTS[opts.purpose];

  const resp = await client().messages.create({
    model,
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: opts.context }],
  });

  const output = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  const inputTokens = resp.usage.input_tokens;
  const outputTokens = resp.usage.output_tokens;
  const cacheRead = (resp.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
  const estimatedCostUsd = estimateCost(model, inputTokens, outputTokens, cacheRead);

  await prisma.aiInteraction.create({
    data: {
      userId: opts.userId,
      projectId: opts.projectId,
      taskId: opts.taskId,
      model,
      purpose: opts.purpose,
      inputTokens,
      outputTokens,
      cacheReadTokens: cacheRead,
      estimatedCostUsd: new Prisma.Decimal(estimatedCostUsd.toFixed(6)),
    },
  });

  return { output, model, inputTokens, outputTokens, estimatedCostUsd };
}
