'use client';

import Link from 'next/link';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Priority } from '@prisma/client';
import { useI18n } from '@/lib/i18n/i18n';
import { priorityMeta } from '@/lib/priority';
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
  category?: string | null;
  estimate?: string | null;
  hasImplPlan?: boolean;
}

const PRIORITY_LABEL_I18N: Record<Priority, [string, string]> = {
  LOW: ['Baja', 'Low'],
  MEDIUM: ['Media', 'Medium'],
  HIGH: ['Alta', 'High'],
  URGENT: ['Urgente', 'Urgent'],
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

  const meta = priorityMeta(task.priority);
  const [labelEs, labelEn] = PRIORITY_LABEL_I18N[meta.level];
  const priorityLabel = t(labelEs, labelEn);
  const priorityTitle = t(`Prioridad: ${priorityLabel}`, `Priority: ${priorityLabel}`);

  const content = (
    <article
      ref={setNodeRef}
      style={style}
      className={`${styles.card} ${isOverlay ? styles.cardOverlay : ''}`}
      data-testid="task-card"
      data-task-id={task.id}
      data-task-number={task.taskNumber}
      {...attributes}
      {...listeners}
    >
      <div className={styles.cardHeader}>
        <span className={styles.taskNum}>#{task.taskNumber}</span>
        <span
          className={styles.priorityBadge}
          data-priority={meta.level}
          style={{ color: meta.color, borderColor: meta.color }}
          role="img"
          aria-label={priorityTitle}
          title={priorityTitle}
        >
          {meta.icon}
        </span>
      </div>
      <h4 className={styles.cardTitle}>{task.title}</h4>
      <div className={styles.cardFooter}>
        {task.category && <span className={styles.cat}>{task.category}</span>}
        {task.estimate && <span className={styles.meta}>{task.estimate}</span>}
        {task.hasImplPlan && (
          <span className={styles.meta} title={t('Plan de implementación generado', 'Implementation plan generated')}>
            📄
          </span>
        )}
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
