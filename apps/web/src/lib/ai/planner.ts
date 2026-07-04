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
import { infraChat } from './infra-llm';
import {
  PLAN_TOOL_SCHEMA,
  PLAN_TASK_TOOL_SCHEMA,
  REESTIMATE_TOOL_SCHEMA,
  QA_TESTS_TOOL_SCHEMA,
  generatedPlanSchema,
  planTaskSchema,
  reestimateResultSchema,
  qaTestsResultSchema,
  type GeneratedPlan,
  type PlanTask,
  type ReestimateItem,
  type QaTestCaseAI,
} from './plan-schema';

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  // Author attribution for collaborative chat (user messages). Optional and
  // back-compatible: older messages have no author. The assistant has none.
  authorId?: string;
  authorName?: string;
  // Snapshot of the context sources the AI had in mind for THIS iteration
  // (attachment/file names + "Grafo de código"). Optional and back-compatible:
  // older messages have none. Set when a user message is sent and on generation.
  context?: { sources: string[] };
  // Cuando la respuesta del asistente la da UN AGENTE del equipo (@mención en el
  // chat del plan): "Dax · ARCHITECT". Opcional y retro-compatible.
  agentName?: string;
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
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 15, out: 75 },
  // Placeholder al nivel de Opus hasta tener pricing oficial de Fable 5.
  'claude-fable-5': { in: 15, out: 75 },
};

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const key = env().ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  _client = new Anthropic({ apiKey: key });
  return _client;
}

