/**
 * API token authentication for the /api/v1 routes used by the MCP server
 * and any other programmatic client.
 *
 * Tokens are issued as `ad_pk_<random>`. We store sha256(token) in the DB
 * — sha256 is fast enough to verify on every request (vs argon2 which is
 * deliberately slow), and the token has enough entropy that brute-forcing
 * is not feasible.
 */
import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import type { ApiScope } from '@admin/shared/types';

const TOKEN_PREFIX = 'ad_pk_';
const TOKEN_BYTES = 32; // → 43 base64url chars

export interface AuthedRequest {
  userId: string;
  tokenId: string;
  scopes: ApiScope[];
  projectSlugs: string[]; // empty = unrestricted
}

export function generateApiToken(): { plain: string; hash: string; prefix: string } {
  const random = randomBytes(TOKEN_BYTES).toString('base64url');
  const plain = `${TOKEN_PREFIX}${random}`;
  const hash = createHash('sha256').update(plain).digest('hex');
  return { plain, hash, prefix: plain.slice(0, 12) };
}

export function hashApiToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

/**
 * Authenticate a request via the `Authorization: Bearer ad_pk_...` header.
 * Returns an `AuthedRequest` on success, or a NextResponse to forward on
 * failure (so callers can `return` it directly).
 */
export async function requireApiToken(
  req: NextRequest,
  required: ApiScope[],
): Promise<AuthedRequest | NextResponse> {
  const header = req.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    return NextResponse.json({ error: 'missing bearer token' }, { status: 401 });
  }
  const plain = header.slice(7).trim();
  if (!plain.startsWith(TOKEN_PREFIX)) {
    return NextResponse.json({ error: 'invalid token format' }, { status: 401 });
  }

  const tokenHash = hashApiToken(plain);
  const token = await prisma.apiToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      scopes: true,
      projectSlugs: true,
      revokedAt: true,
      expiresAt: true,
    },
  });

  if (!token || token.revokedAt) {
    return NextResponse.json({ error: 'invalid or revoked token' }, { status: 401 });
  }
  if (token.expiresAt && token.expiresAt < new Date()) {
    return NextResponse.json({ error: 'token expired' }, { status: 401 });
  }

  for (const scope of required) {
    if (!token.scopes.includes(scope)) {
      return NextResponse.json({ error: `missing scope: ${scope}` }, { status: 403 });
    }
  }

  // Best-effort lastUsedAt bookkeeping (don't block the response).
  prisma.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    userId: token.userId,
    tokenId: token.id,
    scopes: token.scopes as ApiScope[],
    projectSlugs: token.projectSlugs,
  };
}

/** Check whether this token is scoped to a particular project slug. */
export function tokenAllowsProject(auth: AuthedRequest, projectSlug: string): boolean {
  return auth.projectSlugs.length === 0 || auth.projectSlugs.includes(projectSlug);
}

/**
 * Auth helper que prueba sesión web (cookie) primero, y si no hay sesión,
 * cae a Bearer token. Usado por endpoints que sirven al UI (fetch desde el
 * browser usa cookies) Y al MCP (que usa tokens). Si la sesión es válida,
 * se asume que el usuario tiene todos los scopes — el control de membership
 * sigue siendo necesario por endpoint.
 */
export async function requireSessionOrToken(
  req: NextRequest,
  required: ApiScope[],
): Promise<{ userId: string; via: 'session' | 'token'; scopes: ApiScope[]; projectSlugs: string[] } | NextResponse> {
  // Intentar sesión web primero (importamos dinámicamente para evitar ciclos)
  const { auth } = await import('@/auth');
  const session = await auth();
  if (session?.user?.id) {
    return {
      userId: session.user.id,
      via: 'session',
      scopes: required, // sesión web implícitamente tiene todos los scopes pedidos
      projectSlugs: [],
    };
  }
  // Fallback: bearer token
  const tokResult = await requireApiToken(req, required);
  if (tokResult instanceof NextResponse) return tokResult;
  return { ...tokResult, via: 'token' as const };
}
