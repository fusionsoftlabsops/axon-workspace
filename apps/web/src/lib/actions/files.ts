'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertProjectMember } from '@/lib/auth/membership';
import { audit } from '@/lib/audit';
import { getObjectBytes } from '@/lib/storage';
import { extractText, isImageMime } from '@/lib/ai/extract';
import type { ActionResult } from './projects';

export interface FileContextResult {
  id: string;
  isContext: boolean;
  /** True once the file contributes usable content (extracted text, or an image). */
  hasContent: boolean;
}

/**
 * Mark (or unmark) a project file as AI planning context. On enable we extract
 * and cache the document's text once; images carry no text but still count as
 * context (fed to the generator as vision). Extraction is best-effort: a file
 * with no extractable text is still marked, it just contributes nothing.
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
    select: { id: true, name: true, mimeType: true, storageKey: true, extractedText: true, category: true },
  });
  if (!file) return { ok: false, error: 'Archivo no encontrado' };

  const isImage = isImageMime(file.mimeType) || file.category === 'IMAGE';
  let extractedText = file.extractedText;

  // Extract once, on first enable, for non-image documents without a cache.
  if (on && !isImage && extractedText == null) {
    try {
      const bytes = await getObjectBytes(file.storageKey);
      const text = (await extractText(bytes, file.mimeType, file.name)).trim();
      extractedText = text.length > 0 ? text : '';
    } catch {
      extractedText = ''; // unreadable — mark anyway, it just adds nothing
    }
  }

  const updated = await prisma.projectFile.update({
    where: { id: file.id },
    data: { isContext: on, ...(on ? { extractedText } : {}) },
    select: { id: true, isContext: true, extractedText: true, mimeType: true, category: true },
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

  const hasContent =
    isImageMime(updated.mimeType) || updated.category === 'IMAGE' || (updated.extractedText?.length ?? 0) > 0;
  return { ok: true, data: { id: updated.id, isContext: updated.isContext, hasContent } };
}