/** Modelo efectivo de un generador: la config del agente si es claude-*, si no el default. */
function pickModel(defaultModel: string, override?: string | null): string {
  return override && override.startsWith('claude-') ? override : defaultModel;
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

/** When a code knowledge-graph brief is available, the project is EXISTING
 *  (brownfield): the planner must plan evolution over the real code, not a
 *  rebuild. Returns the framing block to prepend, or '' for greenfield. */
export function codeMapBlock(codeContext?: string): string {
  if (!codeContext?.trim()) return '';
  return `\n\nEste proyecto YA EXISTE y está EN PRODUCCIÓN. A continuación, el MAPA DE SU CÓDIGO REAL (grafo de conocimiento generado por graphify sobre sus repos):
<<<CODE_MAP
${codeContext.trim()}
CODE_MAP
Usa este mapa como verdad sobre lo que ya está construido: NO propongas reconstruir ni reinventar lo que ya existe; planifica MEJORAS, evoluciones, deuda técnica, nuevas capacidades e integraciones SOBRE el código real. Referencia módulos/áreas/conceptos reales del mapa cuando sea relevante.`;
}

export function chatSystem(lang: Lang, codeContext?: string): string {
  const brownfield = Boolean(codeContext?.trim());
  const intro = brownfield
    ? 'Eres un Product/Tech Lead senior facilitando una sesión de planeación de tareas futuras sobre un proyecto de software YA EXISTENTE y desplegado.'
    : 'Eres un Product/Tech Lead senior facilitando una sesión de planeación de un nuevo proyecto de software.';
  const focusLine = brownfield
    ? '- Haz UNA sola pregunta enfocada por turno (la más valiosa que falte): qué objetivos/áreas se quieren evolucionar, prioridades, nuevas capacidades, deuda técnica o problemas a resolver sobre lo ya construido.'
    : '- Haz UNA sola pregunta enfocada por turno (la más valiosa que falte): audiencia, problema, alcance MVP, stack/restricciones técnicas, integraciones, plazos, equipo.';
  return `${intro}
Tu trabajo en esta fase de chat: entender bien ${brownfield ? 'qué se quiere construir/mejorar a continuación' : 'el proyecto'} y AFILAR la idea.${codeMapBlock(codeContext)}
Reglas:
- Responde SIEMPRE en ${langName(lang)}, sin importar el idioma en que escriba el usuario.
${focusLine}
- Sé breve (1-3 frases). Si el usuario es vago, ofrece opciones concretas.
- Si hay contexto adjunto (imágenes, documentos, enlaces), tenlo en cuenta y referéncialo en tus preguntas.
- Cuando ya tengas contexto suficiente (típicamente 3-6 intercambios), PREGUNTA explícitamente al usuario si ya subió TODO el contexto que quería (imágenes, documentos y enlaces). Si confirma que sí, invítalo a pulsar el botón "Generar plan" y deja de hacer preguntas.`;
}

// Reglas de estimación por seniority asumiendo desarrollo asistido por IA.
function estimateGuidance(): string {
  return `REGLAS DE ESTIMACIÓN (campos estimate y estimateBySeniority): las HUs se implementan en NUESTRO stack por desarrolladores ASISTIDOS POR IA — el modelo Qwen vía MCP (lee el repositorio, genera código y ejecuta tareas) siguiendo el plan de trabajo generado con Opus. Para CADA HU entrega \`estimateBySeniority\` con el esfuerzo REALISTA (incluye revisión humana, pruebas e integración) con ese apoyo de IA para tres perfiles:
- junior: tarda más (necesita más guía, iteración y revisión);
- semiSenior: intermedio;
- senior: el más rápido y autónomo.
Adapta los tiempos al área/categoría y stack de la HU. Usa unidades cortas y consistentes ("3h","6h","1d","2d","3 pts"). Fija \`estimate\` al rango representativo "<junior>–<senior>" (p. ej. "3h–1d").`;
}

export function genSystem(lang: Lang, codeContext?: string): string {
  const brownfield = Boolean(codeContext?.trim());
  const brownfieldRule = brownfield
    ? ' Como el proyecto YA EXISTE (ver el MAPA DEL CÓDIGO), las HUs deben ser MEJORAS/evoluciones sobre el código real (no reconstruir lo existente) y referirse a los módulos/áreas/repos reales del mapa; en suggestedRepos refleja los repos REALES ya analizados.'
    : '';
  return `Eres un Tech Lead senior. Con TODO el contexto de la conversación y los adjuntos, genera un plan de entrega accionable.${codeMapBlock(codeContext)}
Llama a la herramienta EmitPlan con:
- improvedIdea: la idea afinada (2-5 frases).
- sprints: ordenados; cada uno con name, goal y tasks.
- Cada task: title; description; acceptanceCriteria (checklist markdown o Dado/Cuando/Entonces); estimate (rango "junior–senior"); estimateBySeniority ({junior, semiSenior, senior}); category (infra|backend|frontend|design|qa|devops|docs|other); recommendedRoles (perfiles); priority (LOW|MEDIUM|HIGH|URGENT); kind (TASK|STORY|EPIC|BUG|SPIKE); repo (nombre del repo objetivo, uno de suggestedRepos).
- suggestedRepos: los repos/aplicativos del proyecto (backend, frontend, infra, etc.) con name, kind, stack y reason. Un proyecto puede tener VARIOS.
${estimateGuidance()}
Reglas: realista y específico al dominio; **asigna a CADA HU su repo objetivo en \`repo\`** (uno de los name de suggestedRepos, según su área/categoría); usa los adjuntos (imágenes/documentos/enlaces) como contexto; todo el texto del plan en ${langName(lang)}.${brownfieldRule} Llama SOLO a la herramienta.`;
}

function textOf(resp: Anthropic.Messages.Message): string {
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Strip collaboration-only fields (authorId/authorName/context) before sending
 *  ChatMsg[] to the Anthropic API, which rejects any keys beyond {role, content}
 *  ("Extra inputs are not permitted"). Exported for testing. */
export function toApiMessages(messages: ChatMsg[]): { role: 'user' | 'assistant'; content: string }[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

/** One chat turn (or the opening greeting when `messages` is empty). */
export async function planChatReply(
  project: { name: string; description: string | null },
  messages: ChatMsg[],
  lang: Lang,
  attachmentManifest: string,
  userId: string,
  projectId: string,
  codeContext?: string,
  persona?: { name: string; system: string; model?: string | null },
): Promise<string> {
  const model = pickModel(env().AI_MODEL_BALANCED, persona?.model);
  const lead =
    brief(project.name, project.description) +
    (attachmentManifest ? `\n\nContexto adjunto:\n${attachmentManifest}` : '') +
    (messages.length === 0 ? ' Inicia la planeación: salúdame brevemente y hazme la primera pregunta clave.' : '');
  const resp = await client().messages.create({
    model,
    max_tokens: 700,
    system: persona
      ? `${chatSystem(lang, codeContext)}\n\n${persona.system}\nFirmá tus respuestas con tu criterio de especialista; no repitas tu nombre en el texto.`
      : chatSystem(lang, codeContext),
    messages: [{ role: 'user', content: lead }, ...toApiMessages(messages)],
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
  codeContext?: string,
  existingStories?: string,
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
        (existingStories
          ? `\n\nEl tablero YA tiene estas HUs publicadas — NO las repitas ni propongas variantes de lo mismo. ` +
            `Generá SOLO las HUs NUEVAS/incrementales que surgen de la conversación reciente:\n${existingStories}`
          : '') +
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
    // Un plan real (5+ sprints con HUs detalladas) supera con holgura los 8k
    // tokens: con el techo corto el tool input llega truncado y el schema
    // (sprints default []) lo tragaba como plan READY vacío.
    max_tokens: 32000,
    system: genSystem(lang, codeContext),
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
      ...toApiMessages(messages),
      { role: 'user', content: finalBlocks },
    ],
  });
  await record('plan.generate', model, resp.usage, userId, projectId);

  if (resp.stop_reason === 'max_tokens') {
    throw new Error(
      'El plan quedó truncado por límite de tokens del modelo — reintenta (o simplifica el contexto)',
    );
  }
  const toolUse = resp.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'EmitPlan',
  );
  if (!toolUse) throw new Error('El modelo no devolvió un plan estructurado');
  const plan = generatedPlanSchema.parse(toolUse.input);
  if (plan.sprints.reduce((n, s) => n + s.tasks.length, 0) === 0) {
    // Nunca guardar como READY un plan sin trabajo: es señal de output inválido.
    throw new Error('El modelo devolvió un plan sin tareas — reintenta la generación');
  }
  return plan;
}

function refineSystem(lang: Lang): string {
  return `Eres un Tech Lead senior afinando UNA historia de usuario (HU) de un plan ya generado.
Mejórala manteniéndola consistente con la idea del proyecto, su sprint y las demás HUs.
Reglas:
- Responde llamando SOLO a la herramienta EmitTask con la versión mejorada de ESTA HU.
- Conserva los campos: title, description, acceptanceCriteria (checklist markdown o Dado/Cuando/Entonces),
  estimate (rango "junior–senior"), estimateBySeniority ({junior, semiSenior, senior}),
  category (infra|backend|frontend|design|qa|devops|docs|other),
  recommendedRoles, priority (LOW|MEDIUM|HIGH|URGENT), kind (TASK|STORY|EPIC|BUG|SPIKE).
- Aplica la instrucción de enfoque del usuario si la hay; si no, hazla más clara, accionable y bien estimada.
- ${estimateGuidance()}
- Todo el texto en ${langName(lang)}.`;
}

/** Re-analyze / refine a SINGLE task within the generated plan (Opus, forced tool-use). */
export async function refinePlanTask(
  project: { name: string; description: string | null },
  improvedIdea: string,
  sprint: { name: string; goal: string; siblingTitles: string[] },
  task: PlanTask,
  focusNote: string,
  lang: Lang,
  userId: string,
  projectId: string,
): Promise<PlanTask> {
  const model = env().AI_MODEL_DEEP;
  const context =
    `${brief(project.name, project.description)}\n` +
    (improvedIdea ? `Idea afinada: ${improvedIdea}\n` : '') +
    `Sprint: "${sprint.name}"${sprint.goal ? ` — ${sprint.goal}` : ''}.\n` +
    (sprint.siblingTitles.length
      ? `Otras HUs del sprint: ${sprint.siblingTitles.map((t) => `"${t}"`).join(', ')}.\n`
      : '') +
    `HU actual (JSON): ${JSON.stringify(task)}\n` +
    (focusNote.trim()
      ? `Instrucción de enfoque del usuario: ${focusNote.trim()}`
      : 'Sin instrucción específica: mejórala (criterios SMART, estimación realista, alcance claro).');

  const resp = await client().messages.create({
    model,
    max_tokens: 2000,
    system: refineSystem(lang),
    tools: [
      {
        name: 'EmitTask',
        description: 'Emit the improved version of this single user story.',
        input_schema: PLAN_TASK_TOOL_SCHEMA as unknown as Anthropic.Messages.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'EmitTask' },
    messages: [{ role: 'user', content: context }],
  });
  await record('plan.refine', model, resp.usage, userId, projectId);

  const toolUse = resp.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'EmitTask',
  );
  if (!toolUse) throw new Error('El modelo no devolvió la HU refinada');
  return planTaskSchema.parse(toolUse.input);
}

export interface ImplRepoFile {
  path: string;
  content: string;
  language?: string | null;
  truncated?: boolean;
}

/** Audiencia del plan: 'human' (desarrollador en el editor con MCP) o 'agent'
 *  (agente Dev autónomo, cuyo único toolset es leer/buscar/escribir archivos del
 *  repo clonado — sin MCP ni gestión de tareas). */
export type ImplPlanAudience = 'human' | 'agent';

function implSystem(lang: Lang, audience: ImplPlanAudience = 'human'): string {
  if (audience === 'agent') {
    // Para el Dev autónomo: enfocado en cambios de código concretos, sin la guía
    // MCP/gestión-de-tareas (herramientas que el agente NO tiene en su loop).
    return `Eres un Staff Engineer. Escribe un PLAN DE IMPLEMENTACIÓN conciso y accionable, en Markdown, para UNA historia de usuario (HU). El plan lo EJECUTARÁ un AGENTE DE CODING AUTÓNOMO cuyo ÚNICO toolset es leer, buscar y ESCRIBIR archivos del repositorio ya clonado (no tiene MCP, ni gestión de tareas, ni acceso a internet). Sé directo: el agente va a editar archivos y correr tests, nada más.
Estructura (usa encabezados Markdown):
1. Resumen — qué se construye, en 2-3 frases.
2. Archivos a tocar — lista \`ruta\` → qué cambio exacto. Usa RUTAS REALES del repo provisto; no inventes.
3. Cambios concretos — por archivo, describe la edición precisa (funciones/ramas/estructuras a agregar o modificar), mencionando módulos/funciones reales del repo. Suficiente para que el agente escriba el código sin adivinar.
4. Pruebas — qué archivo(s) de test tocar y qué casos cubrir; reusa el stack de pruebas del repo.
5. Riesgos — qué NO romper (comportamiento existente a preservar).
Reglas: NADA de gestión de tareas, MCP, ni pasos de proceso — solo el cambio técnico. Específico al repositorio real (usa el árbol y los archivos provistos). Cambios mínimos, sin refactors colaterales. TODO en ${langName(lang)}. Devuelve SOLO el Markdown del plan, sin vallas de código alrededor del documento.`;
  }
  return `Eres un Staff Engineer. Escribe un PLAN DE IMPLEMENTACIÓN accionable, en Markdown, para UNA historia de usuario (HU). El plan lo EJECUTARÁ un desarrollador con el modelo Qwen (coding) + el MCP de Axon, leyendo el repositorio real que se te entrega.
Estructura (usa encabezados Markdown):
1. Resumen — qué se construye y por qué (2-4 frases).
2. Archivos a tocar — lista \`ruta\` → cambio/razón. Usa RUTAS REALES del repo provisto; no inventes.
3. Pasos de implementación — numerados, concretos y en orden; menciona módulos/funciones reales del repo.
4. Cómo ejecutarlo con Qwen + MCP — qué herramientas MCP usar (\`recall\`, \`grep_repo\`, \`list_repo_tree\`, \`pull_project_brain\`, \`create_task\`, \`update_task_status\`, \`cite_memory\`) y prompts sugeridos para guiar a Qwen.
5. Pruebas — qué probar y cómo (reusa el stack de pruebas del repo si se ve).
6. Riesgos y consideraciones.
7. Estimación — tiempo asumiendo desarrollo asistido por IA (Axon + Qwen vía MCP), realista (incluye revisión, pruebas e integración).
Reglas: específico al repositorio real (usa el árbol y los archivos provistos); conciso pero completo; TODO en ${langName(lang)}. Devuelve SOLO el Markdown del plan, sin texto adicional ni vallas de código alrededor del documento.`;
}

/** Generate a downloadable implementation-plan markdown for ONE story, grounded
 *  in the project's repository (Opus). Repo outline + files are prepared by the caller. */
export async function generateImplementationPlan(
  project: { name: string; description: string | null },
  task: PlanTask,
  sprint: { name: string; goal: string },
  improvedIdea: string,
  repoOutline: string,
  repoFiles: ImplRepoFile[],
  lang: Lang,
  userId: string,
  projectId: string,
  audience: ImplPlanAudience = 'human',
): Promise<string> {
  const model = env().AI_MODEL_DEEP;
  const filesText = repoFiles.length
    ? repoFiles
        .map(
          (f) =>
            `### \`${f.path}\`${f.truncated ? ' (truncado)' : ''}\n\`\`\`${f.language ?? ''}\n${f.content}\n\`\`\``,
        )
        .join('\n\n')
    : '(sin archivos del repositorio incluidos)';

  const user =
    `${brief(project.name, project.description)}\n` +
    (improvedIdea ? `Idea afinada del proyecto: ${improvedIdea}\n` : '') +
    `Sprint: "${sprint.name}"${sprint.goal ? ` — ${sprint.goal}` : ''}.\n\n` +
    `## Historia de usuario\n${JSON.stringify(task, null, 2)}\n\n` +
    `## Árbol del repositorio (parcial)\n${repoOutline}\n\n` +
    `## Archivos del repositorio\n${filesText}`;

  const resp = await client().messages.create({
    model,
    max_tokens: 4500,
    system: implSystem(lang, audience),
    messages: [{ role: 'user', content: user }],
  });
  await record('plan.implplan', model, resp.usage, userId, projectId);
  const md = textOf(resp);
  if (!md) throw new Error('El modelo no devolvió el plan de implementación');
  return md;
}

/** Generate QA test cases for ONE story from its title/description/acceptance
 *  criteria (+ optional developer handoff), for the QA reviewer (Opus, tool-use). */
export async function generateQaTests(
  story: { title: string; description: string; acceptanceCriteria: string; handoffContext?: string },
  lang: Lang,
  userId: string,
  projectId: string,
): Promise<QaTestCaseAI[]> {
  const model = env().AI_MODEL_DEEP;
  const system = `Eres un ingeniero de QA senior. A partir de la historia de usuario y sus criterios de aceptación, escribe CASOS DE PRUEBA de QA concretos y verificables (camino feliz, casos borde, validaciones y errores). Cada caso: title (qué verifica), steps (pasos para ejecutarlo) y expected (resultado esperado). Cubre TODOS los criterios de aceptación. Todo en ${langName(lang)}. Devuelve SOLO la herramienta EmitQaTests.`;

  const user =
    `## Historia de usuario\n${story.title}\n\n${story.description || '(sin descripción)'}\n\n` +
    `## Criterios de aceptación\n${story.acceptanceCriteria || '(no especificados)'}\n` +
    (story.handoffContext ? `\n## Contexto del desarrollador (cierre de HU)\n${story.handoffContext}\n` : '');

  const resp = await client().messages.create({
    model,
    max_tokens: 3000,
    system,
    tools: [
      {
        name: 'EmitQaTests',
        description: 'Emit QA test cases for the story.',
        input_schema: QA_TESTS_TOOL_SCHEMA as unknown as Anthropic.Messages.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'EmitQaTests' },
    messages: [{ role: 'user', content: user }],
  });
  await record('plan.qatests', model, resp.usage, userId, projectId);

  const toolUse = resp.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'EmitQaTests',
  );
  if (!toolUse) throw new Error('El modelo no devolvió las pruebas de QA');
  return qaTestsResultSchema.parse(toolUse.input).tests;
}

export interface StoryRefinement {
  description: string;
  acceptanceCriteria: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
}

const REFINE_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string', description: 'Descripción clara (valor + alcance), 2-5 frases.' },
    acceptanceCriteria: { type: 'string', description: 'Markdown: 3-8 ítems "- [ ] ..." verificables (Given/When/Then).' },
    priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
  },
  required: ['description', 'acceptanceCriteria', 'priority'],
} as const;

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

