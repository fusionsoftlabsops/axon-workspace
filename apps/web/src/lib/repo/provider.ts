/**
 * Abstracción de proveedor git para la web. Parametriza host + base de la API
 * REST + shape del payload, con GitHub por defecto (comportamiento idéntico al
 * histórico) y Forgejo/Gitea opt-in por env (GIT_PROVIDER=forgejo).
 *
 * Único punto que conoce las diferencias entre proveedores: cabeceras de auth
 * (GitHub `Bearer`+`vnd.github` / Gitea `token`+`json`), el sufijo `.diff` de
 * Gitea para el diff de un PR, y el valor de `recursive` del árbol git.
 */
import { env } from '@/lib/env';

export type GitProviderKind = 'github' | 'forgejo';

export interface GitProviderConfig {
  provider: GitProviderKind;
  /** Base de la API REST, sin barra final. */
  apiBaseUrl: string;
  /** Host git para parsear/armar URLs de repo. */
  host: string;
}

export interface RepoRef {
  owner: string;
  repo: string;
  host: string;
}

export interface PrSummary {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  headRef: string;
  author: string | null;
  url: string;
  createdAt: string;
}

export interface PrMeta {
  title: string;
  state: string;
  merged: boolean;
  headRef: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  url: string;
}

export interface GitTreeEntry {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}

export interface FileContent {
  content: string;
  bytes: number;
  truncated: boolean;
}

export interface CreatedRepo {
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  existed: boolean;
}

export type RepoPermission = 'admin' | 'write' | 'read' | 'none';

export interface GitProvider {
  readonly config: GitProviderConfig;
  parseRepoRef(url: string): RepoRef | null;
  /** Resuelve un repo dado como `owner/repo` o como URL. */
  resolveRef(repo: string): RepoRef | null;
  listPrs(input: { repo: string; state: string; token?: string; perPage?: number }): Promise<PrSummary[]>;
  getPrMeta(input: { repo: string; number: number; token?: string }): Promise<PrMeta>;
  getPrDiff(input: { repo: string; number: number; token?: string }): Promise<string>;
  getTree(input: { repo: string; branch: string; token?: string }): Promise<GitTreeEntry[]>;
  getFileContent(input: { repo: string; branch: string; path: string; token?: string; maxBytes?: number }): Promise<FileContent>;
  createRepo(input: { name: string; org?: string; private?: boolean; description?: string; token?: string }): Promise<CreatedRepo>;
  getCollaboratorPermission(input: { repo: string; username: string; token?: string }): Promise<RepoPermission>;
}

