/**
 * Federación por OIDC (IdP = Authentik) — capa de dominio, aislada de NextAuth
 * para poder testearla sin instanciar el runtime de Auth.js.
 *
 * Convive con el login local (Credentials): el provider `authentik` SOLO se
 * agrega si están las tres env `AUTH_AUTHENTIK_*` (ver `authentikProvider`). El
 * `signIn` de `auth.ts` delega en `upsertFederatedUser` para enlazar por email
 * o aprovisionar just-in-time un usuario federado (SIN vault: los campos cripto
 * quedan null; el usuario puede inicializar su vault opt-in luego, ver
 * `lib/actions/vault.ts`).
 *
 * Seguridad: estos claims llegan del `profile` YA verificado por Auth.js contra
 * el id_token del IdP; no confiamos en datos crudos del cliente.
 */
import Authentik from 'next-auth/providers/authentik';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';

/** Config de provider que devuelve el factory de Authentik. */
type AuthentikConfig = ReturnType<typeof Authentik>;

/** Config OIDC mínima. Todas opcionales: sin las tres, no hay provider. */
export interface OidcConfig {
  id?: string;
  secret?: string;
  issuer?: string;
}

/**
 * Construye el provider Authentik SOLO si están las tres credenciales. Puro
 * (no lee env ni DB) para testear "provider presente únicamente con env".
 */
export function buildAuthentikProvider(cfg: OidcConfig): AuthentikConfig | null {
  if (!cfg.id || !cfg.secret || !cfg.issuer) return null;
  return Authentik({
    clientId: cfg.id,
    clientSecret: cfg.secret,
    issuer: cfg.issuer,
    // `allowDangerousEmailAccountLinking` habilita el enlace por email (misma
    // persona ⇒ misma cuenta). El enlace real lo hace `upsertFederatedUser`.
    allowDangerousEmailAccountLinking: true,
  });
}

/** ¿Está configurado el SSO OIDC? (las tres env presentes). */
export function isOidcConfigured(): boolean {
  const e = env();
  return Boolean(e.AUTH_AUTHENTIK_ID && e.AUTH_AUTHENTIK_SECRET && e.AUTH_AUTHENTIK_ISSUER);
}

/** Provider Authentik a partir de las env, o null si falta configuración. */
export function authentikProvider(): AuthentikConfig | null {
  const e = env();
  return buildAuthentikProvider({
    id: e.AUTH_AUTHENTIK_ID,
    secret: e.AUTH_AUTHENTIK_SECRET,
    issuer: e.AUTH_AUTHENTIK_ISSUER,
  });
}

/**
 * Extrae el claim `groups` (nombres de grupo de Authentik) de forma defensiva.
 * Si el IdP no lo incluye, devuelve undefined y el mapeo a membership se omite
 * sin romper (requiere que la app de Authentik exponga el claim `groups`).
 */
export function extractGroups(profile: unknown): string[] | undefined {
  const g = (profile as { groups?: unknown } | null | undefined)?.groups;
  if (!Array.isArray(g)) return undefined;
  const names = g.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return names.length > 0 ? names : undefined;
}

/**
 * Mapea grupos del IdP → membresías de proyecto. Un grupo cuyo NOMBRE coincide
 * (case-insensitive) con el `slug` de un proyecto existente concede rol MEMBER.
 * Reusa el patrón de auto-join de `signupAction` (createMany + skipDuplicates),
 * por lo que es idempotente: no duplica membresías de usuarios ya enlazados.
 */
export async function mapGroupsToMemberships(
  userId: string,
  groups: string[] | undefined,
): Promise<void> {
  if (!groups || groups.length === 0) return;
  const slugs = [...new Set(groups.map((g) => g.toLowerCase().trim()).filter(Boolean))];
  if (slugs.length === 0) return;

  const projects = await prisma.project.findMany({
    where: { slug: { in: slugs } },
    select: { id: true },
  });
  for (const p of projects) {
    await prisma.projectMember.createMany({
      data: { projectId: p.id, userId, role: 'MEMBER' },
      skipDuplicates: true,
    });
  }
}

export interface FederatedProfile {
  email: string;
  name?: string | null;
  groups?: string[];
}

/**
 * Enlaza por email o aprovisiona JIT un usuario federado, y sincroniza sus
 * membresías desde `groups`. Devuelve la identidad de DB (id + isMasterUser)
 * para propagarla al JWT. Zero-knowledge intacto: NO se crea material de vault
 * (passwordHash/publicKey/… quedan null hasta que el usuario lo inicialice).
 */
export async function upsertFederatedUser(
  profile: FederatedProfile,
): Promise<{ id: string; isMasterUser: boolean }> {
  const email = profile.email.toLowerCase().trim();

  // Enlace por email: si la persona ya existe (local o federada), es la misma.
  let user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, isMasterUser: true },
  });

  // JIT-provision: usuario federado sin contraseña ni vault.
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: profile.name?.trim() || email,
        // passwordHash / publicKey / encryptedPrivateKey / encryptedPrivKeyNonce /
        // kdfSalt quedan null: es un usuario federado sin login local ni vault.
      },
      select: { id: true, isMasterUser: true },
    });
  }

  // Mapeo de grupos → membresías (idempotente; también refresca a los enlazados).
  await mapGroupsToMemberships(user.id, profile.groups);

  return user;
}
