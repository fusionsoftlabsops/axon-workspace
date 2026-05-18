import { prisma } from '@/lib/db';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: 'healthy',
      db: 'connected',
      uptime: Math.round(process.uptime()),
      latencyMs: Date.now() - started,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        db: 'disconnected',
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - started,
      },
      { status: 503 },
    );
  }
}
