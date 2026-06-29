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
import { useI18n } from '@/lib/i18n/i18n';
import type { CodeSubgraph, CodeSubgraphNode } from '@/lib/analysis/describe';
import styles from './context.module.scss';

type SimNode = CodeSubgraphNode & SimulationNodeDatum;

/** Deterministic, distinct-ish colour per community key (HSL hash). */
function communityColor(c: string | null): string {
  if (!c) return '#94a3b8';
  let h = 0;
  for (let i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) % 360;
  return `hsl(${h} 62% 56%)`;
}
function radius(degree: number): number {
  return Math.min(16, 3.5 + Math.sqrt(degree) * 1.6);
}
function shortLabel(label: string): string {
  return label.length > 22 ? label.slice(0, 21) + '…' : label;
}

export function CodeGraphView({ subset }: { subset: CodeSubgraph }) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);

  // Static force layout, computed once for this subset.
  const layout = useMemo(() => {
    const nodes: SimNode[] = subset.nodes.map((n) => ({ ...n }));
    const links = subset.edges.map((e) => ({ source: e.source, target: e.target }));
    if (nodes.length > 0) {
      const sim = forceSimulation(nodes)
        .force('charge', forceManyBody().strength(-240))
        .force(
          'link',
          forceLink<SimNode, { source: string; target: string }>(links)
            .id((d) => d.id)
            .distance(60)
            .strength(0.4),
        )
        .force('center', forceCenter(0, 0))
        .force('collide', forceCollide<SimNode>((d) => radius(d.degree) + 4))
        .stop();
      const ticks = Math.min(420, 160 + nodes.length * 2);
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
    const pad = 60;
    const vb = nodes.length
      ? { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad }
      : { x: -100, y: -100, w: 200, h: 200 };
    // Label only the busiest nodes so the canvas stays readable.
    const labelIds = new Set(
      [...nodes].sort((a, b) => b.degree - a.degree).slice(0, 22).map((n) => n.id),
    );
    return { nodes, pos, vb, labelIds };
  }, [subset]);

  // Pan / zoom.
  const [vview, setVview] = useState({ k: 1, tx: 0, ty: 0 });
  const pan = useRef({ active: false, x: 0, y: 0 });
  useEffect(() => setVview({ k: 1, tx: 0, ty: 0 }), [subset]);
  function pxToVb(dx: number, dy: number) {
    const el = svgRef.current;
    const factor = el ? layout.vb.w / el.clientWidth : 1;
    return { dx: dx * factor, dy: dy * factor };
  }
  function onDown(e: React.PointerEvent) {
    pan.current = { active: true, x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    if (!pan.current.active) return;
    const { dx, dy } = pxToVb(e.clientX - pan.current.x, e.clientY - pan.current.y);
    pan.current.x = e.clientX;
    pan.current.y = e.clientY;
    setVview((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  }
  function onUp() {
    pan.current.active = false;
  }
  function zoom(delta: number) {
    setVview((v) => ({ ...v, k: Math.min(3, Math.max(0.35, v.k * delta)) }));
  }

  const [selected, setSelected] = useState<CodeSubgraphNode | null>(null);

  if (subset.nodes.length === 0) {
    return (
      <div className={styles.emptyGraph}>
        {t('El grafo de código aún no tiene nodos.', 'The code graph has no nodes yet.')}
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.canvas}>
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
            onClick={() => setVview({ k: 1, tx: 0, ty: 0 })}
            aria-label="reset"
          >
            ⤢
          </button>
        </div>
        <svg
          ref={svgRef}
          className={styles.svg}
          viewBox={`${layout.vb.x} ${layout.vb.y} ${layout.vb.w} ${layout.vb.h}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
          onWheel={(e) => zoom(e.deltaY < 0 ? 1.1 : 0.9)}
        >
          <g transform={`translate(${vview.tx} ${vview.ty}) scale(${vview.k})`}>
            {subset.edges.map((e, i) => {
              const a = layout.pos.get(e.source);
              const b = layout.pos.get(e.target);
              if (!a || !b) return null;
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="var(--rule-strong)"
                  strokeWidth={0.8}
                  opacity={0.4}
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
                  onClick={() => setSelected(n)}
                >
                  <circle
                    r={radius(n.degree)}
                    fill={communityColor(n.community)}
                    stroke={isSel ? 'var(--ink)' : 'none'}
                    strokeWidth={isSel ? 2.5 : 0}
                  />
                  {(layout.labelIds.has(n.id) || isSel) && (
                    <text className={styles.nodeLabel} x={radius(n.degree) + 3} y={3}>
                      {shortLabel(n.label)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        <div className={styles.codeMeta}>
          {t('Mostrando los', 'Showing the')} {subset.nodes.length} {t('nodos más conectados de', 'busiest nodes of')}{' '}
          {subset.total} · {subset.communities} {t('comunidades', 'communities')}
        </div>
      </div>

      <aside className={styles.panel}>
        <section className={styles.summaryBox}>
          <span className={styles.summaryTitle}>{t('Nodo seleccionado', 'Selected node')}</span>
          {selected ? (
            <div className={styles.nodeInfo}>
              <strong>{selected.label}</strong>
              <span className={styles.summaryMeta}>
                {selected.degree} {t('conexiones', 'connections')}
                {selected.community ? ` · ${t('área', 'area')} ${selected.community}` : ''}
              </span>
            </div>
          ) : (
            <p className={styles.summaryEmpty}>
              {t('Toca un nodo para ver sus conexiones.', 'Tap a node to see its connections.')}
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
