/**
 * Full Auth.js config. El único método de login es SSO federado por OIDC
 * (provider `authentik`). Este módulo importa Prisma para el aprovisionamiento
 * JIT del usuario federado, así que corre en el runtime Node (no edge). El
 * middleware usa `auth.config.ts` en su lugar.
 *
 * El enlace por email + aprovisionamiento JIT + mapeo de grupos vive en
 * `lib/auth/oidc.ts` y se dispara en el callback `signIn`.
 */
import NextAuth, { type DefaultSession } from 'next-auth';
import type { Provider } from 'next-auth/providers';
import { authConfig } from '@/auth.config';
import { authentikProvider, extractGroups, upsertFederatedUser } from '@/lib/auth/oidc';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      isMasterUser: boolean;
    } & DefaultSession['user'];
  }

  interface User {
    isMasterUser?: boolean;
  }
}

// SSO federado (OIDC / Authentik): único método de login. Opt-in por env; si
// faltan las credenciales `authentikProvider()` devuelve null y no se agrega
// ningún provider (no hay login local de reemplazo).
const providers: Provider[] = [];
const oidc = authentikProvider();
if (oidc) providers.push(oidc);

export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  providers,
  callbacks: {
    ...authConfig.callbacks,
    /**
     * Para logins federados: enlaza por email o aprovisiona JIT el usuario en
     * DB y propaga SU id (cuid) + isMasterUser al `user` que fluye al callback
     * `jwt`, para que `session.user.id` sea el id de DB (no el `sub` del IdP).
     * Los logins por Credentials pasan sin cambios.
     */
    signIn: async ({ user, account, profile }) => {
      if (account?.provider !== 'authentik') return true;

      const email = (profile?.email ?? user?.email) as string | undefined;
      if (!email) return false;

      const db = await upsertFederatedUser({
        email,
        name: (profile?.name ?? user?.name) as string | undefined,
        groups: extractGroups(profile),
      });

      // Mutar `user` propaga estos valores al callback `jwt` (mismo objeto).
      user.id = db.id;
      (user as { isMasterUser?: boolean }).isMasterUser = db.isMasterUser;
      return true;
    },
  },
});
