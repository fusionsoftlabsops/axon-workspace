/** Turn a context graph into a compact textual brief and ask the self-hosted
 *  infra model to narrate it. Kept bounded so the prompt stays small. */
import { infraChat } from '@/lib/ai/infra-llm';
import type { ContextGraph } from './build';

type Lang = 'es' | 'en';

const MAX_TASK_LINES = 60;
const MAX_MEMO_LINES = 30;

/** Compact, model-friendly description of the whole-project graph. */
export function describeProject(graph: ContextGraph): string {
  const tasks = graph.nodes.filter((n) => n.type === 'task');
  const sprints = graph.nodes.filter((n) => n.type === 'sprint');
  const memories = graph.nodes.filter((n) => n.type === 'memory');

  const byCat = (cat: string) => tasks.filter((t) => t.stateCategory === cat).length;
  const counts = `Tasks: ${tasks.length} (done ${byCat('DONE')}, in-progress ${byCat('IN_PROGRESS')}, blocked ${byCat('BLOCKED')}, review ${byCat('REVIEW')}, open ${byCat('OPEN')}).`;

  const taskLines = tasks
    .slice(0, MAX_TASK_LINES)
    .map((t) => `- [${t.stateName ?? t.stateCategory ?? '?'}] #${t.taskNumber} ${t.label}${t.category ? ` (${t.category})` : ''}`)
    .join('\n');
  const moreTasks = tasks.length > MAX_TASK_LINES ? `\n…(+${tasks.length - MAX_TASK_LINES} more)` : '';

  const deps = graph.edges.filter((e) => e.kind === 'dependency').length;
  const memoLines = memories
    .slice(0, MAX_MEMO_LINES)
    .map((m) => `- (${m.memoryType}) ${m.label}${m.citationCount ? ` ·cited ${m.citationCount}×` : ''}`)
    .join('\n');

  return [
    `Sprints: ${sprints.length} — ${sprints.map((s) => s.label).join(' · ') || '—'}.`,
    counts,
    `Dependencies between tasks: ${deps}.`,
    '',
    'Tasks:',
    taskLines + moreTasks || '—',
    '',
    `Captured knowledge (project memories: ${memories.length}):`,
    memoLines || '—',
  ].join('\n');
}

/** Compact description of a single-HU focus subgraph. */
export function describeTask(graph: ContextGraph, focusTaskId: string): string {
  const focus = graph.nodes.find((n) => n.id === `task:${focusTaskId}`);
  if (!focus) return '';
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;

  const sprintEdge = graph.edges.find((e) => e.kind === 'sprint' && e.target === focus.id);
  const subtasks = graph.edges.filter((e) => e.kind === 'subtask' && e.source === focus.id).map((e) => label(e.target));
  const parent = graph.edges.find((e) => e.kind === 'subtask' && e.target === focus.id);
  const blocks = graph.edges
    .filter((e) => e.kind === 'dependency' && e.source === focus.id)
    .map((e) => `${e.label ?? 'dep'} → ${label(e.target)}`);
  const blockedBy = graph.edges
    .filter((e) => e.kind === 'dependency' && e.target === focus.id)
    .map((e) => `${label(e.source)} (${e.label ?? 'dep'})`);
  const memos = graph.edges
    .filter((e) => (e.kind === 'cites' && e.target === focus.id) || (e.kind === 'source' && e.source === focus.id))
    .map((e) => label(e.kind === 'cites' ? e.source : e.target));

  return [
    `Story #${focus.taskNumber} "${focus.label}".`,
    `Status: ${focus.stateName ?? focus.stateCategory ?? '?'}. Kind: ${focus.kind}. Priority: ${focus.priority}. Category: ${focus.category ?? '—'}.`,
    sprintEdge ? `Sprint: ${label(sprintEdge.source)}.` : 'Sprint: —.',
    parent ? `Parent: ${label(parent.source)}.` : '',
    subtasks.length ? `Subtasks: ${subtasks.join(' · ')}.` : '',
    blocks.length ? `Outgoing deps: ${blocks.join(' · ')}.` : '',
    blockedBy.length ? `Blocked by / related: ${blockedBy.join(' · ')}.` : '',
    memos.length ? `Related knowledge: ${memos.join(' · ')}.` : 'Related knowledge: —.',
  ]
    .filter(Boolean)
    .join('\n');
}

function systemFor(scope: 'PROJECT' | 'TASK', lang: Lang): string {
  const language = lang === 'es' ? 'español' : 'inglés';
  if (scope === 'PROJECT') {
    return `Eres un Tech Lead. Resume el CONTEXTO del proyecto para alguien que se integra: estado actual (qué está hecho vs pendiente), riesgos/dependencias clave y conocimiento capturado. Conciso (≤180 palabras), en ${language}. No inventes; usa solo los datos dados.`;
  }
  return `Eres un Tech Lead. Resume el CONTEXTO de esta historia de usuario: su objetivo, dónde encaja (sprint, dependencias, subtareas), su estado y el conocimiento relacionado. Conciso (≤120 palabras), en ${language}. No inventes; usa solo los datos dados.`;
}

/** Generate a narrative context summary via the self-hosted infra model. */
export async function summarizeGraph(
  graph: ContextGraph,
  scope: 'PROJECT' | 'TASK',
  lang: Lang,
  focusTaskId?: string,
): Promise<string> {
  const brief = scope === 'PROJECT' ? describeProject(graph) : describeTask(graph, focusTaskId ?? '');
  if (!brief.trim()) throw new Error('Sin datos para resumir');
  return infraChat(systemFor(scope, lang), brief, {
    maxTokens: scope === 'PROJECT' ? 600 : 400,
    timeoutMs: 60_000,
  });
}
