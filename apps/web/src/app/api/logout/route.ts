import { NextResponse, type NextRequest } from 'next/server';
import { signOut } from '@/auth';

/**
 * Stable logout endpoint. Logout used to be a Server Action, but Server Action
 * IDs are build-specific: after a redeploy, a still-open tab posts a dead action
 * id and gets UnrecognizedActionError (404) — so logout silently failed and the
 * page never redirected. A plain route handler is addressed by URL, so it
 * survives redeploys. The header form POSTs here.
 */
export async function POST(_req: NextRequest) {
  await signOut({ redirect: false });
  // Use a RELATIVE Location, not new URL('/login', req.url): behind the proxy
  // (cloudflared → Traefik → container) req.url reflects the internal bind
  // (http://0.0.0.0:3000), so an absolute redirect would send the browser to an
  // unroutable 0.0.0.0:3000/login. A relative Location is resolved by the browser
  // against the public origin. (NextResponse.redirect requires an absolute URL,
  // so we set the header manually.)
  return new NextResponse(null, { status: 303, headers: { Location: '/login' } });
}
