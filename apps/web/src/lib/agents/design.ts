/**
 * Diseño de una HU de UI por el agente Diseño (Aria): genera notas de diseño
 * implementables + un mockup de concepto (gpt-image-1) guardado en el store,
 * arma el spec de diseño, lo persiste en la HU, y publica `story.designed` para
 * que el SM asigne al Dev. El Dev implementa contra este spec.
 *
 * Si la generación de imágenes no está configurada o falla, se degrada con
 * gracia: persiste las notas SIN mockup (el diseño sigue siendo útil).
 */
import { prisma } from '@/lib/db';
import { generateDesignSpec } from '@/lib/ai/planner';
import { generateAndStoreProjectImage, imageGenerationConfigured } from '@/lib/ai/image';
import { publishDomainEvent } from '@/lib/agents/events';
import type { Lang } from '@/lib/ai/planner';

export interface DesignResult {
  notes: string;
  mockupFileId: string | null;
}

export async function designTaskForReadiness(opts: {
  projectId: string;
  taskId: string;
  slug: string;
  actorUserId: string;
  lang: Lang;
}): Promise<DesignResult> {
  const task = await prisma.task.findUnique({
    where: { id: opts.taskId },
    include: { state: { select: { id: true, name: true, category: true } }, assignee: { select: { id: true } } },
  });
  if (!task) throw new Error('HU no encontrada');

  const project = await prisma.project.findUnique({
    where: { id: opts.projectId },
    select: { name: true, description: true },
  });

  const spec = await generateDesignSpec(
    {
      title: task.title,
      description: task.description ?? '',
      acceptanceCriteria: task.acceptanceCriteria ?? '',
    },
    { name: project?.name ?? '', description: project?.description ?? null },
    opts.lang,
    opts.actorUserId,
    opts.projectId,
  );

  // Mockup de concepto (best-effort): degrada con gracia si no hay OpenAI/storage.
  let mockupFileId: string | null = null;
  if (imageGenerationConfigured()) {
    try {
      const img = await generateAndStoreProjectImage({
        projectId: opts.projectId,
        slug: opts.slug,
        prompt: spec.mockupPrompt,
        userId: opts.actorUserId,
        name: `mockup-hu-${task.taskNumber}`,
        size: '1536x1024',
      });
      mockupFileId = img.fileId;
    } catch (err) {
      console.error('[design] mockup generation failed, continuing with notes only:', err instanceof Error ? err.message : err);
    }
  }

  const designSpec =
    `## 🎨 Diseño (Aria)\n\n${spec.notes}\n\n` +
    (mockupFileId
      ? `### Mockup de concepto\n![mockup](/api/v1/projects/${opts.slug}/files/${mockupFileId})\n\n_Referencia visual generada con gpt-image-1; guardada en Archivos._`
      : `_Mockup no disponible (generación de imágenes no configurada); ver las notas de arriba._`);

  await prisma.task.update({
    where: { id: opts.taskId },
    data: { designSpec, designSpecAt: new Date() },
  });

  // El SM escucha `story.designed` y asigna la HU de UI (ya diseñada) al Dev.
  publishDomainEvent({
    type: 'story.designed',
    projectId: opts.projectId,
    storyId: task.id,
    storyNumber: task.taskNumber,
    toState: { id: task.state.id, name: task.state.name, category: task.state.category },
    actorId: opts.actorUserId,
    assigneeId: task.assignee?.id ?? null,
  });

  return { notes: spec.notes, mockupFileId };
}
