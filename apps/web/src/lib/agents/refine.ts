/**
 * Refinamiento de una HU por el Product Owner (agente Iris): genera descripción
 * clara + criterios de aceptación verificables + prioridad (DoR), los persiste, y
 * publica `story.refined` para que el SM la asigne al Dev. Reutiliza el generador
 * Claude `refineStoryForReadiness`.
 */
import { prisma } from '@/lib/db';
import { refineStoryForReadiness, type StoryRefinement } from '@/lib/ai/planner';
import { publishDomainEvent } from '@/lib/agents/events';
import type { Lang } from '@/lib/ai/planner';

export async function refineTaskForReadiness(opts: {
  projectId: string;
  taskId: string;
  actorUserId: string;
  lang: Lang;
}): Promise<StoryRefinement> {
  const task = await prisma.task.findUnique({
    where: { id: opts.taskId },
    include: { state: { select: { id: true, name: true, category: true } }, assignee: { select: { id: true } } },
  });
  if (!task) throw new Error('HU no encontrada');

  const project = await prisma.project.findUnique({
    where: { id: opts.projectId },
    select: { name: true, description: true },
  });

  const refinement = await refineStoryForReadiness(
    {
      title: task.title,
      description: task.description ?? '',
      acceptanceCriteria: task.acceptanceCriteria ?? '',
      priority: task.priority,
    },
    { name: project?.name ?? '', description: project?.description ?? null },
    opts.lang,
    opts.actorUserId,
    opts.projectId,
  );

  await prisma.task.update({
    where: { id: opts.taskId },
    data: {
      description: refinement.description,
      acceptanceCriteria: refinement.acceptanceCriteria,
      priority: refinement.priority,
    },
  });

  // El SM escucha `story.refined` y asigna la HU (ya lista) al Dev.
  publishDomainEvent({
    type: 'story.refined',
    projectId: opts.projectId,
    storyId: task.id,
    storyNumber: task.taskNumber,
    toState: { id: task.state.id, name: task.state.name, category: task.state.category },
    actorId: opts.actorUserId,
    assigneeId: task.assignee?.id ?? null,
  });

  return refinement;
}
