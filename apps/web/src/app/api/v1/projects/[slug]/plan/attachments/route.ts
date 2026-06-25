import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertProjectMember } from '@/lib/auth/membership';
import { isStorageConfigured, putObject, deleteObject } from '@/lib/storage';
import { extractText, isImageMime } from '@/lib/ai/extract';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per attachment

function sanitize(name: string): string {
  return (
    (name || 'archivo')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'archivo'
  );
}

/** POST — attach context files (images / PDF / text) to the project's AI plan.
 *  Images are stored for native multimodal use; documents also get their text
 *  extracted. Session auth; VIEWER cannot attach. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) {
    const status = ctx.error === 'No autenticado' ? 401 : 404;
    return NextResponse.json({ error: ctx.error }, { status });
  }
  if (ctx.role === 'VIEWER') {
    return NextResponse.json({ error: 'Los visualizadores no pueden adjuntar contexto' }, { status: 403 });
  }
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: 'Almacenamiento no configurado' }, { status: 503 });
  }

  const plan = await prisma.projectPlan.findFirst({
    where: { projectId: ctx.projectId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!plan) return NextResponse.json({ error: 'Plan no encontrado' }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'multipart/form-data requerido' }, { status: 400 });
  const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return NextResponse.json({ error: 'No se recibió ningún archivo' }, { status: 400 });
  }

  const ids: string[] = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `"${file.name}" supera el límite de ${Math.round(MAX_BYTES / 1024 / 1024)} MB` },
        { status: 413 },
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'application/octet-stream';
    const name = file.name || 'archivo';
    const isImage = isImageMime(mimeType);
    const attId = crypto.randomUUID();
    const key = `plans/${ctx.projectId}/${attId}-${sanitize(name)}`;

    await putObject(key, buf, mimeType);
    let extracted = '';
    if (!isImage) {
      extracted = await extractText(buf, mimeType, name).catch(() => '');
    }

    try {
      await prisma.planAttachment.create({
        data: {
          id: attId,
          planId: plan.id,
          kind: isImage ? 'IMAGE' : 'DOCUMENT',
          name,
          mimeType,
          size: file.size,
          storageKey: key,
          extractedText: extracted || null,
        },
        select: { id: true },
      });
    } catch (err) {
      await deleteObject(key).catch(() => {});
      throw err;
    }
    ids.push(attId);
  }

  return NextResponse.json({ ok: true, ids }, { status: 201 });
}
