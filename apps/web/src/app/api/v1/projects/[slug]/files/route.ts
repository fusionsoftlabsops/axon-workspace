import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertProjectMember } from '@/lib/auth/membership';
import { audit } from '@/lib/audit';
import { categorize, MAX_FILE_BYTES } from '@/lib/files';

/** POST — upload one or more files into the project store (session auth).
 *  Any member except VIEWER may upload. Files are stored as bytea. */
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

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'multipart/form-data requerido' }, { status: 400 });

  const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return NextResponse.json({ error: 'No se recibió ningún archivo' }, { status: 400 });
  }

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
    const created = await prisma.projectFile.create({
      data: {
        projectId: ctx.projectId,
        name: file.name || 'archivo',
        mimeType,
        size: file.size,
        category: categorize(mimeType, file.name),
        data: buf,
        uploadedById: ctx.userId,
      },
      select: { id: true },
    });
    ids.push(created.id);
    await audit({
      actorId: ctx.userId,
      action: 'file.upload',
      resourceType: 'file',
      resourceId: created.id,
      projectId: ctx.projectId,
      payload: { name: file.name, size: file.size, mimeType },
    });
  }

  return NextResponse.json({ ok: true, ids }, { status: 201 });
}