/**
 * Refina UNA HU para que cumpla la Definition of Ready: descripción clara +
 * criterios de aceptación verificables + prioridad. Es el rol del Product Owner
 * (agente Iris). Preserva la intención original; no inventa alcance nuevo.
 */
export async function refineStoryForReadiness(
  story: { title: string; description: string; acceptanceCriteria: string; priority: string },
  project: { name: string; description: string | null },
  lang: Lang,
  userId: string,
  projectId: string,
  modelOverride?: string | null,
): Promise<StoryRefinement> {
  const model = pickModel(env().AI_MODEL_DEEP, modelOverride);
  const system = `Eres el Product Owner (PO) del equipo. Refiná UNA historia de usuario para que cumpla la Definition of Ready (DoR).
Reglas:
- description: 2-5 frases claras y accionables; CONSERVA la intención y el alcance original, no inventes features nuevas.
- acceptanceCriteria: markdown con 3-8 ítems "- [ ] ..." VERIFICABLES (Given/When/Then o checklist comprobable por QA). Si la HU ya trae criterios, mejorálos sin perder ninguno.
- priority: LOW/MEDIUM/HIGH/URGENT según valor y urgencia; si dudás, MEDIUM.
Todo en ${langName(lang)}. Devuelve SOLO la herramienta EmitRefinement.`;
  const user =
    `${brief(project.name, project.description)}\n\n` +
    `## Historia de usuario a refinar\n` +
    `Título: ${story.title}\n` +
    `Descripción: ${story.description || '(vacía)'}\n` +
    `Criterios actuales: ${story.acceptanceCriteria || '(ninguno)'}\n` +
    `Prioridad actual: ${story.priority}`;

  const resp = await client().messages.create({
    model,
    max_tokens: 1500,
    system,
    tools: [
      {
        name: 'EmitRefinement',
        description: 'Emite la HU refinada (descripción, criterios de aceptación, prioridad).',
        input_schema: REFINE_TOOL_SCHEMA as unknown as Anthropic.Messages.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'EmitRefinement' },
    messages: [{ role: 'user', content: user }],
  });
  await record('plan.refine', model, resp.usage, userId, projectId);

  const toolUse = resp.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'EmitRefinement',
  );
  if (!toolUse) throw new Error('El modelo no devolvió el refinamiento');
  const out = toolUse.input as { description?: string; acceptanceCriteria?: string; priority?: string };
  const priority = (PRIORITIES as readonly string[]).includes(out.priority ?? '')
    ? (out.priority as StoryRefinement['priority'])
    : 'MEDIUM';
  return {
    description: (out.description ?? story.description ?? '').trim(),
    acceptanceCriteria: (out.acceptanceCriteria ?? '').trim(),
    priority,
  };
}

