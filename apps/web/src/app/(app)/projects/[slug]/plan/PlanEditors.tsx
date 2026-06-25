'use client';

import { useState, useTransition } from 'react';
import { Button, Badge } from '@/components/ui';
import { useI18n } from '@/lib/i18n/i18n';
import {
  refinePlanTaskAction,
  updatePlanTaskAction,
  removePlanTaskAction,
  updatePlanSprintAction,
  type PlanView,
} from '@/lib/actions/planning';
import { PLAN_CATEGORIES, type GeneratedPlan } from '@/lib/ai/plan-schema';
import styles from './plan.module.scss';

type PlanTask = GeneratedPlan['sprints'][number]['tasks'][number];

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const KINDS = ['TASK', 'STORY', 'EPIC', 'BUG', 'SPIKE'];

/** A single generated HU (user story) with inline edit, AI re-analysis, and remove. */
export function PlanTaskCard({
  slug,
  sprintIndex,
  taskIndex,
  task,
  canEdit,
  onChange,
  onError,
}: {
  slug: string;
  sprintIndex: number;
  taskIndex: number;
  task: PlanTask;
  canEdit: boolean;
  onChange: (p: PlanView) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [refineOpen, setRefineOpen] = useState(false);
  const [focus, setFocus] = useState('');
  const [busy, start] = useTransition();

  // Local draft for the edit form.
  const [draft, setDraft] = useState<PlanTask>(task);
  function openEdit() {
    setDraft(task);
    setMode('edit');
  }

  function run(action: () => Promise<{ ok: boolean; data?: PlanView; error?: string }>, after?: () => void) {
    onError('');
    start(async () => {
      const r = await action();
      if (!r.ok) {
        onError(r.error ?? t('Acción fallida', 'Action failed'));
        return;
      }
      if (r.data) onChange(r.data);
      after?.();
    });
  }

  function saveEdit() {
    run(
      () =>
        updatePlanTaskAction(slug, sprintIndex, taskIndex, {
          title: draft.title,
          description: draft.description,
          acceptanceCriteria: draft.acceptanceCriteria,
          estimate: draft.estimate,
          category: draft.category,
          priority: draft.priority,
          kind: draft.kind,
          recommendedRoles: draft.recommendedRoles,
        }),
      () => setMode('view'),
    );
  }

  function reanalyze() {
    run(
      () => refinePlanTaskAction(slug, sprintIndex, taskIndex, focus),
      () => {
        setFocus('');
        setRefineOpen(false);
      },
    );
  }

  function remove() {
    if (!confirm(t('¿Quitar esta HU del plan?', 'Remove this story from the plan?'))) return;
    run(() => removePlanTaskAction(slug, sprintIndex, taskIndex));
  }

  if (mode === 'edit') {
    return (
      <div className={`${styles.taskRow} ${styles.editForm}`}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('Título', 'Title')}</span>
          <input
            className={styles.editInput}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('Descripción', 'Description')}</span>
          <textarea
            className={styles.editTextarea}
            rows={3}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('Criterios de aceptación', 'Acceptance criteria')}</span>
          <textarea
            className={styles.editTextarea}
            rows={4}
            value={draft.acceptanceCriteria}
            onChange={(e) => setDraft({ ...draft, acceptanceCriteria: e.target.value })}
          />
        </label>
        <div className={styles.fieldGrid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('Estimación', 'Estimate')}</span>
            <input
              className={styles.editInput}
              value={draft.estimate}
              placeholder="2d / 5 pts"
              onChange={(e) => setDraft({ ...draft, estimate: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('Categoría', 'Category')}</span>
            <select
              className={styles.editSelect}
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            >
              {PLAN_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('Prioridad', 'Priority')}</span>
            <select
              className={styles.editSelect}
              value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('Tipo', 'Kind')}</span>
            <select
              className={styles.editSelect}
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('Perfiles (separados por coma)', 'Roles (comma-separated)')}</span>
          <input
            className={styles.editInput}
            value={draft.recommendedRoles.join(', ')}
            onChange={(e) =>
              setDraft({
                ...draft,
                recommendedRoles: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        <div className={styles.rowActions}>
          <Button variant="primary" onClick={saveEdit} disabled={busy || !draft.title.trim()}>
            {busy ? t('Guardando…', 'Saving…') : t('Guardar', 'Save')}
          </Button>
          <Button variant="secondary" onClick={() => setMode('view')} disabled={busy}>
            {t('Cancelar', 'Cancel')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.taskRow} ${busy ? styles.rowBusy : ''}`}>
      <div className={styles.taskBody}>
        <div className={styles.taskMain}>
          <span className={styles.taskTitle}>{task.title}</span>
          {task.description && <p className={styles.taskDesc}>{task.description}</p>}
          {task.acceptanceCriteria && <p className={styles.ac}>{task.acceptanceCriteria}</p>}
        </div>
        <div className={styles.taskAside}>
          <div className={styles.asideBadges}>
            {task.category && <Badge tone="accent">{task.category}</Badge>}
            {task.estimate && <Badge tone="neutral">{task.estimate}</Badge>}
            <Badge tone="neutral">{task.kind}</Badge>
          </div>
          <div className={styles.taskMeta}>
            <span>{task.priority}</span>
            {task.recommendedRoles?.length > 0 && <span>{task.recommendedRoles.join(', ')}</span>}
          </div>
          {canEdit && (
            <div className={styles.rowActions}>
              <button type="button" className={styles.miniBtn} onClick={openEdit} disabled={busy}>
                ✎ {t('Editar', 'Edit')}
              </button>
              <button
                type="button"
                className={styles.miniBtn}
                onClick={() => setRefineOpen((v) => !v)}
                disabled={busy}
              >
                ↻ {busy ? t('Analizando…', 'Analyzing…') : t('Re-analizar', 'Re-analyze')}
              </button>
              <button type="button" className={`${styles.miniBtn} ${styles.miniDanger}`} onClick={remove} disabled={busy}>
                🗑 {t('Quitar', 'Remove')}
              </button>
            </div>
          )}
        </div>
      </div>

      {canEdit && refineOpen && (
        <div className={styles.refineBox}>
          <textarea
            className={styles.editTextarea}
            rows={2}
            value={focus}
            placeholder={t(
              'Enfoque opcional (p. ej. «divídela en subtareas» o «añade criterios de seguridad»)…',
              'Optional focus (e.g. "split into subtasks" or "add security criteria")…',
            )}
            onChange={(e) => setFocus(e.target.value)}
          />
          <div className={styles.rowActions}>
            <Button variant="primary" onClick={reanalyze} disabled={busy}>
              {busy ? t('Analizando…', 'Analyzing…') : t('Re-analizar con IA', 'Re-analyze with AI')}
            </Button>
            <Button variant="secondary" onClick={() => setRefineOpen(false)} disabled={busy}>
              {t('Cancelar', 'Cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Editable sprint header (name + goal). */
export function PlanSprintHead({
  slug,
  sprintIndex,
  name,
  goal,
  canEdit,
  onChange,
  onError,
}: {
  slug: string;
  sprintIndex: number;
  name: string;
  goal: string;
  canEdit: boolean;
  onChange: (p: PlanView) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftGoal, setDraftGoal] = useState(goal);
  const [busy, start] = useTransition();

  function save() {
    onError('');
    start(async () => {
      const r = await updatePlanSprintAction(slug, sprintIndex, { name: draftName, goal: draftGoal });
      if (!r.ok) {
        onError(r.error ?? t('Acción fallida', 'Action failed'));
        return;
      }
      if (r.data) onChange(r.data);
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <div className={`${styles.sprintHead} ${styles.editForm}`}>
        <input
          className={styles.editInput}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder={t('Nombre del sprint', 'Sprint name')}
        />
        <textarea
          className={styles.editTextarea}
          rows={2}
          value={draftGoal}
          onChange={(e) => setDraftGoal(e.target.value)}
          placeholder={t('Objetivo del sprint', 'Sprint goal')}
        />
        <div className={styles.rowActions}>
          <Button variant="primary" onClick={save} disabled={busy || !draftName.trim()}>
            {busy ? t('Guardando…', 'Saving…') : t('Guardar', 'Save')}
          </Button>
          <Button variant="secondary" onClick={() => setEditing(false)} disabled={busy}>
            {t('Cancelar', 'Cancel')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.sprintHead}>
      <div className={styles.sprintHeadTop}>
        <h4 className={styles.sprintName}>{name}</h4>
        {canEdit && (
          <button
            type="button"
            className={styles.miniBtn}
            onClick={() => {
              setDraftName(name);
              setDraftGoal(goal);
              setEditing(true);
            }}
          >
            ✎ {t('Editar', 'Edit')}
          </button>
        )}
      </div>
      {goal && <p className={styles.sprintGoal}>{goal}</p>}
    </div>
  );
}
