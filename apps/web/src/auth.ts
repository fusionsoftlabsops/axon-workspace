/**
 * Full Auth.js config including the Credentials provider. This module imports
 * Prisma and password/TOTP verification, so it must run on the Node runtime
 * (not the edge). The middleware uses `auth.config.ts` instead.
 *
 * Además del login local (Credentials), agrega SSO federado por OIDC (provider
 * `authentik`) SOLO cuando están las env `AUTH_AUTHENTIK_*`. Sin ellas el
 * comportamiento es idéntico al anterior. El enlace por email + aprovisionamiento
 * JIT + mapeo de grupos vive en `lib/auth/oidc.ts` y se dispara en `signIn`.
 */
import NextAuth, { type DefaultSession } from 'next-auth';
import type { Provider } from 'next-auth/providers';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from '@/auth.config';
import { authorizeCredentials } from '@/lib/auth/credentials-authorize';
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

// Login local (password + TOTP): SIEMPRE presente.
const providers: Provider[] = [
  Credentials({
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
      totp: { label: 'TOTP', type: 'text' },
    },
    authorize: (raw) => authorizeCredentials(raw),
  }),
];

// SSO federado (OIDC / Authentik): opt-in por env. Si faltan las credenciales,
// `authentikProvider()` devuelve null y el provider no se agrega.
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