const DESIGN_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    notes: {
      type: 'string',
      description:
        'Notas de diseño en markdown, IMPLEMENTABLES por el Dev: layout/estructura, componentes y jerarquía, estados (vacío/carga/error/éxito), accesibilidad (roles/labels/contraste/foco), responsive (breakpoints), y microcopy clave. Concreto, no genérico.',
    },
    mockupPrompt: {
      type: 'string',
      description:
        'Prompt en INGLÉS, detallado, para gpt-image-1: renderiza un mockup de concepto de alta fidelidad de la pantalla/componente (estilo UI limpio, etiquetas legibles). Describe layout, colores, tipografía y estado principal. Sin texto lorem ipsum.',
    },
  },
  required: ['notes', 'mockupPrompt'],
} as const;

export interface DesignSpec {
  notes: string;
  mockupPrompt: string;
}

/**
 * Genera el spec de diseño de UNA HU de UI: notas implementables + un prompt de
 * mockup para gpt-image-1. Es el rol del agente Diseño (Aria). No escribe código;
 * produce el norte visual + las notas contra las que el Dev implementa.
 */
export async function generateDesignSpec(
  story: { title: string; description: string; acceptanceCriteria: string },
  project: { name: string; description: string | null },
  lang: Lang,
  userId: string,
  projectId: string,
  modelOverride?: string | null,
): Promise<DesignSpec> {
  const model = pickModel(env().AI_MODEL_DEEP, modelOverride);
  const system = `Eres Aria, diseñadora de producto (UI/UX) del equipo. Para UNA historia de usuario de interfaz, producí un spec de diseño accionable.
Reglas:
- notes: markdown IMPLEMENTABLE (layout, componentes+jerarquía, estados vacío/carga/error/éxito, accesibilidad, responsive, microcopy). Concreto y consistente; nada genérico.
- mockupPrompt: en INGLÉS, describe un mockup de concepto de alta fidelidad de la pantalla/componente para un generador de imágenes. Layout, colores, tipografía y el estado principal. Etiquetas legibles, sin lorem ipsum.
Alineate con la intención de la HU; no inventes alcance nuevo. Las notas en ${langName(lang)}. Devuelve SOLO la herramienta EmitDesign.`;
  const user =
    `${brief(project.name, project.description)}\n\n` +
    `## Historia de usuario (UI)\n` +
    `Título: ${story.title}\n` +
    `Descripción: ${story.description || '(vacía)'}\n` +
    `Criterios de aceptación:\n${story.acceptanceCriteria || '(ninguno)'}`;

  const resp = await client().messages.create({
    model,
    // Las notas de diseño son extensas; con poco cap el tool_use se trunca antes
    // de emitir `mockupPrompt` y el spec queda incompleto.
    max_tokens: 4000,
    system,
    tools: [
      {
        name: 'EmitDesign',
        description: 'Emite el spec de diseño (notas implementables + prompt de mockup).',
        input_schema: DESIGN_TOOL_SCHEMA as unknown as Anthropic.Messages.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'EmitDesign' },
    messages: [{ role: 'user', content: user }],
  });
  await record('plan.design', model, resp.usage, userId, projectId);

  const toolUse = resp.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'EmitDesign',
  );
  if (!toolUse) throw new Error('El modelo no devolvió el spec de diseño');
  const out = toolUse.input as { notes?: string; mockupPrompt?: string };
  const notes = (out.notes ?? '').trim();
  // Las notas son lo esencial (implementables). Si el prompt del mockup falta,
  // sintetizamos uno básico desde la HU en vez de fallar todo el spec.
  const mockupPrompt =
    (out.mockupPrompt ?? '').trim() ||
    `High-fidelity concept mockup for the UI story "${story.title}". Clean modern UI, legible labels, primary state. ${story.description}`.slice(0, 900);
  if (!notes) throw new Error('Spec de diseño incompleto');
  return { notes, mockupPrompt };
}

