import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { generateAndStoreProjectImage, imageGenerationConfigured } from '@/lib/ai/image';

const body = z.object({
  prompt: z.string().min(3).max(4000),
  name: z.string().max(100).optional(),
  size: z.enum(['1024x1024', '1536x1024', '1024x1536', 'auto']).optional(),
  quality: z.enum(['low', 'medium', 'high', 'auto']).optional(),
});

/**
 * Genera una imagen de UI/UX (gpt-image-1) y la persiste como archivo IMAGE del
 * proyecto. La usa el agente Diseño; también accesible por token.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const authd = await requireApiToken(req, ['tasks:write']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }
  const project = await prisma.project.findUnique({
    where: { slug },
    select: { id: true, members: { where: { userId: authd.userId }, select: { role: true } } },
  });
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }
  if (project.members[0]!.role === 'VIEWER') {
    return NextResponse.json({ error: 'viewer cannot generate' }, { status: 403 });
  }
  if (!imageGenerationConfigured()) {
    return NextResponse.json({ error: 'image generation not configured' }, { status: 501 });
  }

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  let out;
  try {
    out = await generateAndStoreProjectImage({
      projectId: project.id,
      slug,
      prompt: parsed.data.prompt,
      userId: authd.userId,
      name: parsed.data.name,
      size: parsed.data.size,
      quality: parsed.data.quality,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI error' }, { status: 502 });
  }

  await audit({
    actorId: authd.userId,
    action: 'project.image',
    resourceType: 'project',
    resourceId: project.id,
    projectId: project.id,
    payload: { via: 'api', fileId: out.fileId },
  });

  return NextResponse.json({ ok: true, ...out }, { status: 201 });
}
