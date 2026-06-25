import { NextResponse, type NextRequest } from 'next/server';
import { signOut } from '@/auth';

/**
 * Stable logout endpoint. Logout used to be a Server Action, but Server Action
 * IDs are build-specific: after a redeploy, a still-open tab posts a dead action
 * id and gets UnrecognizedActionError (404) — so logout silently failed and the
 * page never redirected. A plain route handler is addressed by URL, so it
 * survives redeploys. The header form POSTs here.
 */
export async function POST(req: NextRequest) {
  await signOut({ redirect: false });
  return NextResponse.redirect(new URL('/login', req.url), { status: 303 });
}
