/**
 * Cliente REST del proveedor git para la sección Repositorios del plan: crear
 * repos y leer acceso de colaboradores. Autenticado con un PAT de org desde el
 * env (GITHUB_TOKEN), opcionalmente acotado a GITHUB_ORG. El trabajo de red vive
 * en `@/lib/repo/provider` (GitHub o Forgejo/Gitea según GIT_PROVIDER); acá sólo
 * queda el cableado del env. Opcional — cuando falta el token, isGithubConfigured()
 * es false y los callers degradan con gracia. El token nunca se loguea.
 */
import { env } from '@/lib/env';
import { gitConfigFromEnv, gitProviderFromEnv, parseRepoRef, type CreatedRepo, type RepoPermission } from '@/lib/repo/provider';

export type { CreatedRepo, RepoPermission };

export function isGithubConfigured(): boolean {
  return Boolean(env().GITHUB_TOKEN);
}
export function githubOrg(): string | undefined {
  return env().GITHUB_ORG || undefined;
}

/** Parsea una URL/identificador de repo a `owner/repo` (descarta host, .git,
 *  barras finales) contra el host del proveedor configurado. */
export function parseRepoFullName(input: string): string | null {
  const s = (input || '').trim();
  if (!s) return null;
  const host = gitConfigFromEnv().host;
  // ¿Ya viene como owner/repo?
  const direct = s.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (direct && !s.includes('://') && !s.includes(host)) return `${direct[1]}/${direct[2]}`;
  const ref = parseRepoRef(s, host);
  return ref ? `${ref.owner}/${ref.repo}` : null;
}

/** Crea un repo bajo la org (o el usuario del token si no hay org). Idempotente
 *  ante "el nombre ya existe" — devuelve la identidad del repo con existed=true. */
export async function createRepo(
  name: string,
  opts: { description?: string; private?: boolean } = {},
): Promise<CreatedRepo> {
  if (!isGithubConfigured()) throw new Error('GitHub no está configurado');
  return gitProviderFromEnv().createRepo({
    name,
    org: githubOrg(),
    private: opts.private ?? true,
    description: opts.description,
    token: env().GITHUB_TOKEN,
  });
}

/** Permiso efectivo de un usuario sobre un repo. 404 (no colaborador / sin
 *  visibilidad del token) mapea a 'none'. */
export async function getCollaboratorPermission(fullName: string, login: string): Promise<RepoPermission> {
  if (!isGithubConfigured()) throw new Error('GitHub no está configurado');
  return gitProviderFromEnv().getCollaboratorPermission({ repo: fullName, username: login, token: env().GITHUB_TOKEN });
}
