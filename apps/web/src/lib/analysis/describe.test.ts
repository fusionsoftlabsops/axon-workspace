import { describe, it, expect } from 'vitest';
import { computeGodNodes, describeCodeGraph, subsetCodeGraph, type CodeGraph } from './describe';

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

describe('subsetCodeGraph', () => {
  it('keeps the busiest nodes and the de-duplicated edges among them', () => {
    const sub = subsetCodeGraph(GRAPH, 3);
    expect(sub.total).toBe(6);
    expect(sub.communities).toBe(3); // 0, 1, 2 (null excluded)
    const ids = sub.nodes.map((n) => n.id).sort();
    // hub(3), a(2), b(2), c(2) are the busiest; top-3 by degree then id.
    expect(sub.nodes[0]!.id).toBe('hub');
    expect(sub.nodes[0]!.degree).toBe(3);
    expect(ids).toContain('hub');
    // every edge endpoint is within the kept set
    for (const e of sub.edges) {
      expect(ids).toContain(e.source);
      expect(ids).toContain(e.target);
    }
  });

  it('carries node label, community and degree', () => {
    const sub = subsetCodeGraph(GRAPH, 10);
    const hub = sub.nodes.find((n) => n.id === 'hub')!;
    expect(hub.label).toBe('OrchestratorService');
    expect(hub.community).toBe('0');
    expect(hub.degree).toBe(3);
    // 'lonely' has no edges → degree 0 → not in the degree map → excluded.
    expect(sub.nodes.some((n) => n.id === 'lonely')).toBe(false);
  });

  it('handles an empty graph', () => {
    const sub = subsetCodeGraph({ nodes: [], links: [] }, 5);
    expect(sub.nodes).toEqual([]);
    expect(sub.edges).toEqual([]);
    expect(sub.total).toBe(0);
  });
});

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
