/**
 * AI project planner — interactive chat + structured plan generation, using the
 * SERVER Anthropic key (no user LLM credential needed). Chat uses the balanced
 * model (Sonnet); the plan generation uses the deep model (Opus) with forced
 * tool-use JSON. Telemetry is recorded in AiInteraction like the rest of the app.
 */
import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { PLAN_TOOL_SCHEMA, generatedPlanSchema, type GeneratedPlan } from './plan-schema';

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

const PRICING: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5-20251001': { in: 0.8, out: 4 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 15, out: 75 },
};

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const key = env().ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  _client = new Anthropic({ apiKey: key });
  return _client;
}

function brief(name: string, description: string | null): string {
  return `Proyecto: "${name}". Descripción: ${description?.trim() || '(sin descripción)'}.`;
}

async function record(
  purpose: string,
  model: string,
  usage: { input_tokens: number; output_tokens: number },
  userId: string,
  projectId?: string,
): Promise<void> {
  const p = PRICING[model] ?? { in: 0, out: 0 };
  const cost =
    (usage.input_tokens / 1_000_000) * p.in + (usage.output_tokens / 1_000_000) * p.out;
  await prisma.aiInteraction
    .create({
      data: {
        userId,
        projectId,
        model,
        purpose,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        estimatedCostUsd: new Prisma.Decimal(cost.toFixed(6)),
      },
    })
    .catch(() => {});
}

const CHAT_SYSTEM = `Eres un Product/Tech Lead senior facilitando una sesión de planeación de un nuevo proyecto de software.
Tu trabajo en esta fase de chat: entender bien el proyecto y AFILAR la idea.
Reglas:
- Responde SIEMPRE en el mismo idioma en que escribe el usuario (por defecto español).
- Haz UNA sola pregunta enfocada por turno (la más valiosa que falte): audiencia, problema, alcance MVP, stack/restricciones técnicas, integraciones, plazos, equipo.
- Sé breve (1-3 frases). Si el usuario es vago, ofrece opciones concretas.
- Cuando ya tengas contexto suficiente (típicamente 3-6 intercambios), dilo explícitamente e invita a pulsar "Generar plan" — no sigas preguntando de más.
- No generes el plan aquí; eso lo hace otro paso.`;

const GEN_SYSTEM = `Eres un Tech Lead senior. Con TODO el contexto de la conversación, genera un plan de entrega accionable para el proyecto.
Debes llamar a la herramienta EmitPlan con:
- improvedIdea: la idea afinada (2-5 frases).
- sprints: ordenados del primero al último. Cada sprint con name, goal y tasks.
- Cada task: title claro; description; acceptanceCriteria (checklist markdown o Dado/Cuando/Entonces); estimate (p.ej. "2d", "5 pts"); category (infra|backend|frontend|design|qa|devops|docs|other); recommendedRoles (perfiles, p.ej. ["Backend dev","DevOps"]); priority (LOW|MEDIUM|HIGH|URGENT); kind (TASK|STORY|EPIC|BUG|SPIKE).
- suggestedRepos: los repositorios que recomiendas crear (backend, frontend, infra, etc.) con name, kind, stack y reason.
Reglas: sé realista y específico al dominio; cubre infra/devops, backend, frontend, diseño y QA cuando apliquen; tareas concretas y verificables; en el idioma de la conversación (por defecto español). Llama SOLO a la herramienta.`;

function textOf(resp: Anthropic.Messages.Message): string {
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** One chat turn (or the opening greeting when `messages` is empty). */
export async function planChatReply(
  project: { name: string; description: string | null },
  messages: ChatMsg[],
  userId: string,
  projectId: string,
): Promise<string> {
  const model = env().AI_MODEL_BALANCED;
  const lead =
    brief(project.name, project.description) +
    (messages.length === 0
      ? ' Inicia la planeación: salúdame brevemente y hazme la primera pregunta clave.'
      : '');
  const resp = await client().messages.create({
    model,
    max_tokens: 700,
    system: CHAT_SYSTEM,
    messages: [{ role: 'user', content: lead }, ...messages],
  });
  await record('plan.chat', model, resp.usage, userId, projectId);
  return textOf(resp) || '¿Podrías contarme un poco más sobre el proyecto?';
}

/** Generate the structured plan (Opus, forced tool-use JSON). */
export async function generatePlan(
  project: { name: string; description: string | null },
  messages: ChatMsg[],
  userId: string,
  projectId: string,
): Promise<GeneratedPlan> {
  const model = env().AI_MODEL_DEEP;
  const resp = await client().messages.create({
    model,
    max_tokens: 8000,
    system: GEN_SYSTEM,
    tools: [
      {
        name: 'EmitPlan',
        description: 'Emit the full delivery plan for the project.',
        input_schema: PLAN_TOOL_SCHEMA as unknown as Anthropic.Messages.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'EmitPlan' },
    messages: [
      { role: 'user', content: brief(project.name, project.description) },
      ...messages,
      {
        role: 'user',
        content:
          'Con todo el contexto anterior, genera el plan completo llamando a la herramienta EmitPlan.',
      },
    ],
  });
  await record('plan.generate', model, resp.usage, userId, projectId);

  const toolUse = resp.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'EmitPlan',
  );
  if (!toolUse) throw new Error('El modelo no devolvió un plan estructurado');
  return generatedPlanSchema.parse(toolUse.input);
}
