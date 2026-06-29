import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertProjectMember } from '@/lib/auth/membership';

/** GET — download a file's generated context artifact (the AI-cleaned Markdown)
 *  served straight from the DB column. 404 until the context is READY. */
export async function GET(
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
    select: { name: true, contextStatus: true, contextMarkdown: true },
  });
  if (!file) return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 });
  if (file.contextStatus !== 'READY' || !file.contextMarkdown) {
    return NextResponse.json({ error: 'El contexto aún no está generado' }, { status: 404 });
  }

  // <original name without extension>.md
  const base = file.name.replace(/\.[^.]+$/, '') || file.name;
  const encoded = encodeURIComponent(`${base}.md`);

  return new NextResponse(file.contextMarkdown, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`,
      'Cache-Control': 'private, max-age=60',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
