'use client';

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { moveTaskAction } from '@/lib/actions/tasks';
import { Column } from './Column';
import { TaskCard, type TaskView } from './TaskCard';
import { NewTaskInline } from './NewTaskInline';
import { BoardShortcuts } from './Shortcuts';
import { TaskDrawer } from './TaskDrawer';
import styles from './board.module.scss';

export interface StateView {
  id: string;
  name: string;
  color: string;
  category: string;
  order: number;
}

export interface MemberView {
  id: string;
  name: string;
  email: string;
}

interface Props {
  projectSlug: string;
  canWrite: boolean;
  currentUserId: string;
  states: StateView[];
  members: MemberView[];
  tasks: TaskView[];
}

export function BoardClient({ projectSlug, canWrite, currentUserId, states, members, tasks: initialTasks }: Props) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const tasksByState = useMemo(() => {
    const map: Record<string, TaskView[]> = {};
    for (const s of states) map[s.id] = [];
    for (const t of tasks) (map[t.stateId] ??= []).push(t);
    for (const k of Object.keys(map)) {
      map[k]!.sort((a, b) => a.positionInState - b.positionInState);
    }
    return map;
  }, [tasks, states]);

  function findTask(id: string) {
    return tasks.find((t) => t.id === id) ?? null;
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const activeTask = findTask(String(active.id));
    if (!activeTask) return;

    const overId = String(over.id);
    const overTask = findTask(overId);
    const overState = overTask?.stateId ?? overId; // dropping on column id directly
    if (!overState) return;

    const inSameState = activeTask.stateId === overState;
    const oldIndex = (tasksByState[activeTask.stateId] ?? []).findIndex((t) => t.id === activeTask.id);
    const targetList = tasksByState[overState] ?? [];
    let newIndex = overTask ? targetList.findIndex((t) => t.id === overTask.id) : targetList.length;
    if (newIndex < 0) newIndex = targetList.length;

    if (inSameState && oldIndex === newIndex) return;

    // Optimistic local update.
    const next = tasks.map((t) => ({ ...t }));
    const movedIdx = next.findIndex((t) => t.id === activeTask.id);
    if (movedIdx === -1) return;
    next[movedIdx]!.stateId = overState;

    const grouped: Record<string, TaskView[]> = {};
    for (const s of states) grouped[s.id] = [];
    for (const t of next) (grouped[t.stateId] ??= []).push(t);

    if (inSameState) {
      grouped[overState] = arrayMove(grouped[overState]!, oldIndex, newIndex);
    } else {
      const cur = grouped[overState]!;
      const moved = cur.find((t) => t.id === activeTask.id)!;
      const idxToRemove = cur.indexOf(moved);
      cur.splice(idxToRemove, 1);
      cur.splice(newIndex, 0, moved);
    }

    const flat: TaskView[] = [];
    for (const s of states) {
      const list = grouped[s.id]!;
      list.forEach((t, i) => {
        t.positionInState = i;
        flat.push(t);
      });
    }
    setTasks(flat);

    const siblingIds = grouped[overState]!.map((t) => t.id);

    startTransition(async () => {
      const r = await moveTaskAction(projectSlug, activeTask.id, overState, siblingIds);
      if (!r.ok) {
        // Revert on failure.
        setTasks(initialTasks);
        alert(r.error);
      } else {
        router.refresh();
      }
    });
  }

  // Target for "Reabrir" (DONE) / "Desbloquear" (BLOCKED): the in-progress column.
  const inProgressStateId = useMemo(
    () => states.find((s) => s.category === 'IN_PROGRESS')?.id ?? null,
    [states],
  );

  /** Programmatic one-click move (reopen/unblock): send a task to `toStateId`,
   *  appended at the end of that column. Mirrors the drag optimistic update. */
  function quickMove(taskId: string, toStateId: string) {
    const t = findTask(taskId);
    if (!t || t.stateId === toStateId) return;

    const grouped: Record<string, TaskView[]> = {};
    for (const s of states) grouped[s.id] = [];
    for (const x of tasks) {
      if (x.id === taskId) continue;
      (grouped[x.stateId] ??= []).push({ ...x });
    }
    (grouped[toStateId] ??= []).push({ ...t, stateId: toStateId });

    const flat: TaskView[] = [];
    for (const s of states) {
      grouped[s.id]!.forEach((x, i) => {
        x.positionInState = i;
        flat.push(x);
      });
    }
    setTasks(flat);

    const siblingIds = grouped[toStateId]!.map((x) => x.id);
    startTransition(async () => {
      const r = await moveTaskAction(projectSlug, taskId, toStateId, siblingIds);
      if (!r.ok) {
        setTasks(initialTasks);
        alert(r.error);
      } else {
        router.refresh();
      }
    });
  }

  const activeTask = activeId ? findTask(activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <BoardShortcuts />
      <div className={styles.board}>
        {states.map((state) => {
          const list = tasksByState[state.id] ?? [];
          return (
            <Column key={state.id} state={state} count={list.length}>
              <SortableContext
                id={state.id}
                items={list.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className={styles.columnBody}>
                  {list.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      projectSlug={projectSlug}
                      canWrite={canWrite}
                      stateCategory={state.category}
                      inProgressStateId={inProgressStateId}
                      onQuickMove={quickMove}
                    />
                  ))}
                </div>
              </SortableContext>
              {canWrite && (
                <NewTaskInline
                  projectSlug={projectSlug}
                  stateId={state.id}
                  defaultAssigneeId={currentUserId}
                  members={members}
                />
              )}
            </Column>
          );
        })}
      </div>

      <DragOverlay>
        {activeTask ? (
          <TaskCard task={activeTask} projectSlug={projectSlug} canWrite={false} isOverlay />
        ) : null}
      </DragOverlay>

      {/* Detalle de HU (abierto con ?task=): muestra el plan de implementación. */}
      <TaskDrawer slug={projectSlug} canWrite={canWrite} />
    </DndContext>
  );
}