const TECH_DESIGN_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    design: {
      type: 'string',
      description:
        'Diseño técnico en markdown para una HU compleja, para el Dev: enfoque de arquitectura, decisiones clave (con alternativas descartadas y por qué), componentes/módulos afectados, contratos/datos, riesgos y mitigaciones, y una DESCOMPOSICIÓN sugerida en pasos/sub-tareas ordenados. Concreto y accionable; no escribas código completo.',
    },
  },
  required: ['design'],
} as const;

/**
 * Genera el diseño técnico de UNA HU compleja: enfoque de arquitectura +
 * decisiones + riesgos + descomposición. Es el rol del Arquitecto/Tech Lead
 * (agente Dax). Guía de alto nivel ANTES de que el Dev implemente; no escribe
 * código. Distinto del impl-plan (que es el plan concreto por archivo del Dev).
 */
export async function generateTechDesign(
  story: { title: string; description: string; acceptanceCriteria: string; priority: string },
  project: { name: string; description: string | null },
  lang: Lang,
  userId: string,
  projectId: string,
  modelOverride?: string | null,
): Promise<string> {
  const model = pickModel(env().AI_MODEL_DEEP, modelOverride);
  const system = `Eres Dax, arquitecto/tech lead del equipo. Para UNA historia de usuario compleja, producí un diseño técnico de ALTO NIVEL que guíe al Dev (no escribas la implementación completa).
Incluí: enfoque de arquitectura, decisiones clave (y alternativas descartadas con el porqué), componentes/módulos y contratos/datos afectados, riesgos + mitigaciones, y una DESCOMPOSICIÓN en pasos/sub-tareas ordenados.
Alineate con la intención de la HU; no inventes alcance nuevo. Todo en ${langName(lang)}. Devuelve SOLO la herramienta EmitTechDesign.`;
  const user =
    `${brief(project.name, project.description)}\n\n` +
    `## Historia de usuario (compleja)\n` +
    `Título: ${story.title}\n` +
    `Descripción: ${story.description || '(vacía)'}\n` +
    `Prioridad: ${story.priority}\n` +
    `Criterios de aceptación:\n${story.acceptanceCriteria || '(ninguno)'}`;

  const resp = await client().messages.create({
    model,
    max_tokens: 3000,
    system,
    tools: [
      {
        name: 'EmitTechDesign',
        description: 'Emite el diseño técnico (arquitectura + decisiones + riesgos + descomposición).',
        input_schema: TECH_DESIGN_TOOL_SCHEMA as unknown as Anthropic.Messages.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'EmitTechDesign' },
    messages: [{ role: 'user', content: user }],
  });
  await record('plan.tech_design', model, resp.usage, userId, projectId);

  const toolUse = resp.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'EmitTechDesign',
  );
  if (!toolUse) throw new Error('El modelo no devolvió el diseño técnico');
  const out = (toolUse.input as { design?: string }).design?.trim() ?? '';
  if (!out) throw new Error('Diseño técnico vacío');
  return out;
}

