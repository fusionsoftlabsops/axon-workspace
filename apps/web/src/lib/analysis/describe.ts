/**
 * Turn a graphify code knowledge-graph (node-link JSON: nodes + links/edges,
 * with a `community` attribute per node) into:
 *   - god nodes: the most-connected concepts (highest degree), and
 *   - a compact textual brief used to (a) ground the brownfield planner
 *     (lib/ai/planner.ts) and (b) seed the project brain.
 *
 * Pure functions (no prisma / IO) so they're unit-testable. Kept bounded so the
 * brief stays small enough to prepend to LLM prompts — mirrors the spirit of
 * lib/graph/summary.ts#describeProject for the internal context graph.
 */

export interface CodeGraphNode {
  id: string;
  label?: string;
  type?: string;
  kind?: string;
  community?: number | string | null;
  [k: string]: unknown;
}
export interface CodeGraphEdge {
  source: string;
  target: string;
  relation?: string;
  kind?: string;
  [k: string]: unknown;
}
export interface CodeGraph {
  nodes: CodeGraphNode[];
  edges?: CodeGraphEdge[];
  links?: CodeGraphEdge[];
}

export interface GodNode {
  id: string;
  label: string;
  degree: number;
  community: string | null;
}

export interface RepoRef {
  name: string;
  kind?: string;
  githubFullName?: string | null;
}

const MAX_GOD_NODES = 12;
const MAX_COMMUNITIES = 15;
const MAX_COMMUNITY_MEMBERS = 5;

function edgesOf(graph: CodeGraph): CodeGraphEdge[] {
  return graph.edges ?? graph.links ?? [];
}

function labelOf(n: CodeGraphNode): string {
  return (typeof n.label === 'string' && n.label.trim()) || n.id;
}

/** Edge endpoints in networkx node-link JSON are node ids (strings), but be
 *  defensive in case a serializer inlined the node object. */
function endpointId(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string') {
    return (v as { id: string }).id;
  }
  return null;
}

function communityKey(c: CodeGraphNode['community']): string | null {
  return c === null || c === undefined ? null : String(c);
}

/** Highest-degree nodes (undirected degree count), most central first. */
export function computeGodNodes(graph: CodeGraph, limit = MAX_GOD_NODES): GodNode[] {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const degree = new Map<string, number>();
  for (const e of edgesOf(graph)) {
    const s = endpointId(e.source);
    const t = endpointId(e.target);
    if (s && nodes.has(s)) degree.set(s, (degree.get(s) ?? 0) + 1);
    if (t && nodes.has(t)) degree.set(t, (degree.get(t) ?? 0) + 1);
  }
  return [...degree.entries()]
    .map(([id, deg]) => {
      const n = nodes.get(id)!;
      return { id, label: labelOf(n), degree: deg, community: communityKey(n.community) };
    })
    .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label))
    .slice(0, limit);
}

// ---- visual subgraph (for the Context-page code-graph view) ----

export interface CodeSubgraphNode {
  id: string;
  label: string;
  community: string | null;
  degree: number;
}
export interface CodeSubgraphEdge {
  source: string;
  target: string;
}
export interface CodeSubgraph {
  nodes: CodeSubgraphNode[];
  edges: CodeSubgraphEdge[];
  total: number; // total nodes in the full graph (the subset is the busiest `limit`)
  communities: number;
}

/**
 * A readable, bounded subgraph for visualization: the `limit` highest-degree
 * nodes (the architecture's skeleton) plus the de-duplicated edges among them.
 * Computed server-side so the full (possibly thousands-of-nodes) graph never
 * crosses the wire.
 */
