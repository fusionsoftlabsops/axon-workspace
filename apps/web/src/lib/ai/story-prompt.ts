/**
 * Construye el prompt y el output schema para el generador de HUs.
 *
 * El output del LLM es JSON estructurado con secciones tipadas. La UI lo
 * parsea incrementalmente (con tolerantParse) y emite cada sección al
 * cliente vía SSE en cuanto se "cierra" en el stream.
 */
import { z } from 'zod';
import type { ChatMessage } from './providers/registry';
import type { RepoFile } from '@/lib/repo/reader';

// ---------- Output schema ----------

const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const tolerantPriority = z.preprocess(
  (v) => {
    if (v == null) return undefined;
    if (typeof v === 'string') {
      const norm = v.trim().toUpperCase();
      return norm === '' ? undefined : norm;
    }
    return v;
  },
  priorityEnum.optional(),
);

/**
 * Acepta `string` o `array<string>`; si llega array, se joinea con bullets.
 * El modelo a veces devuelve arrays cuando el prompt menciona "ítems".
 */
const tolerantMarkdown = z.preprocess((v) => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    return v
      .map((item) => {
        if (typeof item === 'string') return item.trim().startsWith('-') ? item : `- ${item}`;
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          const text = obj.text ?? obj.description ?? obj.value ?? obj.criterion ?? JSON.stringify(obj);
          return `- ${String(text)}`;
        }
        return `- ${String(item)}`;
      })
      .join('\n');
  }
  return v;
}, z.string().min(1));

export const subtaskSchema = z.object({
  title: z.string().min(1).max(140),
  description: z.string().max(2000).optional(),
  priority: tolerantPriority.optional(),
});

export const fileToTouchSchema = z.object({
  path: z.string().min(1).max(500),
  reason: z.string().max(500),
});

export const storyOutputSchema = z.object({
  summary: z.string().min(1),
  acceptanceCriteria: tolerantMarkdown,
  technicalContext: tolerantMarkdown,
  subtaskBreakdown: z.array(subtaskSchema).max(10),
  filesToTouch: z.array(fileToTouchSchema).max(20),
  risks: tolerantMarkdown,
});

export type StoryOutput = z.infer<typeof storyOutputSchema>;
export type SubtaskOutput = z.infer<typeof subtaskSchema>;
export type FileToTouchOutput = z.infer<typeof fileToTouchSchema>;

/** JSON Schema legible para Gemini structured output y similares. */
export const STORY_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'acceptanceCriteria',
    'technicalContext',
    'subtaskBreakdown',
    'filesToTouch',
    'risks',
  ],
  properties: {
    summary: { type: 'string' },
    acceptanceCriteria: { type: 'string' },
    technicalContext: { type: 'string' },
    subtaskBreakdown: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        },
      },
    },
    filesToTouch: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'reason'],
        properties: {
          path: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    risks: { type: 'string' },
  },
} as const;

// ---------- Inputs para construir el prompt ----------

export interface BrainMemoryForPrompt {
  id: string;
  type: string;
  title: string;
  body: string;
  tags: string[];
}

export interface StoryPromptInput {
  rawInput: string;
  memories: BrainMemoryForPrompt[];
  repoTreeOutline: string;       // árbol compactado del repo (multi-line text)
  repoFiles: RepoFile[];          // archivos seleccionados (ya truncados)
  projectName: string;
}

const SYSTEM_PROMPT = `Eres un product engineer + tech lead que redacta Historias de Usuario (HU) técnicas accionables para un equipo pequeño.

Tu trabajo: leer (1) el código actual del proyecto, (2) memorias relevantes del cerebro del equipo, (3) una necesidad expresada por el usuario, y producir UNA HU concreta que parta del estado real del proyecto.

REGLAS DE OUTPUT:
- Devuelve SOLO un objeto JSON que cumpla el schema descrito abajo. Sin prefacio, sin code fence, sin texto explicativo.
- Todos los strings en español neutro.
- En \`summary\`: una frase en formato "Como <rol> quiero <acción> para <beneficio>".
- En \`acceptanceCriteria\`: markdown con 4-8 ítems "- [ ] ..." en estilo Given/When/Then o checklist verificable.
- En \`technicalContext\`: máximo 200 palabras. Cita archivos del repo con su ruta tal como aparecen ('apps/web/src/...'). Cita memorias con su id (M-<id>). Sé concreto: nada de "es importante considerar...".
- En \`subtaskBreakdown\`: 3-7 subtareas técnicas ejecutables, con title (≤80 chars) y description (1-2 frases). Asigna \`priority\` solo si la tarea es claramente alta o urgente.
- En \`filesToTouch\`: 2-12 archivos del repo que se van a modificar o crear. \`path\` con la ruta exacta, \`reason\` con 1 frase.
- En \`risks\`: 2-4 ítems markdown con riesgos reales (regresiones, breaking changes, side effects, datos sensibles). Cero verborrea.

REGLAS DE FONDO:
- NO inventes APIs, libs ni rutas que no veas en el repo o memorias.
- Si el código del repo ya implementa parte de lo pedido, la HU debe REFERENCIAR esa parte (no duplicarla).
- Si una memoria recomienda un patrón o advierte de un gotcha aplicable, intégralo y cítalo.
- Si la necesidad del usuario es ambigua, asume lo más conservador (no inventes scope).
`;

