import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertProjectMember } from '@/lib/auth/membership';
import { audit } from '@/lib/audit';

/** GET — stream a file's bytes to a project member. Inline by default (so
 *  images render in <img>); `?download=1` forces a download. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) {
    const status = ctx.error === 'No autenticado' ? 401 : 404;
    return NextResponse.json({ error: ctx.error }, { status });
  }

  const file = await prisma.projectFile.findFirst({
    where: { id, projectId: ctx.projectId },
    select: { name: true, mimeType: true, data: true },
  });
  if (!file) return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 });

  const download = req.nextUrl.searchParams.get('download') === '1';
  const disposition = download ? 'attachment' : 'inline';
  // RFC 5987 filename* for non-ASCII names.
  const encoded = encodeURIComponent(file.name);

  return new NextResponse(new Uint8Array(file.data), {
    status: 200,
    headers: {
      'Content-Type': file.mimeType || 'application/octet-stream',
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encoded}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** DELETE — remove a file. Allowed for the uploader or any OWNER/ADMIN. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) {
    const status = ctx.error === 'No autenticado' ? 401 : 404;
    return NextResponse.json({ error: ctx.error }, { status });
  }

  const file = await prisma.projectFile.findFirst({
    where: { id, projectId: ctx.projectId },
    select: { id: true, name: true, uploadedById: true },
  });
  if (!file) return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 });

  const canManage = ctx.role === 'OWNER' || ctx.role === 'ADMIN';
  if (file.uploadedById !== ctx.userId && !canManage) {
    return NextResponse.json({ error: 'Sin permisos para eliminar este archivo' }, { status: 403 });
  }

  await prisma.projectFile.delete({ where: { id: file.id } });
  await audit({
    actorId: ctx.userId,
    action: 'file.delete',
    resourceType: 'file',
    resourceId: file.id,
    projectId: ctx.projectId,
    payload: { name: file.name },
  });

  return NextResponse.json({ ok: true });
}
