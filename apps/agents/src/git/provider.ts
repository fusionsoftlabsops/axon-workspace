/**
 * Abstracción de proveedor git para el worker de agentes. Parametriza host +
 * base de la API REST + shape del payload, con GitHub por defecto (cero cambios
 * respecto al comportamiento histórico) y Forgejo/Gitea opt-in por config.
 *
 * El worker sólo necesita: parsear el repo, abrir un PR (idempotente si ya
 * existe) y hacer GETs de sólo lectura contra la API (release checks). El
 * clone/push es git plano y ya funciona con cualquier host, así que NO vive acá.
 */

export type GitProviderKind = 'github' | 'forgejo';

export interface GitProviderConfig {
  provider: GitProviderKind;
  /** Base de la API REST, sin barra final. GitHub: https://api.github.com. */
  apiBaseUrl: string;
  /** Host git para parsear URLs de repo. GitHub: github.com. */
  host: string;
}

/** Config por defecto: GitHub. Usada cuando un call site no inyecta la suya. */
export const DEFAULT_GIT_CONFIG: GitProviderConfig = {
  provider: 'github',
  apiBaseUrl: 'https://api.github.com',
  host: 'github.com',
};

export interface RepoRef {
  owner: string;
  repo: string;
  host: string;
}

export interface OpenPrInput {
  repoUrl: string;
  head: string;
  base: string;
  title: string;
  body: string;
  token?: string;
}

export interface ApiFetchInit {
  method?: string;
  body?: string;
  accept?: string;
  timeoutMs?: number;
}

export interface GitProvider {
  readonly config: GitProviderConfig;
  /** Parsea `owner`/`repo` de una URL del repo (https o ssh) del host configurado. */
  parseRepoRef(url: string): RepoRef | null;
  /** GET/POST contra la API del proveedor (path relativo a `apiBaseUrl`). */
  apiFetch(path: string, token: string | undefined, init?: ApiFetchInit): Promise<Response>;
  /** Abre un PR y devuelve su URL; si ya existe uno abierto para `head`, lo reusa. */
  openPr(input: OpenPrInput): Promise<string>;
  /** URL del PR abierto para `head`, o null. */
  findOpenPr(input: { repoUrl: string; head: string; token?: string }): Promise<string | null>;
}

const PROVIDER_LABEL: Record<GitProviderKind, string> = { github: 'GitHub', forgejo: 'Forgejo' };

/** Parsea `owner`/`repo` de una URL (https/ssh) del host dado. Centraliza la
 *  regex que antes estaba duplicada por todo el worker. */
export function parseRepoRef(url: string, host: string): RepoRef | null {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = url.match(new RegExp(`${escaped}[/:]([^/]+)/([^/.\\s]+)`, 'i'));
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]!, host };
}

abstract class BaseGitProvider implements GitProvider {
  constructor(
    readonly config: GitProviderConfig,
    protected readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Cabeceras de auth específicas del proveedor. */
  protected abstract authHeaders(token?: string): Record<string, string>;
  /** Accept por defecto para respuestas JSON. */
  protected abstract get jsonAccept(): string;

  parseRepoRef(url: string): RepoRef | null {
    return parseRepoRef(url, this.config.host);
  }

  async apiFetch(path: string, token: string | undefined, init: ApiFetchInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      ...this.authHeaders(token),
      accept: init.accept ?? this.jsonAccept,
      'user-agent': 'axon-git',
    };
    if (init.body) headers['content-type'] = 'application/json';
    return this.fetchImpl(`${this.config.apiBaseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body ? { body: init.body } : {}),
      signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
    });
  }

  async openPr(input: OpenPrInput): Promise<string> {
    const ref = this.parseRepoRef(input.repoUrl);
    if (!ref) throw new Error(`repoUrl no es de ${PROVIDER_LABEL[this.config.provider]} — no se puede abrir PR`);
    const res = await this.apiFetch(`/repos/${ref.owner}/${ref.repo}/pulls`, input.token, {
      method: 'POST',
      body: JSON.stringify({ title: input.title, body: input.body, head: input.head, base: input.base }),
    });
    const data = (await res.json().catch(() => ({}))) as { html_url?: string; message?: string };
    if (res.ok && data.html_url) return data.html_url;
    // Ya existe un PR para la rama → reusarlo (GitHub responde 422, Gitea 409).
    if (res.status === 422 || res.status === 409) {
      const existing = await this.findOpenPr({ repoUrl: input.repoUrl, head: input.head, token: input.token });
      if (existing) return existing;
    }
    throw new Error(`PR falló (${res.status}): ${data.message ?? ''}`);
  }

  async findOpenPr(input: { repoUrl: string; head: string; token?: string }): Promise<string | null> {
    const ref = this.parseRepoRef(input.repoUrl);
    if (!ref) return null;
    const res = await this.apiFetch(
      `/repos/${ref.owner}/${ref.repo}/pulls?head=${ref.owner}:${input.head}&state=open`,
      input.token,
    );
    if (!res.ok) return null;
    const list = (await res.json().catch(() => [])) as Array<{ html_url?: string }>;
    return list[0]?.html_url ?? null;
  }
}

/** GitHub: auth Bearer + Accept vnd.github + versión de API. */
export class GithubProvider extends BaseGitProvider {
  protected authHeaders(token?: string): Record<string, string> {
    return {
      authorization: `Bearer ${token ?? ''}`,
      'x-github-api-version': '2022-11-28',
    };
  }
  protected get jsonAccept(): string {
    return 'application/vnd.github+json';
  }
}

/** Forgejo/Gitea: auth `token <pat>`, sin la cabecera de versión de GitHub. */
export class ForgejoProvider extends BaseGitProvider {
  protected authHeaders(token?: string): Record<string, string> {
    return { authorization: `token ${token ?? ''}` };
  }
  protected get jsonAccept(): string {
    return 'application/json';
  }
}

/** Factory: elige la implementación por `config.provider`. */
export function getGitProvider(config: GitProviderConfig, fetchImpl?: typeof fetch): GitProvider {
  return config.provider === 'forgejo'
    ? new ForgejoProvider(config, fetchImpl)
    : new GithubProvider(config, fetchImpl);
}