export function subsetCodeGraph(graph: CodeGraph, limit = 90): CodeSubgraph {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const edges = edgesOf(graph);
  const degree = new Map<string, number>();
  for (const e of edges) {
    const s = endpointId(e.source);
    const t = endpointId(e.target);
    if (s && nodes.has(s)) degree.set(s, (degree.get(s) ?? 0) + 1);
    if (t && nodes.has(t)) degree.set(t, (degree.get(t) ?? 0) + 1);
  }
  const top = [...degree.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id]) => id);
  const keep = new Set(top);
  const outNodes: CodeSubgraphNode[] = top.map((id) => {
    const n = nodes.get(id)!;
    return { id, label: labelOf(n), community: communityKey(n.community), degree: degree.get(id) ?? 0 };
  });
  const seen = new Set<string>();
  const outEdges: CodeSubgraphEdge[] = [];
  for (const e of edges) {
    const s = endpointId(e.source);
    const t = endpointId(e.target);
    if (s && t && s !== t && keep.has(s) && keep.has(t)) {
      const key = s < t ? `${s}|${t}` : `${t}|${s}`;
      if (!seen.has(key)) {
        seen.add(key);
        outEdges.push({ source: s, target: t });
      }
    }
  }
  const communities = new Set(
    graph.nodes.map((n) => communityKey(n.community)).filter((c): c is string => c !== null),
  ).size;
  return { nodes: outNodes, edges: outEdges, total: graph.nodes.length, communities };
}

interface Community {
  key: string;
  size: number;
  members: GodNode[]; // representative (highest-degree) members
}

function communities(graph: CodeGraph): Community[] {
  const god = computeGodNodes(graph, graph.nodes.length); // degree for every node
  const degById = new Map(god.map((g) => [g.id, g]));
  const byCommunity = new Map<string, GodNode[]>();
  for (const n of graph.nodes) {
    const key = communityKey(n.community);
    if (key === null) continue;
    const g = degById.get(n.id) ?? { id: n.id, label: labelOf(n), degree: 0, community: key };
    (byCommunity.get(key) ?? byCommunity.set(key, []).get(key)!).push(g);
  }
  return [...byCommunity.entries()]
    .map(([key, members]) => ({
      key,
      size: members.length,
      members: members.sort((a, b) => b.degree - a.degree).slice(0, MAX_COMMUNITY_MEMBERS),
    }))
    .sort((a, b) => b.size - a.size)
    .slice(0, MAX_COMMUNITIES);
}

export interface DescribeResult {
  summary: string;
  godNodes: GodNode[];
}

/** Compact, model-friendly brief of the code graph (Spanish, like the rest of
 *  the planning prompts). Bounded in size. */
export function describeCodeGraph(graph: CodeGraph, repos: RepoRef[] = []): DescribeResult {
  const edges = edgesOf(graph);
  const god = computeGodNodes(graph);
  const comms = communities(graph);
  const totalCommunities = new Set(
    graph.nodes.map((n) => communityKey(n.community)).filter((c): c is string => c !== null),
  ).size;

  const repoLine = repos.length
    ? repos.map((r) => `${r.name}${r.kind ? ` (${r.kind})` : ''}`).join(' · ')
    : '—';

  const godLines = god.length
    ? god.map((g) => `- ${g.label} (${g.degree} conexiones)`).join('\n')
    : '—';

  const commLines = comms.length
    ? comms
        .map(
          (c) =>
            `- Área ${c.key} (${c.size} nodos): ${c.members.map((m) => m.label).join(', ') || '—'}`,
        )
        .join('\n')
    : '—';

  const summary = [
    'Mapa del CÓDIGO REAL del proyecto (grafo de conocimiento generado por graphify sobre sus repos).',
    `Repos analizados: ${repoLine}.`,
    `Tamaño: ${graph.nodes.length} nodos, ${edges.length} relaciones, ${totalCommunities} comunidades (módulos/áreas).`,
    '',
    'Conceptos centrales (god nodes, por conectividad):',
    godLines,
    '',
    'Áreas / comunidades principales del código:',
    commLines,
  ].join('\n');

  return { summary, godNodes: god };
}
