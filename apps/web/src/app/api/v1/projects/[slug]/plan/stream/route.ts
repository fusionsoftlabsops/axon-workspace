import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertProjectMember } from '@/lib/auth/membership';
import { subscribe, publish, planChannel, type RealtimeEvent } from '@/lib/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SSE stream of a plan's collaborative chat: live messages, typing pings and
 * presence (join/leave). Clients connect with EventSource; sending happens via
 * server actions (planChatAction / planTypingAction) which publish here.
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

  const plan = await prisma.projectPlan.findFirst({
    where: { projectId: ctx.projectId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!plan) {
    return new Response(JSON.stringify({ error: 'Plan no encontrado' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const channel = planChannel(plan.id);
  const me = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
  const myName = me?.name ?? '';
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
          /* controller already closed */
        }
      };

      // Initial comment so the connection opens promptly.
      controller.enqueue(encoder.encode(`: connected\n\n`));

      unsub = await subscribe(channel, send);

      // Announce presence and ask others to re-announce so this client learns
      // who is already here.
      await publish(channel, { type: 'presence', state: 'join', userId: ctx.userId, name: myName });

      keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* ignore */
        }
      }, 25_000);
    },
    async cancel() {
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      if (unsub) unsub();
      await publish(channel, { type: 'presence', state: 'leave', userId: ctx.userId, name: myName });
    },
  });

  // Abort path (client navigates away): mirror cancel() cleanup.
  req.signal.addEventListener('abort', () => {
    if (closed) return;
    closed = true;
    if (keepAlive) clearInterval(keepAlive);
    if (unsub) unsub();
    void publish(channel, { type: 'presence', state: 'leave', userId: ctx.userId, name: myName });
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
