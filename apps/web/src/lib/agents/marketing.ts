/**
 * Kit de go-to-market de una HU por el agente Branding/SEO (Sol): genera copy de
 * landing + SEO + social (Claude) + un asset de marca/hero (gpt-image-1) guardado
 * en el store, y lo persiste en `Task.marketingKit`. Advisory: NO publica evento
 * ni gatea — enriquece la HU con material de lanzamiento. Degrada con gracia si
 * la generación de imágenes no está configurada (persiste solo el copy).
 */
import { prisma } from '@/lib/db';
import { generateMarketingKit, type Lang } from '@/lib/ai/planner';
import { generateAndStoreProjectImage, imageGenerationConfigured } from '@/lib/ai/image';

export interface MarketingResult {
  kit: string;
  assetFileId: string | null;
}

export async function marketingTaskKit(opts: {
  projectId: string;
  taskId: string;
  slug: string;
  actorUserId: string;
  lang: Lang;
}): Promise<MarketingResult> {
  const task = await prisma.task.findUnique({
    where: { id: opts.taskId },
    select: { taskNumber: true, title: true, description: true, acceptanceCriteria: true },
  });
  if (!task) throw new Error('HU no encontrada');

  const project = await prisma.project.findUnique({
    where: { id: opts.projectId },
    select: { name: true, description: true },
  });

  const out = await generateMarketingKit(
    { title: task.title, description: task.description ?? '', acceptanceCriteria: task.acceptanceCriteria ?? '' },
    { name: project?.name ?? '', description: project?.description ?? null },
    opts.lang,
    opts.actorUserId,
    opts.projectId,
  );

  // Asset de marca (best-effort): degrada con gracia si no hay OpenAI/storage.
  let assetFileId: string | null = null;
  if (imageGenerationConfigured()) {
    try {
      const img = await generateAndStoreProjectImage({
        projectId: opts.projectId,
        slug: opts.slug,
        prompt: out.assetPrompt,
        userId: opts.actorUserId,
        name: `brand-hu-${task.taskNumber}`,
        size: '1536x1024',
      });
      assetFileId = img.fileId;
    } catch (err) {
      console.error('[marketing] brand asset generation failed, continuing with copy only:', err instanceof Error ? err.message : err);
    }
  }

  const marketingKit =
    `## 📣 Marketing (Sol)\n\n${out.kit}\n\n` +
    (assetFileId
      ? `### Asset de marca\n![brand](/api/v1/projects/${opts.slug}/files/${assetFileId})\n\n_Generado con gpt-image-1; guardado en Archivos._`
      : `_Asset de marca no disponible (generación de imágenes no configurada)._`);

  await prisma.task.update({
    where: { id: opts.taskId },
    data: { marketingKit, marketingKitAt: new Date() },
  });
  return { kit: out.kit, assetFileId };
}
