'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertProjectMember } from '@/lib/auth/membership';
import { audit } from '@/lib/audit';
import { getObjectBytes } from '@/lib/storage';
import { extractText, isImageMime } from '@/lib/ai/extract';
import { cleanToMarkdown } from '@/lib/ai/doc-to-markdown';
import type { ActionResult } from './projects';

export type ContextStatus = 'NONE' | 'GENERATING' | 'READY' | 'FAILED';

export interface FileContextResult {
  id: string;
  isContext: boolean;
  contextStatus: ContextStatus;
}

function isImageFile(mimeType: string, category: string): boolean {
  return isImageMime(mimeType) || category === 'IMAGE';
}

/**
 * Step 1 — "Generar contexto" (documents only). Extracts the raw text once
 * (0 tokens, cached) and converts it to a clean Markdown artifact via the infra
 * LLM. Runs in the background; the UI polls the file's contextStatus. No-op when
 * already READY (unless `force`), so re-use never re-spends.
 */
export async function generateFileContextAction(
  slug: string,
  fileId: string,
  opts?: { force?: boolean },
): Promise<ActionResult<FileContextResult>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const file = await prisma.projectFile.findFirst({
    where: { id: fileId, projectId: ctx.projectId },
    select: { id: true, name: true, mimeType: true, category: true, contextStatus: true },
  });
  if (!file) return { ok: false, error: 'Archivo no encontrado' };
  if (isImageFile(file.mimeType, file.category)) {
    return { ok: false, error: 'Las imágenes no requieren generar contexto; márcalas para usarlas directamente' };
  }
  if (file.contextStatus === 'GENERATING') {
    return { ok: true, data: { id: file.id, isContext: false, contextStatus: 'GENERATING' } };
  }
  if (file.contextStatus === 'READY' && !opts?.force) {
    return { ok: true, data: { id: file.id, isContext: false, contextStatus: 'READY' } };
  }

  await prisma.projectFile.update({
    where: { id: file.id },
    data: { contextStatus: 'GENERATING', contextError: null },
  });
  await audit({
    actorId: ctx.userId,
    action: 'file.context.generate',
    resourceType: 'file',
    resourceId: file.id,
    projectId: ctx.projectId,
    payload: { name: file.name },
  });

  // Background run (the Node process is long-lived/self-hosted); state lands in
  // the DB so the UI can poll. Mirrors runProjectAnalysis.
  const bg = { fileId: file.id, slug, projectId: ctx.projectId };
  void runContextGeneration(bg);

  revalidatePath(`/projects/${slug}/files`);
  return { ok: true, data: { id: file.id, isContext: false, contextStatus: 'GENERATING' } };
}

async function runContextGeneration({
  fileId,
  slug,
  projectId,
}: {
  fileId: string;
  slug: string;
  projectId: string;
}): Promise<void> {
  try {
    const file = await prisma.projectFile.findFirst({
      where: { id: fileId, projectId },
      select: { name: true, mimeType: true, storageKey: true, extractedText: true },
    });
    if (!file) return;

    // Ensure the raw extraction cache (0 tokens). Reused across regenerations.
    let extractedText = file.extractedText;
    if (extractedText == null) {
      const bytes = await getObjectBytes(file.storageKey);
      extractedText = (await extractText(bytes, file.mimeType, file.name)).trim();
      await prisma.projectFile.update({ where: { id: fileId }, data: { extractedText } });
    }

    if (!extractedText) {
      await prisma.projectFile.update({
        where: { id: fileId },
        data: { contextStatus: 'FAILED', contextError: 'No se pudo extraer texto del documento' },
      });
      revalidatePath(`/projects/${slug}/files`);
      return;
    }

    const markdown = await cleanToMarkdown(extractedText, file.name);
    await prisma.projectFile.update({
      where: { id: fileId },
      data: { contextStatus: 'READY', contextMarkdown: markdown, contextError: null },
    });
  } catch (err) {
    await prisma.projectFile
      .update({
        where: { id: fileId },
        data: {
          contextStatus: 'FAILED',
          contextError: err instanceof Error ? err.message : 'Error generando el contexto',
        },
      })
      .catch(() => {});
  }
  revalidatePath(`/projects/${slug}/files`);
  revalidatePath(`/projects/${slug}/plan`);
}

/**
 * Step 2 — "Usar en el plan": toggle whether the file grounds the AI planning
 * and chat (the user's decision, persisted). Documents must have a READY context
 * artifact first; images can be used directly (fed as vision).
 */
export async function setFileContextAction(
  slug: string,
  fileId: string,
  on: boolean,
): Promise<ActionResult<FileContextResult>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const file = await prisma.projectFile.findFirst({
    where: { id: fileId, projectId: ctx.projectId },
    select: { id: true, name: true, mimeType: true, category: true, contextStatus: true },
  });
  if (!file) return { ok: false, error: 'Archivo no encontrado' };

  const isImage = isImageFile(file.mimeType, file.category);
  if (on && !isImage && file.contextStatus !== 'READY') {
    return { ok: false, error: 'Genera el contexto del archivo primero' };
  }

  const updated = await prisma.projectFile.update({
    where: { id: file.id },
    data: { isContext: on },
    select: { id: true, isContext: true, contextStatus: true },
  });

  await audit({
    actorId: ctx.userId,
    action: on ? 'file.context.add' : 'file.context.remove',
    resourceType: 'file',
    resourceId: file.id,
    projectId: ctx.projectId,
    payload: { name: file.name },
  });

  revalidatePath(`/projects/${slug}/files`);
  revalidatePath(`/projects/${slug}/plan`);

  return {
    ok: true,
    data: { id: updated.id, isContext: updated.isContext, contextStatus: updated.contextStatus as ContextStatus },
  };
}