const MARKETING_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    kit: {
      type: 'string',
      description:
        'Kit de marketing en markdown: headline + subhead, 3-5 value props, CTA, meta título SEO (≤60 chars) + meta descripción (≤155 chars), 2-3 posts sociales cortos, y sugerencias de nombre/tagline si aplica. Persuasivo pero honesto; sin promesas vacías.',
    },
    assetPrompt: {
      type: 'string',
      description:
        'Prompt en INGLÉS para gpt-image-1: un asset visual de marca/hero para la landing (estilo limpio, moderno, coherente con el producto). Describe estilo, colores, composición. Sin texto lorem ipsum.',
    },
  },
  required: ['kit', 'assetPrompt'],
} as const;

export interface MarketingKit {
  kit: string;
  assetPrompt: string;
}

/**
 * Genera el kit de go-to-market de UNA HU de marketing: copy de landing + SEO +
 * social + un prompt de asset de marca para gpt-image-1. Es el rol de Branding
 * (agente Sol). No escribe código; produce material de lanzamiento.
 */
export async function generateMarketingKit(
  story: { title: string; description: string; acceptanceCriteria: string },
  project: { name: string; description: string | null },
  lang: Lang,
  userId: string,
  projectId: string,
  modelOverride?: string | null,
): Promise<MarketingKit> {
  const model = pickModel(env().AI_MODEL_DEEP, modelOverride);
  const system = `Eres Sol, especialista de branding/SEO/marketing del equipo. Para UNA historia de usuario de go-to-market, producí material de lanzamiento.
- kit: markdown con headline+subhead, 3-5 value props, CTA, meta título SEO (≤60) + meta descripción (≤155), 2-3 posts sociales cortos, y nombre/tagline si aplica. Persuasivo pero honesto, sin promesas vacías.
- assetPrompt: en INGLÉS, para un generador de imágenes, un asset de marca/hero de la landing (estilo limpio y moderno, coherente con el producto).
Alineate con el producto real; no inventes features. El kit en ${langName(lang)}. Devuelve SOLO la herramienta EmitMarketing.`;
  const user =
    `${brief(project.name, project.description)}\n\n` +
    `## Historia de usuario (marketing)\n` +
    `Título: ${story.title}\n` +
    `Descripción: ${story.description || '(vacía)'}\n` +
    `Criterios:\n${story.acceptanceCriteria || '(ninguno)'}`;

  const resp = await client().messages.create({
    model,
    max_tokens: 3000,
    system,
    tools: [
      {
        name: 'EmitMarketing',
        description: 'Emite el kit de marketing (copy + SEO + social) y el prompt del asset de marca.',
        input_schema: MARKETING_TOOL_SCHEMA as unknown as Anthropic.Messages.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'EmitMarketing' },
    messages: [{ role: 'user', content: user }],
  });
  await record('plan.marketing', model, resp.usage, userId, projectId);

  const toolUse = resp.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'EmitMarketing',
  );
  if (!toolUse) throw new Error('El modelo no devolvió el kit de marketing');
  const out = toolUse.input as { kit?: string; assetPrompt?: string };
  const kit = (out.kit ?? '').trim();
  if (!kit) throw new Error('Kit de marketing vacío');
  const assetPrompt =
    (out.assetPrompt ?? '').trim() ||
    `Clean modern brand hero image for "${project.name}". ${story.title}. Minimal, professional.`.slice(0, 900);
  return { kit, assetPrompt };
}

