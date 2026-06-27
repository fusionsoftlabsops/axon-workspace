import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextGraph } from './build';

const ai = vi.hoisted(() => ({ infraChat: vi.fn() }));
vi.mock('@/lib/ai/infra-llm', () => ai);

import { describeProject, describeTask, summarizeGraph } from './summary';

beforeEach(() => {
  vi.clearAllMocks();
});

function graph(): ContextGraph {
  return {
    nodes: [
      { id: 'sprint:s1', type: 'sprint', label: 'Sprint 1' },
      {
        id: 'task:t1',
        type: 'task',
        label: 'Parent',
        taskNumber: 1,
        kind: 'STORY',
        priority: 'HIGH',
        category: 'backend',
        stateName: 'Done',
        stateCategory: 'DONE',
        done: true,
      },
      {
        id: 'task:t2',
        type: 'task',
        label: 'Child',
        taskNumber: 2,
        kind: 'STORY',
        priority: 'LOW',
        category: null,
        stateName: 'In progress',
        stateCategory: 'IN_PROGRESS',
        done: false,
      },
      { id: 'memory:m1', type: 'memory', label: 'Use X', memoryType: 'DECISION', citationCount: 3 },
    ],
    edges: [
      { source: 'sprint:s1', target: 'task:t1', kind: 'sprint' },
      { source: 'task:t1', target: 'task:t2', kind: 'subtask' },
      { source: 'task:t1', target: 'task:t2', kind: 'dependency', label: 'BLOCKS' },
      { source: 'task:t1', target: 'memory:m1', kind: 'source' },
      { source: 'memory:m1', target: 'task:t2', kind: 'cites' },
    ],
  };
}

describe('describeProject', () => {
  it('summarizes sprints, task counts, deps and memories', () => {
    const out = describeProject(graph());
    expect(out).toContain('Sprints: 1 — Sprint 1.');
    expect(out).toContain('Tasks: 2 (done 1, in-progress 1, blocked 0, review 0, open 0).');
    expect(out).toContain('Dependencies between tasks: 1.');
    expect(out).toContain('#1 Parent (backend)');
    expect(out).toContain('(DECISION) Use X ·cited 3×');
  });

  it('renders placeholders when there are no sprints/tasks/memories', () => {
    const out = describeProject({ nodes: [], edges: [] });
    expect(out).toContain('Sprints: 0 — —.');
    expect(out).toContain('Tasks: 0');
    expect(out).toContain('—');
  });

  it('adds a "+N more" marker beyond the task line cap', () => {
    const nodes = Array.from({ length: 65 }, (_, i) => ({
      id: `task:t${i}`,
      type: 'task' as const,
      label: `T${i}`,
      taskNumber: i,
      stateCategory: 'OPEN',
      stateName: 'Open',
    }));
    const out = describeProject({ nodes, edges: [] });
    expect(out).toContain('(+5 more)');
  });
});

describe('describeTask', () => {
  it('returns empty string when the focus task is missing', () => {
    expect(describeTask(graph(), 'nope')).toBe('');
  });

  it('describes the focus story with sprint, subtasks, deps and knowledge', () => {
    const out = describeTask(graph(), 't1');
    expect(out).toContain('Story #1 "Parent".');
    expect(out).toContain('Sprint: Sprint 1.');
    expect(out).toContain('Subtasks: Child.');
    expect(out).toContain('Outgoing deps: BLOCKS → Child.');
    expect(out).toContain('Related knowledge: Use X.');
  });

  it('handles a focus with no sprint/parent and shows the blocked-by side', () => {
    const out = describeTask(graph(), 't2');
    expect(out).toContain('Story #2 "Child".');
    expect(out).toContain('Sprint: —.');
    expect(out).toContain('Blocked by / related: Parent (BLOCKS).');
  });
});

describe('summarizeGraph', () => {
  it('delegates a PROJECT brief to infraChat (es)', async () => {
    ai.infraChat.mockResolvedValue('resumen');
    const out = await summarizeGraph(graph(), 'PROJECT', 'es');
    expect(out).toBe('resumen');
    const [system, brief, opts] = ai.infraChat.mock.calls[0]!;
    expect(system).toContain('español');
    expect(brief).toContain('Sprints: 1');
    expect(opts).toMatchObject({ maxTokens: 600 });
  });

  it('delegates a TASK brief to infraChat (en) with the focus task', async () => {
    ai.infraChat.mockResolvedValue('summary');
    const out = await summarizeGraph(graph(), 'TASK', 'en', 't1');
    expect(out).toBe('summary');
    const [system, , opts] = ai.infraChat.mock.calls[0]!;
    expect(system).toContain('inglés');
    expect(opts).toMatchObject({ maxTokens: 400 });
  });

  it('throws when the brief is empty (no data)', async () => {
    await expect(summarizeGraph({ nodes: [], edges: [] }, 'TASK', 'es', 'missing')).rejects.toThrow(
      /Sin datos/,
    );
    expect(ai.infraChat).not.toHaveBeenCalled();
  });
});
