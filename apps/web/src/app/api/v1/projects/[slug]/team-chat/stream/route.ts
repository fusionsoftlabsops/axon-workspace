import { type NextRequest } from 'next/server';
import { assertProjectMember } from '@/lib/auth/membership';
import { subscribe, type RealtimeEvent } from '@/lib/realtime';
import { teamChannel } from '@/lib/agents/team-chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SSE del chat del equipo: los mensajes nuevos (agentes y humanos) llegan en
 * vivo al browser. Espejo del stream del chat del plan; el envío ocurre por
 * server action (humanos) o por la API con token (agentes).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) {
    const status = ctx.error === 'No autenticado' ? 401 : 404;
    return new Response(JSON.stringify({ error: ctx.error }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const channel = teamChannel(ctx.projectId);
  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: RealtimeEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* controller cerrado */
        }
      };
      controller.enqueue(encoder.encode(`: connected\n\n`));
      unsub = await subscribe(channel, send);
      keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* ignore */
        }
      }, 25_000);
    },
    cancel() {
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      if (unsub) unsub();
    },
  });

  req.signal.addEventListener('abort', () => {
    if (closed) return;
    closed = true;
    if (keepAlive) clearInterval(keepAlive);
    if (unsub) unsub();
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