export function buildStoryPrompt(input: StoryPromptInput): ChatMessage[] {
  const memorySection = input.memories.length
    ? input.memories
        .map(
          (m) =>
            `### Memoria M-${m.id} · ${m.type} · ${m.title}\nTags: ${m.tags.join(', ') || '—'}\n${truncate(m.body, 800)}`,
        )
        .join('\n\n')
    : 'Sin memorias relevantes.';

  const filesSection = input.repoFiles.length
    ? input.repoFiles
        .map(
          (f) =>
            `### \`${f.path}\`${f.truncated ? ' (truncado)' : ''}\n\`\`\`${f.language ?? ''}\n${f.content}\n\`\`\``,
        )
        .join('\n\n')
    : 'No se incluyeron archivos del repo en el contexto.';

  const userPrompt = [
    `## Proyecto: ${input.projectName}`,
    '',
    '## Necesidad del usuario',
    input.rawInput.trim(),
    '',
    '## Árbol del repositorio (resumen)',
    '```',
    input.repoTreeOutline,
    '```',
    '',
    '## Memorias del cerebro relevantes',
    memorySection,
    '',
    '## Código fuente seleccionado',
    filesSection,
    '',
    '## Output esperado',
    'Genera ahora el JSON de la HU según las reglas del system prompt.',
  ].join('\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/**
 * Convierte una lista de TreeNode (de RepoReader) a un outline ASCII
 * compacto adecuado para meter en el prompt.
 */
export function treeOutline(nodes: Array<{ name: string; kind: 'dir' | 'file'; children?: Array<{ name: string; kind: 'dir' | 'file' }> }>, depth = 0): string {
  const indent = '  '.repeat(depth);
  return nodes
    .map((n) => {
      const head = `${indent}${n.kind === 'dir' ? '├─ ' + n.name + '/' : '│  ' + n.name}`;
      if (n.kind === 'dir' && n.children?.length) {
        return head + '\n' + treeOutline(n.children, depth + 1);
      }
      return head;
    })
    .join('\n');
}

// ---------- Tolerant JSON parser ----------

/**
 * Intenta parsear un JSON parcial — útil mientras el stream del LLM aún
 * no terminó. Si el último objeto/array no está cerrado, se cierra
 * agregando los `}` o `]` necesarios. Devuelve el objeto parseado o null
 * si aún no es válido.
 */
export function tolerantParse(raw: string): Partial<StoryOutput> | null {
  let cleaned = raw.trim();
  // Quitar code fence si el modelo lo agregó
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n([\s\S]*?)(?:```|$)/);
  if (fenceMatch) cleaned = fenceMatch[1]!.trim();

  // Buscar primera `{` y trabajar desde ahí
  const startIdx = cleaned.indexOf('{');
  if (startIdx === -1) return null;
  cleaned = cleaned.slice(startIdx);

  // Intentar parsear tal cual
  try {
    return JSON.parse(cleaned) as Partial<StoryOutput>;
  } catch {
    // Cerrar brackets faltantes
    const closed = closePartialJson(cleaned);
    if (!closed) return null;
    try {
      return JSON.parse(closed) as Partial<StoryOutput>;
    } catch {
      return null;
    }
  }
}

function closePartialJson(s: string): string | null {
  const stack: Array<'{' | '['> = [];
  let inString = false;
  let escape = false;
  let lastValidIdx = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      if (stack.length === 0) return null;
      stack.pop();
    }
    if (stack.length === 0 && (ch === '}' || ch === ']')) {
      lastValidIdx = i;
    }
  }

  // Si stack vacío y ya cerró bien, devolver tal cual hasta el último valido
  if (stack.length === 0 && lastValidIdx >= 0) {
    return s.slice(0, lastValidIdx + 1);
  }

  // Si estamos en mitad de un string, no se puede cerrar de forma segura.
  if (inString) return null;

  // Trim el residuo después del último delimitador balanceado, hasta una coma
  // ahuérfana o un valor incompleto.
  let truncated = s;
  // Quitar trailing comma + cosas raras
  truncated = truncated.replace(/,\s*$/, '');
  truncated = truncated.replace(/:\s*"[^"]*$/, ''); // valor string a medias
  truncated = truncated.replace(/:\s*$/, '');       // key sin valor

  // Cerrar brackets pendientes en orden inverso
  let closing = '';
  for (let i = stack.length - 1; i >= 0; i--) {
    closing += stack[i] === '{' ? '}' : ']';
  }
  return truncated + closing;
}