export interface ReestimateItemInput {
  s: number;
  t: number;
  title: string;
  description: string;
  category: string;
  repo: string;
}

/** Batch-recompute per-seniority AI-assisted estimates for an existing plan's
 *  HUs in one Opus call (output keyed by sprint/task index). */
export async function reestimatePlan(
  context: { projectName: string; description: string | null; improvedIdea: string; stack: string },
  items: ReestimateItemInput[],
  lang: Lang,
  userId: string,
  projectId: string,
): Promise<ReestimateItem[]> {
  if (items.length === 0) return [];
  const model = env().AI_MODEL_DEEP;
  const system = `Eres un Tech Lead senior. Recalcula las estimaciones de las HUs dadas.
${estimateGuidance()}
Devuelve SOLO la herramienta EmitEstimates con un item por cada HU recibida (identificada por s y t), con estimateBySeniority {junior, semiSenior, senior} y estimate (rango). Todo en ${langName(lang)}.`;

  const user =
    `${brief(context.projectName, context.description)}\n` +
    (context.improvedIdea ? `Idea afinada: ${context.improvedIdea}\n` : '') +
    (context.stack ? `Stack / repos: ${context.stack}\n` : '') +
    `\nHUs a estimar (JSON):\n${JSON.stringify(
      items.map((i) => ({
        s: i.s,
        t: i.t,
        title: i.title,
        description: i.description.slice(0, 300),
        category: i.category,
        repo: i.repo,
      })),
    )}`;

  const resp = await client().messages.create({
    model,
    max_tokens: 8000,
    system,
    tools: [
      {
        name: 'EmitEstimates',
        description: 'Emit per-seniority estimates keyed by sprint/task index.',
        input_schema: REESTIMATE_TOOL_SCHEMA as unknown as Anthropic.Messages.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'EmitEstimates' },
    messages: [{ role: 'user', content: user }],
  });
  await record('plan.reestimate', model, resp.usage, userId, projectId);

  const toolUse = resp.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'EmitEstimates',
  );
  if (!toolUse) throw new Error('El modelo no devolvió las estimaciones');
  return reestimateResultSchema.parse(toolUse.input).items;
}