/** Parsea `owner`/`repo` de una URL (https/ssh) del host dado. Centraliza la
 *  regex que antes estaba duplicada por toda la web. */
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

  protected abstract authHeaders(token?: string): Record<string, string>;
  protected abstract get jsonAccept(): string;
  /** Accept para pedir el diff crudo de un PR, o null si se usa el sufijo `.diff`. */
  protected abstract get diffAccept(): string | null;
  /** Valor del query `recursive` del árbol git (GitHub `1`, Gitea `true`). */
  protected abstract get treeRecursive(): string;
  protected abstract get userAgent(): string;

  parseRepoRef(url: string): RepoRef | null {
    return parseRepoRef(url, this.config.host);
  }

  resolveRef(repo: string): RepoRef | null {
    const s = (repo || '').trim();
    if (!s) return null;
    if (/^[^/\s]+\/[^/\s]+$/.test(s) && !s.includes('://') && !s.includes('@')) {
      const [owner, rest] = s.split('/');
      return { owner: owner!, repo: rest!.replace(/\.git$/, ''), host: this.config.host };
    }
    return this.parseRepoRef(s);
  }

  protected repoBase(ref: RepoRef): string {
    return `${this.config.apiBaseUrl}/repos/${ref.owner}/${ref.repo}`;
  }

  protected headers(token?: string, accept?: string): Record<string, string> {
    return { ...this.authHeaders(token), accept: accept ?? this.jsonAccept, 'user-agent': this.userAgent };
  }

  protected async getJson(url: string, token?: string, timeoutMs = 20_000): Promise<unknown> {
    const res = await this.fetchImpl(url, { headers: this.headers(token), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`git ${res.status}`);
    return res.json();
  }

  protected async getText(url: string, token: string | undefined, accept: string, timeoutMs = 30_000): Promise<string> {
    const res = await this.fetchImpl(url, { headers: this.headers(token, accept), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`git ${res.status}`);
    return res.text();
  }

  private mustRef(repo: string): RepoRef {
    const ref = this.resolveRef(repo);
    if (!ref) throw new Error(`repo inválido para el proveedor git: ${repo}`);
    return ref;
  }

  async listPrs(input: { repo: string; state: string; token?: string; perPage?: number }): Promise<PrSummary[]> {
    const ref = this.mustRef(input.repo);
    const list = (await this.getJson(
      `${this.repoBase(ref)}/pulls?state=${input.state}&per_page=${input.perPage ?? 50}&sort=updated&direction=desc`,
      input.token,
    )) as Array<{
      number: number;
      title: string;
      state: string;
      merged_at: string | null;
      html_url: string;
      created_at: string;
      user?: { login?: string };
      head?: { ref?: string };
    }>;
    return list.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      merged: !!pr.merged_at,
      headRef: pr.head?.ref ?? '',
      author: pr.user?.login ?? null,
      url: pr.html_url,
      createdAt: pr.created_at,
    }));
  }

  async getPrMeta(input: { repo: string; number: number; token?: string }): Promise<PrMeta> {
    const ref = this.mustRef(input.repo);
    const m = (await this.getJson(`${this.repoBase(ref)}/pulls/${input.number}`, input.token)) as {
      title?: string;
      state?: string;
      merged_at?: string | null;
      additions?: number;
      deletions?: number;
      changed_files?: number;
      head?: { ref?: string };
      html_url?: string;
    };
    return {
      title: m.title ?? '',
      state: m.state ?? '',
      merged: !!m.merged_at,
      headRef: m.head?.ref ?? '',
      additions: m.additions ?? 0,
      deletions: m.deletions ?? 0,
      changedFiles: m.changed_files ?? 0,
      url: m.html_url ?? '',
    };
  }

  async getPrDiff(input: { repo: string; number: number; token?: string }): Promise<string> {
    const ref = this.mustRef(input.repo);
    // GitHub: GET .../pulls/{n} con Accept diff. Gitea: sufijo `.diff`, sin Accept especial.
    if (this.diffAccept) return this.getText(`${this.repoBase(ref)}/pulls/${input.number}`, input.token, this.diffAccept);
    return this.getText(`${this.repoBase(ref)}/pulls/${input.number}.diff`, input.token, this.jsonAccept);
  }

  async getTree(input: { repo: string; branch: string; token?: string }): Promise<GitTreeEntry[]> {
    const ref = this.mustRef(input.repo);
    const resp = (await this.getJson(
      `${this.repoBase(ref)}/git/trees/${encodeURIComponent(input.branch)}?recursive=${this.treeRecursive}`,
      input.token,
    )) as { tree?: Array<{ path: string; type: string; size?: number }> };
    return (resp.tree ?? [])
      .filter((t) => t.type === 'blob' || t.type === 'tree')
      .map((t) => ({ path: t.path, type: t.type as 'blob' | 'tree', ...(t.size !== undefined ? { size: t.size } : {}) }));
  }

  async getFileContent(input: {
    repo: string;
    branch: string;
    path: string;
    token?: string;
    maxBytes?: number;
  }): Promise<FileContent> {
    const ref = this.mustRef(input.repo);
    const maxBytes = input.maxBytes ?? 200_000;
    const c = (await this.getJson(
      `${this.repoBase(ref)}/contents/${input.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(input.branch)}`,
      input.token,
    )) as { content?: string; encoding?: string; size?: number };
    if (c.encoding !== 'base64' || !c.content) throw new Error('archivo no disponible (¿binario o directorio?)');
    let content = Buffer.from(c.content, 'base64').toString('utf8');
    const bytes = Buffer.byteLength(content, 'utf8');
    const truncated = bytes > maxBytes;
    if (truncated) content = content.slice(0, maxBytes);
    return { content, bytes, truncated };
  }

  async createRepo(input: {
    name: string;
    org?: string;
    private?: boolean;
    description?: string;
    token?: string;
  }): Promise<CreatedRepo> {
    const url = input.org
      ? `${this.config.apiBaseUrl}/orgs/${input.org}/repos`
      : `${this.config.apiBaseUrl}/user/repos`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { ...this.headers(input.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: input.name,
        description: input.description?.slice(0, 300) || undefined,
        private: input.private ?? true,
        auto_init: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 201) {
      const j = (await res.json()) as { full_name: string; html_url: string; default_branch: string };
      return { fullName: j.full_name, htmlUrl: j.html_url, defaultBranch: j.default_branch || 'main', existed: false };
    }
    // Ya existe (GitHub 422, Gitea 409): resolver dueño y devolver identidad.
    if (res.status === 422 || res.status === 409) {
      const owner = input.org ?? (await this.currentLogin(input.token).catch(() => null));
      if (owner) {
        return {
          fullName: `${owner}/${input.name}`,
          htmlUrl: `https://${this.config.host}/${owner}/${input.name}`,
          defaultBranch: 'main',
          existed: true,
        };
      }
    }
    const body = await res.text().catch(() => '');
    throw new Error(`create repo: HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }

  protected async currentLogin(token?: string): Promise<string | null> {
    const res = await this.fetchImpl(`${this.config.apiBaseUrl}/user`, {
      headers: this.headers(token),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { login?: string };
    return j.login ?? null;
  }

  async getCollaboratorPermission(input: { repo: string; username: string; token?: string }): Promise<RepoPermission> {
    const ref = this.mustRef(input.repo);
    const res = await this.fetchImpl(
      `${this.repoBase(ref)}/collaborators/${encodeURIComponent(input.username)}/permission`,
      { headers: this.headers(input.token), signal: AbortSignal.timeout(15_000) },
    );
    if (res.status === 404) return 'none';
    if (!res.ok) throw new Error(`permission: HTTP ${res.status}`);
    const j = (await res.json()) as { permission?: string };
    const p = (j.permission ?? 'none').toLowerCase();
    if (p === 'admin' || p === 'write' || p === 'read') return p;
    return 'none';
  }
}

/** GitHub: auth Bearer + Accept vnd.github + diff vía Accept + recursive=1. */
export class GithubProvider extends BaseGitProvider {
  protected authHeaders(token?: string): Record<string, string> {
    return { authorization: `Bearer ${token ?? ''}`, 'x-github-api-version': '2022-11-28' };
  }
  protected get jsonAccept(): string {
    return 'application/vnd.github+json';
  }
  protected get diffAccept(): string | null {
    return 'application/vnd.github.diff';
  }
  protected get treeRecursive(): string {
    return '1';
  }
  protected get userAgent(): string {
    return 'axon-github';
  }
}

/** Forgejo/Gitea: auth `token <pat>`, diff vía sufijo `.diff` + recursive=true. */
export class ForgejoProvider extends BaseGitProvider {
  protected authHeaders(token?: string): Record<string, string> {
    return { authorization: `token ${token ?? ''}` };
  }
  protected get jsonAccept(): string {
    return 'application/json';
  }
  protected get diffAccept(): string | null {
    return null;
  }
  protected get treeRecursive(): string {
    return 'true';
  }
  protected get userAgent(): string {
    return 'axon-forgejo';
  }
}

/** Factory: elige la implementación por `config.provider`. */
export function getGitProvider(config: GitProviderConfig, fetchImpl?: typeof fetch): GitProvider {
  return config.provider === 'forgejo'
    ? new ForgejoProvider(config, fetchImpl)
    : new GithubProvider(config, fetchImpl);
}

/** Config del proveedor git leída del env (default GitHub). */
export function gitConfigFromEnv(): GitProviderConfig {
  const e = env();
  return {
    provider: (e.GIT_PROVIDER as GitProviderKind) ?? 'github',
    apiBaseUrl: e.GIT_API_BASE_URL ?? 'https://api.github.com',
    host: e.GIT_HOST ?? 'github.com',
  };
}

/** Proveedor git construido desde el env (default GitHub). */
export function gitProviderFromEnv(): GitProvider {
  return getGitProvider(gitConfigFromEnv());
}
