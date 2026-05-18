/**
 * Full Auth.js config including the Credentials provider. This module imports
 * Prisma and password/TOTP verification, so it must run on the Node runtime
 * (not the edge). The middleware uses `auth.config.ts` instead.
 */
import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from '@/auth.config';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { openTotpSecret, verifyTotp } from '@/lib/auth/totp';
import { loginSchema } from '@admin/shared/schemas';

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

export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        totp: { label: 'TOTP', type: 'text' },
      },
      authorize: async (raw) => {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
        if (!user) return null;

        const passOk = await verifyPassword(user.passwordHash, parsed.data.password);
        if (!passOk) return null;

        if (user.totpSecretEncrypted && user.totpNonce) {
          if (!parsed.data.totp) {
            throw new Error('TOTP_REQUIRED');
          }
          const secret = openTotpSecret(user.totpSecretEncrypted, user.totpNonce);
          if (!verifyTotp(secret, parsed.data.totp)) {
            return null;
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          isMasterUser: user.isMasterUser,
        };
      },
    }),
  ],
});
