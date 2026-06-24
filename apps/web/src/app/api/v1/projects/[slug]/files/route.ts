import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertProjectMember } from '@/lib/auth/membership';
import { audit } from '@/lib/audit';
import { categorize, MAX_FILE_BYTES } from '@/lib/files';
import { buildKey, deleteObject, isStorageConfigured, putObject } from '@/lib/storage';

/** POST — upload one or more files into the project store (session auth).
 *  Any member except VIEWER may upload. Bytes go to MinIO under the project's
 *  folder, organized by type and month; Postgres keeps only the metadata. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) {
    const status = ctx.error === 'No autenticado' ? 401 : 404;
    return NextResponse.json({ error: ctx.error }, { status });
  }
  if (ctx.role === 'VIEWER') {
    return NextResponse.json({ error: 'Los visualizadores no pueden subir archivos' }, { status: 403 });
  }
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: 'Almacenamiento no configurado' }, { status: 503 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'multipart/form-data requerido' }, { status: 400 });

  const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return NextResponse.json({ error: 'No se recibió ningún archivo' }, { status: 400 });
  }

  const now = new Date();
  const ids: string[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `"${file.name}" supera el límite de ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB` },
        { status: 413 },
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'application/octet-stream';
    const name = file.name || 'archivo';
    const category = categorize(mimeType, name);
    const fileId = crypto.randomUUID();
    const key = buildKey(slug, category, fileId, name, now);

    // Bytes first, then metadata — on a DB failure, drop the orphan object.
    await putObject(key, buf, mimeType);
    try {
      await prisma.projectFile.create({
        data: {
          id: fileId,
          projectId: ctx.projectId,
          name,
          mimeType,
          size: file.size,
          category,
          storageKey: key,
          uploadedById: ctx.userId,
        },
        select: { id: true },
      });
    } catch (err) {
      await deleteObject(key).catch(() => {});
      throw err;
    }
    ids.push(fileId);
    await audit({
      actorId: ctx.userId,
      action: 'file.upload',
      resourceType: 'file',
      resourceId: fileId,
      projectId: ctx.projectId,
      payload: { name, size: file.size, mimeType, key },
    });
  }

  return NextResponse.json({ ok: true, ids }, { status: 201 });
}
