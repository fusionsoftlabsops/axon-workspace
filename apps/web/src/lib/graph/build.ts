/**
 * Context graph — materialized LIVE from existing relations (no separate store),
 * so it stays fresh automatically as HUs/tasks progress:
 *   nodes  = Sprint · Task (HU) · BrainMemory (project-scoped)
 *   edges  = sprint membership · subtask · task dependency · memory citation · memory source
 *
 * As a task enters a DONE state the existing brain extractor adds memories +
 * citation/source edges, so completing work visibly enriches the graph.
 */
import { prisma } from '@/lib/db';

export type GraphNodeType = 'sprint' | 'task' | 'memory';
export type GraphEdgeKind = 'sprint' | 'subtask' | 'dependency' | 'cites' | 'source';

export interface GraphNode {
  id: string; // prefixed id: `sprint:<id>` | `task:<id>` | `memory:<id>`
  type: GraphNodeType;
  label: string;
  // task-specific
  taskNumber?: number;
  kind?: string;
  priority?: string;
  category?: string | null;
  stateName?: string;
  stateCategory?: string; // OPEN | IN_PROGRESS | BLOCKED | REVIEW | DONE
  done?: boolean;
  // memory-specific
  memoryType?: string;
  citationCount?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: GraphEdgeKind;
  label?: string;
}

export interface ContextGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const T = (id: string) => `task:${id}`;
const S = (id: string) => `sprint:${id}`;
const M = (id: string) => `memory:${id}`;

/** Build the full context graph for a project. */
export async function buildProjectGraph(projectId: string): Promise<ContextGraph> {
  const [sprints, tasks, deps, memories, citations] = await Promise.all([
    prisma.sprint.findMany({
      where: { projectId },
      select: { id: true, name: true, order: true },
      orderBy: { order: 'asc' },
    }),
    prisma.task.findMany({
      where: { projectId },
      select: {
        id: true,
        taskNumber: true,
        title: true,
        kind: true,
        priority: true,
        category: true,
        parentTaskId: true,
        sprintId: true,
        state: { select: { name: true, category: true } },
      },
    }),
    prisma.taskDependency.findMany({
      where: { source: { projectId } },
      select: { sourceTaskId: true, targetTaskId: true, kind: true },
    }),
    prisma.brainMemory.findMany({
      where: { projectId, scope: 'PROJECT', status: 'ACTIVE' },
      select: { id: true, type: true, title: true, citationCount: true, sourceTaskId: true },
    }),
    prisma.memoryCitation.findMany({
      where: { memory: { projectId, scope: 'PROJECT' } },
      select: { memoryId: true, citedInTaskId: true },
    }),
  ]);

  const taskIds = new Set(tasks.map((t) => t.id));
  const memoryIds = new Set(memories.map((m) => m.id));
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const s of sprints) {
    nodes.push({ id: S(s.id), type: 'sprint', label: s.name });
  }
  for (const t of tasks) {
    nodes.push({
      id: T(t.id),
      type: 'task',
      label: t.title,
      taskNumber: t.taskNumber,
      kind: t.kind,
      priority: t.priority,
      category: t.category,
      stateName: t.state?.name,
      stateCategory: t.state?.category,
      done: t.state?.category === 'DONE',
    });
    if (t.sprintId) edges.push({ source: S(t.sprintId), target: T(t.id), kind: 'sprint' });
    if (t.parentTaskId && taskIds.has(t.parentTaskId)) {
      edges.push({ source: T(t.parentTaskId), target: T(t.id), kind: 'subtask' });
    }
  }
  for (const d of deps) {
    if (taskIds.has(d.sourceTaskId) && taskIds.has(d.targetTaskId)) {
      edges.push({ source: T(d.sourceTaskId), target: T(d.targetTaskId), kind: 'dependency', label: d.kind });
    }
  }
  for (const m of memories) {
    nodes.push({
      id: M(m.id),
      type: 'memory',
      label: m.title,
      memoryType: m.type,
      citationCount: m.citationCount,
    });
    if (m.sourceTaskId && taskIds.has(m.sourceTaskId)) {
      edges.push({ source: T(m.sourceTaskId), target: M(m.id), kind: 'source' });
    }
  }
  for (const c of citations) {
    if (memoryIds.has(c.memoryId) && taskIds.has(c.citedInTaskId)) {
      edges.push({ source: M(c.memoryId), target: T(c.citedInTaskId), kind: 'cites' });
    }
  }

  return { nodes, edges };
}

/** Depth-1 subgraph around a single task (its sprint, parent, subtasks,
 *  dependency-linked tasks, and related memories). */
export function focusSubgraph(graph: ContextGraph, taskId: string): ContextGraph {
  const focus = T(taskId);
  if (!graph.nodes.some((n) => n.id === focus)) return { nodes: [], edges: [] };

  const keep = new Set<string>([focus]);
  const edges = graph.edges.filter((e) => e.source === focus || e.target === focus);
  for (const e of edges) {
    keep.add(e.source);
    keep.add(e.target);
  }
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges,
  };
}

/** Cheap change-signature: counts that shift as work progresses, used to decide
 *  whether a cached context summary is stale. */
export function graphSignature(graph: ContextGraph): string {
  const done = graph.nodes.filter((n) => n.type === 'task' && n.done).length;
  const memories = graph.nodes.filter((n) => n.type === 'memory').length;
  return `n${graph.nodes.length}-e${graph.edges.length}-d${done}-m${memories}`;
}
