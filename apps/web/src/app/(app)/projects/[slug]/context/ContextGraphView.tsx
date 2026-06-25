'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
} from 'd3-force';
import { Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n/i18n';
import {
  getContextSummaryAction,
  generateContextSummaryAction,
  type ContextSummaryView,
  type ContextScope,
} from '@/lib/actions/context';
import type { ContextGraph, GraphNode } from '@/lib/graph/build';
import styles from './context.module.scss';

type SimNode = GraphNode & SimulationNodeDatum;

const STATE_COLOR: Record<string, string> = {
  DONE: '#10b981',
  IN_PROGRESS: '#3b82f6',
  BLOCKED: '#ef4444',
  REVIEW: '#f59e0b',
  OPEN: '#94a3b8',
};
const SPRINT_COLOR = '#6366f1';
const MEMORY_COLOR = '#d97706';

function nodeColor(n: GraphNode): string {
  if (n.type === 'sprint') return SPRINT_COLOR;
  if (n.type === 'memory') return MEMORY_COLOR;
  return STATE_COLOR[n.stateCategory ?? 'OPEN'] ?? STATE_COLOR.OPEN!;
}
function nodeRadius(n: GraphNode): number {
  return n.type === 'sprint' ? 10 : n.type === 'memory' ? 6 : 7;
}
const EDGE_STYLE: Record<string, { stroke: string; dash?: string }> = {
  dependency: { stroke: '#ef4444' },
  subtask: { stroke: '#9ca3af' },
  sprint: { stroke: '#c7d2fe' },
  cites: { stroke: '#0d9488', dash: '4 3' },
  source: { stroke: '#0d9488', dash: '4 3' },
};

function shortLabel(n: GraphNode): string {
  if (n.type === 'task') return `#${n.taskNumber}`;
  const l = n.label ?? '';
  return l.length > 18 ? l.slice(0, 17) + '…' : l;
}

export function ContextGraphView({
  slug,
  canWrite,
  graph,
  initialProjectSummary,
}: {
  slug: string;
  canWrite: boolean;
  graph: ContextGraph;
  initialProjectSummary: ContextSummaryView;
}) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);

  // --- static force layout (computed once per graph) ---
  const layout = useMemo(() => {
    const nodes: SimNode[] = graph.nodes.map((n) => ({ ...n }));
    const links = graph.edges.map((e) => ({ source: e.source, target: e.target }));
    if (nodes.length > 0) {
      const sim = forceSimulation(nodes)
        .force('charge', forceManyBody().strength(-200))
        .force(
          'link',
          forceLink<SimNode, { source: string; target: string }>(links)
            .id((d) => d.id)
            .distance(72)
            .strength(0.5),
        )
        .force('center', forceCenter(0, 0))
        .force('collide', forceCollide(20))
        .stop();
      const ticks = Math.min(400, 140 + nodes.length * 2);
      for (let i = 0; i < ticks; i++) sim.tick();
    }
    const pos = new Map<string, { x: number; y: number }>();
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      pos.set(n.id, { x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const pad = 50;
    const vb = nodes.length
      ? { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad }
      : { x: -100, y: -100, w: 200, h: 200 };
    return { nodes, pos, vb };
  }, [graph]);

  // --- pan / zoom ---
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const pan = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
  useEffect(() => setView({ k: 1, tx: 0, ty: 0 }), [graph]);

  function pxToVb(dx: number, dy: number) {
    const el = svgRef.current;
    const factor = el ? layout.vb.w / el.clientWidth : 1;
    return { dx: dx * factor, dy: dy * factor };
  }
  function onBgPointerDown(e: React.PointerEvent) {
    pan.current = { active: true, x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onBgPointerMove(e: React.PointerEvent) {
    if (!pan.current.active) return;
    const { dx, dy } = pxToVb(e.clientX - pan.current.x, e.clientY - pan.current.y);
    pan.current.x = e.clientX;
    pan.current.y = e.clientY;
    setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  }
  function onBgPointerUp() {
    pan.current.active = false;
  }
  function zoom(delta: number) {
    setView((v) => ({ ...v, k: Math.min(3, Math.max(0.35, v.k * delta)) }));
  }

  // --- selection + summaries ---
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [projectSummary, setProjectSummary] = useState(initialProjectSummary);
  const [taskSummary, setTaskSummary] = useState<ContextSummaryView | null>(null);
  const [busy, setBusy] = useState<ContextScope | null>(null);
  const [error, setError] = useState<string | null>(null);

  function selectNode(n: GraphNode) {
    setSelected(n);
    setError(null);
    setTaskSummary(null);
    if (n.type === 'task') {
      const taskId = n.id.replace(/^task:/, '');
      getContextSummaryAction(slug, 'TASK', taskId).then((r) => {
        if (r.ok && r.data) setTaskSummary(r.data);
      });
    }
  }

  function regenerate(scope: ContextScope) {
    const refId = scope === 'TASK' && selected ? selected.id.replace(/^task:/, '') : '';
    setBusy(scope);
    setError(null);
    generateContextSummaryAction(slug, scope, refId)
      .then((r) => {
        if (!r.ok) {
          setError(r.error);
          return;
        }
        if (!r.data) return;
        if (scope === 'PROJECT') setProjectSummary(r.data);
        else setTaskSummary(r.data);
      })
      .finally(() => setBusy(null));
  }

  const empty = graph.nodes.length === 0;

  return (
    <div className={styles.wrap}>
      {/* ---- Graph canvas ---- */}
      <div className={styles.canvas}>
        {empty ? (
          <div className={styles.emptyGraph}>
            {t(
              'Aún no hay nodos. Publica un plan o crea tareas para ver el grafo.',
              'No nodes yet. Publish a plan or create tasks to see the graph.',
            )}
          </div>
        ) : (
          <>
            <div className={styles.zoomBar}>
              <button type="button" className={styles.zoomBtn} onClick={() => zoom(1.25)} aria-label="zoom in">
                +
              </button>
              <button type="button" className={styles.zoomBtn} onClick={() => zoom(0.8)} aria-label="zoom out">
                −
              </button>
              <button
                type="button"
                className={styles.zoomBtn}
                onClick={() => setView({ k: 1, tx: 0, ty: 0 })}
                aria-label="reset"
              >
                ⤢
              </button>
            </div>
            <svg
              ref={svgRef}
              className={styles.svg}
              viewBox={`${layout.vb.x} ${layout.vb.y} ${layout.vb.w} ${layout.vb.h}`}
              onPointerDown={onBgPointerDown}
              onPointerMove={onBgPointerMove}
              onPointerUp={onBgPointerUp}
              onPointerLeave={onBgPointerUp}
              onWheel={(e) => zoom(e.deltaY < 0 ? 1.1 : 0.9)}
            >
              <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
                {graph.edges.map((e, i) => {
                  const a = layout.pos.get(e.source);
                  const b = layout.pos.get(e.target);
                  if (!a || !b) return null;
                  const st = EDGE_STYLE[e.kind] ?? EDGE_STYLE.subtask!;
                  return (
                    <line
                      key={i}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={st.stroke}
                      strokeWidth={1.2}
                      strokeDasharray={st.dash}
                      opacity={0.55}
                    />
                  );
                })}
                {layout.nodes.map((n) => {
                  const p = layout.pos.get(n.id)!;
                  const isSel = selected?.id === n.id;
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${p.x} ${p.y})`}
                      className={styles.node}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => selectNode(n)}
                    >
                      {n.type === 'sprint' ? (
                        <rect
                          x={-nodeRadius(n)}
                          y={-nodeRadius(n)}
                          width={nodeRadius(n) * 2}
                          height={nodeRadius(n) * 2}
                          rx={2}
                          fill={nodeColor(n)}
                          stroke={isSel ? 'var(--ink)' : 'none'}
                          strokeWidth={isSel ? 2 : 0}
                        />
                      ) : (
                        <circle
                          r={nodeRadius(n)}
                          fill={nodeColor(n)}
                          stroke={isSel ? 'var(--ink)' : 'none'}
                          strokeWidth={isSel ? 2 : 0}
                        />
                      )}
                      <text className={styles.nodeLabel} x={nodeRadius(n) + 3} y={3}>
                        {shortLabel(n)}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          </>
        )}

        <div className={styles.legend}>
          <span><i style={{ background: STATE_COLOR.OPEN }} />{t('Tarea', 'Task')}</span>
          <span><i style={{ background: STATE_COLOR.DONE }} />{t('Hecha', 'Done')}</span>
          <span><i style={{ background: STATE_COLOR.BLOCKED }} />{t('Bloqueada', 'Blocked')}</span>
          <span><i style={{ background: SPRINT_COLOR }} />Sprint</span>
          <span><i style={{ background: MEMORY_COLOR }} />{t('Memoria', 'Memory')}</span>
        </div>
      </div>

      {/* ---- Side panel ---- */}
      <aside className={styles.panel}>
        <SummaryBlock
          title={t('Contexto del proyecto', 'Project context')}
          view={projectSummary}
          canWrite={canWrite}
          busy={busy === 'PROJECT'}
          onRegenerate={() => regenerate('PROJECT')}
          t={t}
        />

        {selected && (
          <div className={styles.nodeDetail}>
            <h3 className={styles.detailTitle}>
              {selected.type === 'task' && <span className={styles.detailNum}>#{selected.taskNumber}</span>}
              {selected.label}
            </h3>
            <div className={styles.detailMeta}>
              {selected.type === 'task' && (
                <>
                  <span>{selected.stateName ?? selected.stateCategory}</span>
                  <span>{selected.priority}</span>
                  {selected.category && <span>{selected.category}</span>}
                  <span>{selected.kind}</span>
                </>
              )}
              {selected.type === 'memory' && <span>{selected.memoryType}</span>}
              {selected.type === 'sprint' && <span>Sprint</span>}
            </div>

            {selected.type === 'task' && (
              <SummaryBlock
                title={t('Contexto de la HU', 'Story context')}
                view={taskSummary}
                canWrite={canWrite}
                busy={busy === 'TASK'}
                onRegenerate={() => regenerate('TASK')}
                t={t}
              />
            )}
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </aside>
    </div>
  );
}

function SummaryBlock({
  title,
  view,
  canWrite,
  busy,
  onRegenerate,
  t,
}: {
  title: string;
  view: ContextSummaryView | null;
  canWrite: boolean;
  busy: boolean;
  onRegenerate: () => void;
  t: <T>(es: T, en: T) => T;
}) {
  const configured = view?.configured ?? true;
  return (
    <section className={styles.summaryBox}>
      <div className={styles.summaryHead}>
        <span className={styles.summaryTitle}>{title}</span>
        {view?.stale && view.body && (
          <span className={styles.staleTag}>{t('desactualizado', 'stale')}</span>
        )}
      </div>

      {view?.body ? (
        <p className={styles.summaryBody}>{view.body}</p>
      ) : (
        <p className={styles.summaryEmpty}>
          {configured
            ? t('Sin resumen todavía.', 'No summary yet.')
            : t('El modelo de contexto no está configurado en esta instancia.', 'The context model is not configured in this instance.')}
        </p>
      )}

      <div className={styles.summaryFoot}>
        {view?.model && view?.updatedAt && (
          <span className={styles.summaryMeta}>
            {view.model} · {new Date(view.updatedAt).toLocaleString()}
          </span>
        )}
        {canWrite && configured && (
          <Button variant="secondary" onClick={onRegenerate} disabled={busy}>
            {busy
              ? t('Generando…', 'Generating…')
              : view?.body
                ? t('Regenerar', 'Regenerate')
                : t('Generar resumen', 'Generate summary')}
          </Button>
        )}
      </div>
    </section>
  );
}
