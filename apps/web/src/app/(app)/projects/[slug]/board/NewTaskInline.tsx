'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createTaskAction } from '@/lib/actions/tasks';
import type { MemberView } from './BoardClient';
import styles from './board.module.scss';

export function NewTaskInline({
  projectSlug,
  stateId,
  defaultAssigneeId,
  members,
}: {
  projectSlug: string;
  stateId: string;
  defaultAssigneeId: string;
  members: MemberView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (title.trim().length === 0) return;
    startTransition(async () => {
      const r = await createTaskAction(projectSlug, {
        stateId,
        title: title.trim(),
        priority: 'MEDIUM',
        assigneeId: defaultAssigneeId,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setTitle('');
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        className={styles.addBtn}
        data-shortcut="new-task"
        onClick={() => setOpen(true)}
      >
        + nueva tarea
      </button>
    );
  }

  return (
    <form className={styles.addForm} onSubmit={submit}>
      <textarea
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título"
        autoFocus
        rows={2}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit(e);
          }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}>{error}</p>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="submit" disabled={pending}>
          Crear
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
      {/* Reserve members for the dropdown when we expand the inline editor later. */}
      <input type="hidden" name="members" value={members.length} />
    </form>
  );
}
