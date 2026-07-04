/**
 * Generación de imágenes de UI/UX con OpenAI `gpt-image-1` (mockups de concepto +
 * assets). Separada de planner.ts (Anthropic) porque usa OTRO proveedor. La
 * imagen generada se persiste en el bucket del proyecto como un ProjectFile
 * (categoría IMAGE), reutilizable y visible en la pestaña Archivos.
 *
 * Nota de expectativa: la salida es una IMAGEN (inspiración + asset), NO código
 * UI implementable. El agente Diseño (Aria) la usa como norte visual junto a
 * notas de diseño estructuradas.
 */
import crypto from 'node:crypto';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { buildKey, putObject, isStorageConfigured } from '@/lib/storage';

export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536' | 'auto';
export type ImageQuality = 'low' | 'medium' | 'high' | 'auto';

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';

export function imageGenerationConfigured(): boolean {
  try {
    return !!env().OPENAI_API_KEY;
  } catch {
    return false;
  }
}

/**
 * Genera una imagen con gpt-image-1 y devuelve el PNG decodificado. gpt-image-1
 * SIEMPRE responde en base64 (`b64_json`), no URL.
 */
export async function generateImage(opts: {
  prompt: string;
  size?: ImageSize;
  quality?: ImageQuality;
  timeoutMs?: number;
}): Promise<Buffer> {
  const key = env().OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY no configurada');

  const res = await fetch(OPENAI_IMAGES_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env().OPENAI_IMAGE_MODEL,
      prompt: opts.prompt,
      size: opts.size ?? '1024x1024',
      quality: opts.quality ?? 'high',
      n: 1,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`gpt-image ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('gpt-image no devolvió imagen');
  return Buffer.from(b64, 'base64');
}

export interface GeneratedProjectImage {
  fileId: string;
  name: string;
  size: number;
}

/**
 * Genera una imagen y la PERSISTE como ProjectFile (categoría IMAGE) en el
 * bucket del proyecto. Devuelve el fileId para verla/descargarla por la API de
 * archivos existente.
 */
export async function generateAndStoreProjectImage(opts: {
  projectId: string;
  slug: string;
  prompt: string;
  userId: string;
  name?: string;
  size?: ImageSize;
  quality?: ImageQuality;
}): Promise<GeneratedProjectImage> {
  if (!isStorageConfigured()) throw new Error('Storage no configurado');
  const png = await generateImage({ prompt: opts.prompt, size: opts.size, quality: opts.quality });

  const id = crypto.randomUUID();
  const name = (opts.name?.trim() || `imagen-${id.slice(0, 8)}`).slice(0, 100) + '.png';
  const now = new Date();
  const storageKey = buildKey(opts.slug, 'IMAGE', id, name, now);
  await putObject(storageKey, png, 'image/png');

  await prisma.projectFile.create({
    data: {
      id,
      projectId: opts.projectId,
      name,
      mimeType: 'image/png',
      size: png.byteLength,
      category: 'IMAGE',
      storageKey,
      uploadedById: opts.userId,
    },
  });
  return { fileId: id, name, size: png.byteLength };
}
