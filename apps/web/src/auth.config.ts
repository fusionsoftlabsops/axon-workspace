/**
 * Edge-compatible Auth.js config — no providers, no DB. Consumed by both
 * `src/auth.ts` (where providers are added) and `src/middleware.ts` (which
 * runs at the edge and cannot use Prisma).
 */
import type { NextAuthConfig } from 'next-auth';

const APP_PREFIXES = ['/projects', '/settings'];
const PUBLIC_PREFIXES = ['/login', '/signup'];

export const authConfig = {
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [],
  callbacks: {
    authorized: ({ auth, request }) => {
      const { pathname } = request.nextUrl;
      const isLoggedIn = !!auth?.user;
      const isOnApp = APP_PREFIXES.some((p) => pathname.startsWith(p));
      const isOnPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

      if (isOnApp) return isLoggedIn;
      if (isLoggedIn && isOnPublic) {
        return Response.redirect(new URL('/projects', request.url));
      }
      return true;
    },
    jwt: ({ token, user }) => {
      if (user) {
        token.id = user.id;
        token.isMasterUser = (user as { isMasterUser?: boolean }).isMasterUser ?? false;
      }
      return token;
    },
    session: ({ session, token }) => {
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string;
        (session.user as { isMasterUser?: boolean }).isMasterUser = Boolean(token.isMasterUser);
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
