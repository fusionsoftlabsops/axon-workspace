'use client';

import Link from 'next/link';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Priority } from '@prisma/client';
import { useI18n } from '@/lib/i18n/i18n';
import styles from './board.module.scss';

export interface TaskView {
  id: string;
  taskNumber: number;
  title: string;
  stateId: string;
  priority: Priority;
  assignee: { id: string; name: string } | null;
  positionInState: number;
  subtaskCount: number;
  commentCount: number;
  dueDate: string | null;
}

const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: 'baja',
  MEDIUM: 'media',
  HIGH: 'alta',
  URGENT: 'urgente',
};

const PRIORITY_COLOR: Record<Priority, string> = {
  LOW: '#9ca3af',
  MEDIUM: '#6b7280',
  HIGH: '#f59e0b',
  URGENT: '#ef4444',
};

export function TaskCard({
  task,
  projectSlug,
  canWrite,
  isOverlay,
  stateCategory,
  inProgressStateId,
  onQuickMove,
}: {
  task: TaskView;
  projectSlug: string;
  canWrite: boolean;
  isOverlay?: boolean;
  stateCategory?: string;
  inProgressStateId?: string | null;
  onQuickMove?: (taskId: string, toStateId: string) => void;
}) {
  const { t } = useI18n();
  const sortable = useSortable({ id: task.id, disabled: !canWrite || isOverlay });
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = sortable;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // Quick-move: reopen a finished task / unblock a blocked one → back to Desarrollo.
  const quickLabel =
    stateCategory === 'DONE'
      ? t('Reabrir', 'Reopen')
      : stateCategory === 'BLOCKED'
        ? t('Desbloquear', 'Unblock')
        : null;
  const showQuick = !isOverlay && canWrite && !!onQuickMove && !!inProgressStateId && !!quickLabel;

  const content = (
    <article
      ref={setNodeRef}
      style={style}
      className={`${styles.card} ${isOverlay ? styles.cardOverlay : ''}`}
      {...attributes}
      {...listeners}
    >
      <div className={styles.cardHeader}>
        <span className={styles.taskNum}>#{task.taskNumber}</span>
        <span
          className={styles.priority}
          style={{ background: PRIORITY_COLOR[task.priority] }}
          title={`Prioridad: ${PRIORITY_LABEL[task.priority]}`}
        />
      </div>
      <h4 className={styles.cardTitle}>{task.title}</h4>
      <div className={styles.cardFooter}>
        {task.assignee && (
          <span className={styles.assignee} title={task.assignee.name}>
            {initials(task.assignee.name)}
          </span>
        )}
        {task.subtaskCount > 0 && (
          <span className={styles.meta} title="subtareas">
            ↳ {task.subtaskCount}
          </span>
        )}
        {task.commentCount > 0 && (
          <span className={styles.meta} title="comentarios">
            💬 {task.commentCount}
          </span>
        )}
        {task.dueDate && (
          <span className={styles.meta} title={`Vence ${task.dueDate}`}>
            {new Date(task.dueDate).toLocaleDateString()}
          </span>
        )}
      </div>
      {showQuick && (
        <button
          type="button"
          className={styles.quickAction}
          // Don't let the click start a drag or follow the card's link.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onQuickMove!(task.id, inProgressStateId!);
          }}
        >
          ↩ {quickLabel}
        </button>
      )}
    </article>
  );

  if (isOverlay) return content;

  return (
    <Link
      href={`/projects/${projectSlug}/board?task=${task.id}`}
      style={{ textDecoration: 'none', color: 'inherit' }}
      scroll={false}
    >
      {content}
    </Link>
  );
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
