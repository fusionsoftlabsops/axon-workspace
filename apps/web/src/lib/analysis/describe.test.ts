import { describe, it, expect } from 'vitest';
import { computeGodNodes, describeCodeGraph, type CodeGraph } from './describe';

// Small star-ish graph: `hub` is connected to everything → highest degree.
const GRAPH: CodeGraph = {
  nodes: [
    { id: 'hub', label: 'OrchestratorService', community: 0 },
    { id: 'a', label: 'Auth', community: 0 },
    { id: 'b', label: 'Db', community: 1 },
    { id: 'c', label: 'Api', community: 1 },
    { id: 'd', label: 'Util', community: 2 },
    { id: 'lonely', label: 'Orphan', community: null },
  ],
  links: [
    { source: 'hub', target: 'a' },
    { source: 'hub', target: 'b' },
    { source: 'hub', target: 'c' },
    { source: 'a', target: 'b' },
    { source: 'c', target: 'd' },
  ],
};

describe('computeGodNodes', () => {
  it('ranks nodes by degree, most central first', () => {
    const god = computeGodNodes(GRAPH, 3);
    expect(god[0]!.id).toBe('hub');
    expect(god[0]!.degree).toBe(3);
    expect(god[0]!.label).toBe('OrchestratorService');
    expect(god[0]!.community).toBe('0');
    expect(god).toHaveLength(3);
  });

  it('respects the limit and ignores nodes with no edges', () => {
    const ids = computeGodNodes(GRAPH).map((g) => g.id);
    expect(ids).not.toContain('lonely'); // degree 0 → not present
  });

  it('reads edges from `edges` when `links` is absent', () => {
    const g: CodeGraph = { nodes: GRAPH.nodes, edges: GRAPH.links };
    expect(computeGodNodes(g, 1)[0]!.id).toBe('hub');
  });
});

describe('describeCodeGraph', () => {
  it('produces a bounded brief with counts, god nodes and areas', () => {
    const { summary, godNodes } = describeCodeGraph(GRAPH, [
      { name: 'idea-forge-backend', kind: 'backend' },
    ]);
    expect(summary).toContain('6 nodos');
    expect(summary).toContain('5 relaciones');
    expect(summary).toContain('3 comunidades'); // 0,1,2 (null excluded)
    expect(summary).toContain('idea-forge-backend (backend)');
    expect(summary).toContain('OrchestratorService');
    expect(summary).toContain('Áreas / comunidades principales');
    // god nodes returned for downstream seeding
    expect(godNodes[0]!.label).toBe('OrchestratorService');
  });

  it('handles an empty graph without throwing', () => {
    const { summary, godNodes } = describeCodeGraph({ nodes: [], links: [] });
    expect(godNodes).toHaveLength(0);
    expect(summary).toContain('0 nodos');
  });
});
