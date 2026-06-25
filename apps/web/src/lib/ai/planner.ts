/**
 * AI project planner — interactive chat + structured plan generation, using the
 * SERVER Anthropic key. Chat uses the balanced model (Sonnet); the plan
 * generation uses the deep model (Opus) with forced tool-use JSON. Follows the
 * user's selected language and can consume attached context (images natively,
 * documents/links as extracted text).
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
export type Lang = 'es' | 'en';

export interface PlanImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  base64: string;
}
export interface PlanDocText {
  label: string;
  text: string;
}

type PlanBlock = Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam;

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

function langName(lang: Lang): string {
  return lang === 'es' ? 'español' : 'inglés';
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
  const cost = (usage.input_tokens / 1_000_000) * p.in + (usage.output_tokens / 1_000_000) * p.out;
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

function chatSystem(lang: Lang): string {
  return `Eres un Product/Tech Lead senior facilitando una sesión de planeación de un nuevo proyecto de software.
Tu trabajo en esta fase de chat: entender bien el proyecto y AFILAR la idea.
Reglas:
- Responde SIEMPRE en ${langName(lang)}, sin importar el idioma en que escriba el usuario.
- Haz UNA sola pregunta enfocada por turno (la más valiosa que falte): audiencia, problema, alcance MVP, stack/restricciones técnicas, integraciones, plazos, equipo.
- Sé breve (1-3 frases). Si el usuario es vago, ofrece opciones concretas.
- Si hay contexto adjunto (imágenes, documentos, enlaces), tenlo en cuenta y referéncialo en tus preguntas.
- Cuando ya tengas contexto suficiente (típicamente 3-6 intercambios), PREGUNTA explícitamente al usuario si ya subió TODO el contexto que quería (imágenes, documentos y enlaces). Si confirma que sí, invítalo a pulsar el botón "Generar plan" y deja de hacer preguntas.`;
}

function genSystem(lang: Lang): string {
  return `Eres un Tech Lead senior. Con TODO el contexto de la conversación y los adjuntos, genera un plan de entrega accionable.
Llama a la herramienta EmitPlan con:
- improvedIdea: la idea afinada (2-5 frases).
- sprints: ordenados; cada uno con name, goal y tasks.
- Cada task: title; description; acceptanceCriteria (checklist markdown o Dado/Cuando/Entonces); estimate ("2d","5 pts"); category (infra|backend|frontend|design|qa|devops|docs|other); recommendedRoles (perfiles); priority (LOW|MEDIUM|HIGH|URGENT); kind (TASK|STORY|EPIC|BUG|SPIKE).
- suggestedRepos: repos a crear (backend, frontend, infra, etc.) con name, kind, stack y reason.
Reglas: realista y específico al dominio; usa los adjuntos (imágenes/documentos/enlaces) como contexto; todo el texto del plan en ${langName(lang)}. Llama SOLO a la herramienta.`;
}

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
  lang: Lang,
  attachmentManifest: string,
  userId: string,
  projectId: string,
): Promise<string> {
  const model = env().AI_MODEL_BALANCED;
  const lead =
    brief(project.name, project.description) +
    (attachmentManifest ? `\n\nContexto adjunto:\n${attachmentManifest}` : '') +
    (messages.length === 0 ? ' Inicia la planeación: salúdame brevemente y hazme la primera pregunta clave.' : '');
  const resp = await client().messages.create({
    model,
    max_tokens: 700,
    system: chatSystem(lang),
    messages: [{ role: 'user', content: lead }, ...messages],
  });
  await record('plan.chat', model, resp.usage, userId, projectId);
  return textOf(resp) || (lang === 'es' ? '¿Podrías contarme un poco más?' : 'Could you tell me a bit more?');
}

/** Generate the structured plan (Opus, forced tool-use JSON) with attached context. */
export async function generatePlan(
  project: { name: string; description: string | null },
  messages: ChatMsg[],
  lang: Lang,
  images: PlanImage[],
  docs: PlanDocText[],
  userId: string,
  projectId: string,
): Promise<GeneratedPlan> {
  const model = env().AI_MODEL_DEEP;

  const docContext = docs.length
    ? '\n\nDocumentos/enlaces adjuntos:\n' +
      docs.map((d) => `=== ${d.label} ===\n${d.text}`).join('\n\n')
    : '';
  const finalBlocks: PlanBlock[] = [
    {
      type: 'text',
      text:
        'Con todo el contexto anterior y los adjuntos, genera el plan completo llamando a EmitPlan.' +
        docContext,
    },
    ...images.map(
      (img): PlanBlock => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
      }),
    ),
  ];

  const resp = await client().messages.create({
    model,
    max_tokens: 8000,
    system: genSystem(lang),
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
      { role: 'user', content: finalBlocks },
    ],
  });
  await record('plan.generate', model, resp.usage, userId, projectId);

  const toolUse = resp.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'EmitPlan',
  );
  if (!toolUse) throw new Error('El modelo no devolvió un plan estructurado');
  return generatedPlanSchema.parse(toolUse.input);
}
