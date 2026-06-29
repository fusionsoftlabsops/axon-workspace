import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/lib/i18n/i18n', () => ({ useI18n: () => ({ t: (_es: unknown, en: unknown) => en }) }));

import { CodeGraphView } from './CodeGraphView';
import type { CodeSubgraph } from '@/lib/analysis/describe';

const SUBSET: CodeSubgraph = {
  total: 200,
  communities: 4,
  nodes: [
    { id: 'hub', label: 'OrchestratorService', community: '0', degree: 9 },
    { id: 'a', label: 'AuthService', community: '0', degree: 4 },
    { id: 'b', label: 'Database', community: '1', degree: 3 },
    { id: 'c', label: 'ApiRouter', community: null, degree: 1 },
  ],
  edges: [
    { source: 'hub', target: 'a' },
    { source: 'hub', target: 'b' },
    { source: 'a', target: 'b' },
  ],
};

describe('CodeGraphView', () => {
  it('renders the nodes, edges and the busiest-node labels', () => {
    const { container } = render(<CodeGraphView subset={SUBSET} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.querySelectorAll('circle').length).toBe(4);
    expect(container.querySelectorAll('line').length).toBe(3);
    expect(screen.getByText('OrchestratorService')).toBeInTheDocument();
    // the "showing N busiest of TOTAL · C communities" meta
    expect(screen.getByText(/200/)).toBeInTheDocument();
  });

  it('selects a node on click and shows its connections', () => {
    render(<CodeGraphView subset={SUBSET} />);
    fireEvent.click(screen.getByText('OrchestratorService'));
    const panel = screen.getByText('Selected node').closest('section')!;
    expect(within(panel).getByText('OrchestratorService')).toBeInTheDocument();
    expect(within(panel).getByText(/9 connections/)).toBeInTheDocument();
    expect(within(panel).getByText(/area 0/)).toBeInTheDocument();
  });

  it('zoom controls are interactive', () => {
    const { container } = render(<CodeGraphView subset={SUBSET} />);
    fireEvent.click(screen.getByLabelText('zoom in'));
    fireEvent.click(screen.getByLabelText('zoom out'));
    fireEvent.click(screen.getByLabelText('reset'));
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('pans on pointer drag', () => {
    const { container } = render(<CodeGraphView subset={SUBSET} />);
    const svg = container.querySelector('svg')!;
    fireEvent.pointerDown(svg, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 40, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(svg, { pointerId: 1 });
    expect(svg).toBeInTheDocument();
  });

  it('shows an empty state when there are no nodes', () => {
    render(<CodeGraphView subset={{ nodes: [], edges: [], total: 0, communities: 0 }} />);
    expect(screen.getByText(/no nodes yet/i)).toBeInTheDocument();
  });
});