function seniorityLabel(s: string): string {
  if (s === 'JUNIOR') return 'junior';
  if (s === 'SENIOR') return 'senior';
  return 'semi-senior';
}

/** Recompute a single AI-assisted estimate for a given seniority profile using
 *  the self-hosted Qwen model. Returns a short duration string (e.g. "4h"). */
export async function estimateTaskForSeniority(
  task: { title: string; description: string; category: string; repo: string },
  context: { stack: string; improvedIdea: string },
  seniority: string,
  lang: Lang,
): Promise<string> {
  const label = seniorityLabel(seniority);
  const system = `Eres un Tech Lead. Estima el tiempo de desarrollo para que un desarrollador ${label} implemente la HU en NUESTRO stack CON apoyo del modelo Qwen (lee el repo, genera código y ejecuta tareas) siguiendo el plan de trabajo. Incluye revisión humana, pruebas e integración. Responde SOLO con una duración corta ("4h", "1d", "3 pts"), sin ninguna otra palabra. Idioma: ${langName(lang)}.`;
  const user =
    `HU: ${task.title}\n${task.description}\n` +
    `Área: ${task.category}${task.repo ? ` · repo: ${task.repo}` : ''}\n` +
    (context.improvedIdea ? `Idea: ${context.improvedIdea}\n` : '') +
    (context.stack ? `Stack: ${context.stack}` : '');
  const raw = await infraChat(system, user, { maxTokens: 24, timeoutMs: 30_000 });
  const line = (raw.trim().split(/\n/)[0] ?? '').trim();
  const m = line.match(/\d+(?:[.,]\d+)?\s*(?:h|hr?s?|d|d[ií]as?|sem(?:ana)?s?|w|pts?|sp)\b/i);
  return (m ? m[0] : line).slice(0, 16);
}
