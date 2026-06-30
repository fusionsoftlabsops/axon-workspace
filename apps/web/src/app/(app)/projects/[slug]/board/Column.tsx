'use client';

import type { ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { StateView } from './BoardClient';
import styles from './board.module.scss';

export function Column({
  state,
  count,
  children,
}: {
  state: StateView;
  count: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: state.id });

  return (
    <section
      ref={setNodeRef}
      className={`${styles.column} ${isOver ? styles.columnOver : ''}`}
      style={{ borderTopColor: state.color }}
      data-testid="board-column"
      data-state-id={state.id}
      data-state-name={state.name}
    >
      <header className={styles.columnHeader}>
        <h3 className={styles.columnTitle}>
          <span className={styles.dot} style={{ background: state.color }} aria-hidden />
          {state.name}
        </h3>
        <span className={styles.count}>{count}</span>
      </header>
      {children}
    </section>
  );
}
