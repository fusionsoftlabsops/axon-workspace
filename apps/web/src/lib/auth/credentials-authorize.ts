/**
 * Lógica del `authorize` del provider Credentials, extraída de `auth.ts` para
 * poder testearla sin instanciar el runtime de NextAuth.
 *
 * Login local password + TOTP INTACTO. Único cambio de comportamiento: un
 * usuario federado (SSO) puede tener `passwordHash` null → se rechaza el login
 * por Credentials SIN crashear (no puede autenticarse con contraseña).
 */
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { openTotpSecret, verifyTotp } from '@/lib/auth/totp';
import { loginSchema } from '@admin/shared/schemas';

export interface AuthorizedUser {
  id: string;
  email: string;
  name: string;
  isMasterUser: boolean;
}

/**
 * Verifica email + contraseña (+ TOTP si está habilitado). Devuelve el usuario
 * o null si las credenciales no son válidas. Lanza `TOTP_REQUIRED` cuando falta
 * el código y el usuario tiene TOTP.
 */
export async function authorizeCredentials(raw: unknown): Promise<AuthorizedUser | null> {
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return null;

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user) return null;

  // Usuario federado sin contraseña local: no puede loguear por Credentials.
  if (!user.passwordHash) return null;

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
}
