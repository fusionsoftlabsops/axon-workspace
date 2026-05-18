/**
 * Build the "task digest" fed to the brain extractor.
 *
 * We don't ship the task's raw record verbatim — we condense it into a
 * human-readable summary that the LLM can reason over. Keep this stable;
 * changes invalidate prompt caching.
 */
import { prisma } from '@/lib/db';

export interface TaskDigest {
  taskId: string;
  taskNumber: number;
  projectSlug: string;
  digest: string;
}

const ACTIVITY_LABEL: Record<string, string> = {
  STATE_CHANGED: 'Cambio de estado',
  ASSIGNED: 'Asignación',
  UNASSIGNED: 'Desasignación',
  PRIORITY_CHANGED: 'Cambio de prioridad',
  TITLE_CHANGED: 'Cambio de título',
  DESCRIPTION_CHANGED: 'Cambio de descripción',
  DUE_DATE_CHANGED: 'Cambio de fecha límite',
  COMMENTED: 'Comentario',
  SUBTASK_ADDED: 'Subtarea agregada',
  DEPENDENCY_ADDED: 'Dependencia agregada',
  MEMORY_CITED: 'Memoria citada',
  MEMORY_CAPTURED: 'Memoria capturada',
  CREATED: 'Creada',
};

/**
 * Assemble a markdown digest of a task: header, description, comments, then
 * a chronological activity log. Returns null if the task can't be found.
 */
export async function buildTaskDigest(taskId: string): Promise<TaskDigest | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { slug: true, name: true } },
      state: { select: { name: true, category: true } },
      assignee: { select: { name: true } },
      reporter: { select: { name: true } },
      comments: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { name: true } } },
      },
      activity: {
        orderBy: { createdAt: 'asc' },
        include: { actor: { select: { name: true } } },
      },
    },
  });
  if (!task) return null;

  const lines: string[] = [];
  lines.push(`# Tarea ${task.project.slug}#${task.taskNumber}: ${task.title}`);
  lines.push('');
  lines.push(
    `- Estado actual: **${task.state.name}** (${task.state.category}) · Prioridad: ${task.priority}`,
  );
  lines.push(`- Asignado a: ${task.assignee?.name ?? '—'} · Reportado por: ${task.reporter.name}`);
  lines.push('');

  if (task.description?.trim()) {
    lines.push('## Descripción');
    lines.push(task.description.trim());
    lines.push('');
  }

  if (task.comments.length > 0) {
    lines.push('## Comentarios');
    for (const c of task.comments) {
      lines.push(`### ${c.author.name} · ${c.createdAt.toISOString()}`);
      lines.push(c.body.trim());
      lines.push('');
    }
  }

  if (task.activity.length > 0) {
    lines.push('## Actividad');
    for (const a of task.activity) {
      const label = ACTIVITY_LABEL[a.type] ?? a.type;
      const payload = a.payload ? ` ${JSON.stringify(a.payload)}` : '';
      lines.push(`- ${a.createdAt.toISOString()} · ${a.actor.name} · ${label}${payload}`);
    }
  }

  return {
    taskId: task.id,
    taskNumber: task.taskNumber,
    projectSlug: task.project.slug,
    digest: lines.join('\n').slice(0, 40_000), // hard cap
  };
}
