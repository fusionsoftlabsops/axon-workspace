/**
 * Diseño técnico de una HU compleja por el Arquitecto/Tech Lead (agente Dax):
 * genera enfoque de arquitectura + decisiones + riesgos + descomposición, y lo
 * persiste en `Task.techDesign`. Advisory: NO publica evento de dominio ni gatea
 * el flujo — enriquece la HU para que el Dev tenga guía de alto nivel (el impl-plan
 * del Dev la incorpora). Reutiliza el generador Claude `generateTechDesign`.
 */
import { prisma } from '@/lib/db';
import { generateTechDesign, type Lang } from '@/lib/ai/planner';

export async function designTaskArchitecture(opts: {
  projectId: string;
  taskId: string;
  actorUserId: string;
  lang: Lang;
}): Promise<string> {
  const task = await prisma.task.findUnique({
    where: { id: opts.taskId },
    select: { title: true, description: true, acceptanceCriteria: true, priority: true },
  });
  if (!task) throw new Error('HU no encontrada');

  const project = await prisma.project.findUnique({
    where: { id: opts.projectId },
    select: { name: true, description: true },
  });

  const design = await generateTechDesign(
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
    data: { techDesign: design, techDesignAt: new Date() },
  });
  return design;
}
