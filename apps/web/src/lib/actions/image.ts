'use server';

import { revalidatePath } from 'next/cache';
import { assertProjectMember } from '@/lib/auth/membership';
import { generateAndStoreProjectImage, imageGenerationConfigured, type ImageSize } from '@/lib/ai/image';
import type { ActionResult } from './projects';

/**
 * Genera una imagen de UI/UX con gpt-image-1 y la guarda como archivo del
 * proyecto (categoría IMAGE). Aparece en la pestaña Archivos.
 */
export async function generateProjectImageAction(
  slug: string,
  prompt: string,
  size: ImageSize = '1024x1024',
): Promise<ActionResult<{ fileId: string; name: string }>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos para generar' };
  if (!imageGenerationConfigured()) return { ok: false, error: 'Generación de imágenes no configurada (falta OPENAI_API_KEY)' };
  const clean = prompt.trim();
  if (clean.length < 3) return { ok: false, error: 'Describí la imagen (mínimo 3 caracteres)' };
  if (clean.length > 4000) return { ok: false, error: 'Prompt demasiado largo' };

  try {
    const out = await generateAndStoreProjectImage({
      projectId: ctx.projectId,
      slug,
      prompt: clean,
      userId: ctx.userId,
      size,
    });
    revalidatePath(`/projects/${slug}/files`);
    return { ok: true, data: { fileId: out.fileId, name: out.name } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error generando la imagen' };
  }
}
