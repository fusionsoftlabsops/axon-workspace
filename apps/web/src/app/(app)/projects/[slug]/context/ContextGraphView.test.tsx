import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const act = vi.hoisted(() => ({
  getContextSummaryAction: vi.fn(),
  generateContextSummaryAction: vi.fn(),
}));
vi.mock('@/lib/actions/context', () => act);

import { ContextGraphView } from './ContextGraphView';
import type { ContextGraph } from '@/lib/graph/build';
import type { ContextSummaryView } from '@/lib/actions/context';

const graph: ContextGraph = {
  nodes: [
    {
      id: 'task:1',
      type: 'task',
      label: 'Task one',
      taskNumber: 1,
      kind: 'STORY',
      priority: 'HIGH',
      category: 'feature',
      stateName: 'Open',
      stateCategory: 'OPEN',
    },
    { id: 'task:2', type: 'task', label: 'Task two', taskNumber: 2, stateCategory: 'DONE', priority: 'LOW', category: null, kind: 'BUG' },
    { id: 'sprint:1', type: 'sprint', label: 'Sprint 1' },
    { id: 'memory:1', type: 'memory', label: 'A memory with a very long label indeed', memoryType: 'NOTE' },
  ],
  edges: [
    { source: 'task:1', target: 'sprint:1', kind: 'sprint' },
    { source: 'task:1', target: 'task:2', kind: 'dependency' },
    { source: 'task:1', target: 'task:2', kind: 'subtask' },
    { source: 'task:1', target: 'memory:1', kind: 'cites' },
    { source: 'memory:1', target: 'task:1', kind: 'source' },
    { source: 'task:1', target: 'task:2', kind: 'unknownkind' as never },
  ],
};

const summary = (over: Partial<ContextSummaryView> = {}): ContextSummaryView => ({
  scope: 'PROJECT',
  refId: '',
  configured: true,
  body: 'Project summary body',
  model: 'gpt-x',
  updatedAt: new Date('2024-01-01').toISOString(),
  stale: true,
  ...over,
});

describe('ContextGraphView', () => {
  beforeEach(() => {
    act.getContextSummaryAction.mockReset();
    act.generateContextSummaryAction.mockReset();
  });

  it('renders the empty state when the graph has no nodes', () => {
    render(
      <ContextGraphView
        slug="proj"
        canWrite
        graph={{ nodes: [], edges: [] }}
        initialProjectSummary={summary({ body: null, stale: false })}
      />,
    );
    expect(screen.getByText(/No nodes yet/)).toBeInTheDocument();
  });

  it('renders the graph, legend and a stale summary', () => {
    render(<ContextGraphView slug="proj" canWrite graph={graph} initialProjectSummary={summary()} />);
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('Sprint 1')).toBeInTheDocument();
    expect(screen.getByText('stale')).toBeInTheDocument();
    expect(screen.getByText('Project summary body')).toBeInTheDocument();
    expect(screen.getByText(/gpt-x/)).toBeInTheDocument();
  });

  it('zooms in, out, resets and wheels', async () => {
    const user = userEvent.setup();
    render(<ContextGraphView slug="proj" canWrite graph={graph} initialProjectSummary={summary()} />);
    await user.click(screen.getByLabelText('zoom in'));
    await user.click(screen.getByLabelText('zoom out'));
    await user.click(screen.getByLabelText('reset'));
    const svg = document.querySelector('svg')!;
    fireEvent.wheel(svg, { deltaY: -1 });
    fireEvent.wheel(svg, { deltaY: 1 });
    expect(svg).toBeInTheDocument();
  });

  it('pans via pointer events', () => {
    render(<ContextGraphView slug="proj" canWrite graph={graph} initialProjectSummary={summary()} />);
    const svg = document.querySelector('svg')!;
    fireEvent.pointerDown(svg, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 30, clientY: 25, pointerId: 1 });
    fireEvent.pointerUp(svg, { pointerId: 1 });
    // a move with no active pan should early-return
    fireEvent.pointerMove(svg, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(svg).toBeInTheDocument();
  });

  it('selects a task node, loads its summary and regenerates it', async () => {
    act.getContextSummaryAction.mockResolvedValue({ ok: true, data: summary({ scope: 'TASK', body: 'task summary' }) });
    act.generateContextSummaryAction.mockResolvedValue({ ok: true, data: summary({ scope: 'TASK', body: 'regenerated' }) });
    const user = userEvent.setup();
    render(<ContextGraphView slug="proj" canWrite graph={graph} initialProjectSummary={summary()} />);

    await user.click(screen.getByText('#1'));
    expect(act.getContextSummaryAction).toHaveBeenCalledWith('proj', 'TASK', '1');
    expect(await screen.findByText('task summary')).toBeInTheDocument();
    expect(screen.getByText('Story context')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /Regenerate/ })[1]!);
    await waitFor(() => expect(act.generateContextSummaryAction).toHaveBeenCalledWith('proj', 'TASK', '1'));
    expect(await screen.findByText('regenerated')).toBeInTheDocument();
  });

  it('selects a memory and a sprint node', async () => {
    const user = userEvent.setup();
    render(<ContextGraphView slug="proj" canWrite graph={graph} initialProjectSummary={summary()} />);
    await user.click(screen.getByText('Sprint 1'));
    expect(screen.getAllByText('Sprint').length).toBeGreaterThan(0);
    await user.click(screen.getByText((c) => c.startsWith('A memory with a')));
    expect(screen.getByText('NOTE')).toBeInTheDocument();
  });

  it('regenerates the project summary and surfaces errors', async () => {
    act.generateContextSummaryAction.mockResolvedValue({ ok: false, error: 'gen-fail' });
    const user = userEvent.setup();
    render(<ContextGraphView slug="proj" canWrite graph={graph} initialProjectSummary={summary({ body: null, stale: false })} />);
    await user.click(screen.getByRole('button', { name: /Generate summary/ }));
    expect(await screen.findByText('gen-fail')).toBeInTheDocument();
  });

  it('hides the regenerate control when read-only', () => {
    render(<ContextGraphView slug="proj" canWrite={false} graph={graph} initialProjectSummary={summary()} />);
    expect(screen.queryByRole('button', { name: /Regenerate/ })).not.toBeInTheDocument();
  });

  it('shows the not-configured message when the model is unavailable', () => {
    render(
      <ContextGraphView
        slug="proj"
        canWrite
        graph={graph}
        initialProjectSummary={summary({ configured: false, body: null })}
      />,
    );
    expect(screen.getByText(/context model is not configured/)).toBeInTheDocument();
  });
});
