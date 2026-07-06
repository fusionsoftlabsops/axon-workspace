/**
 * Grounding del plan de implementación vía la API de GitHub, para proyectos SIN
 * repo clonado localmente en axon-web (el caso normal en producción: los repos
 * viven en GitHub y solo el worker Dev los clona). Sin esto, el impl-plan sale
 * "a ciegas" y el Dev quema presupuesto explorando el repo para ubicar archivos.
 *
 * Trae el árbol de archivos (git trees API, recursivo) + el contenido de los
 * archivos candidatos (contents API), eligiendo candidatos por coincidencia de
 * keywords en el path. Solo lectura, best-effort: cualquier fallo → sin grounding.
 */
import type { ImplRepoFile } from '@/lib/ai/planner';
import { gitProviderFromEnv } from '@/lib/repo/provider';

export const GITHUB_API = 'https://api.github.com';
const GH_API = GITHUB_API;
const GH_HEADERS = (token: string) => ({
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'axon-impl-plan',
});

// Extensiones de código/config relevantes para el plan (evita binarios, imágenes,
// lockfiles). El árbol de git ya excluye lo gitignoreado (node_modules, .next…).
const CODE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'php', 'cs', 'cpp', 'c', 'h', 'scss', 'css', 'html', 'sql', 'sh', 'prisma', 'graphql',
  'vue', 'svelte', 'md', 'json', 'yml', 'yaml', 'toml',
]);
const SKIP_NAME = /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.min\.(js|css)$)/i;

export function repoSlug(repo: { url?: string | null; githubFullName?: string | null }): string | null {
  if (repo.githubFullName && /^[^/]+\/[^/]+$/.test(repo.githubFullName)) return repo.githubFullName;
  const m = repo.url?.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?\/?$/i);
  return m ? m[1]! : null;
}

function isCodePath(p: string): boolean {
  if (SKIP_NAME.test(p)) return false;
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  return CODE_EXT.has(ext);
}

export async function githubJson(url: string, token: string, timeoutMs = 20_000): Promise<unknown> {
  const res = await fetch(url, { headers: GH_HEADERS(token), signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`github ${res.status}`);
  return res.json();
}

/** Fetch de texto crudo (p.ej. el diff de un PR con Accept github.diff). */
export async function githubText(url: string, token: string, accept: string, timeoutMs = 30_000): Promise<string> {
  const res = await fetch(url, {
    headers: { ...GH_HEADERS(token), accept },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`github ${res.status}`);
  return res.text();
}

export interface GithubTreeEntry {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}

/** Árbol COMPLETO del repo (blobs + dirs) vía el proveedor git (GitHub o
 *  Forgejo/Gitea según GIT_PROVIDER). */
export async function githubRepoTree(fullName: string, branch: string, token: string): Promise<GithubTreeEntry[]> {
  return (await gitProviderFromEnv().getTree({ repo: fullName, branch, token })) as GithubTreeEntry[];
}

/** Contenido de UN archivo (base64→utf8, truncado a maxBytes) vía el proveedor
 *  git configurado. */
export async function githubFileContent(
  fullName: string,
  branch: string,
  filePath: string,
  token: string,
  maxBytes = 200_000,
): Promise<{ content: string; bytes: number; truncated: boolean }> {
  return gitProviderFromEnv().getFileContent({ repo: fullName, branch, path: filePath, token, maxBytes });
}

/** Nodo con la MISMA forma que RepoReader.tree() para el fallback GitHub. */
export interface GithubTreeNode {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  size?: number;
  children?: GithubTreeNode[];
}

/** Arma el árbol jerárquico (root/depth) desde las entradas planas de GitHub. */
export function githubTreeNodes(entries: GithubTreeEntry[], root = '.', maxDepth = 2): GithubTreeNode[] {
  const prefix = root === '.' || root === '' ? '' : root.replace(/\/+$/, '') + '/';
  const depthOf = (rel: string) => rel.split('/').length;
  const byParent = new Map<string, GithubTreeNode[]>();
  for (const e of entries) {
    if (prefix && !e.path.startsWith(prefix)) continue;
    const rel = prefix ? e.path.slice(prefix.length) : e.path;
    if (!rel || depthOf(rel) > maxDepth) continue;
    const segs = rel.split('/');
    const parent = segs.slice(0, -1).join('/');
    const node: GithubTreeNode = {
      name: segs[segs.length - 1]!,
      path: e.path,
      kind: e.type === 'tree' ? 'dir' : 'file',
      ...(e.size !== undefined ? { size: e.size } : {}),
    };
    const list = byParent.get(parent) ?? [];
    list.push(node);
    byParent.set(parent, list);
  }
  const attach = (parentRel: string, nodes: GithubTreeNode[]): GithubTreeNode[] => {
    nodes.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
    for (const n of nodes) {
      if (n.kind === 'dir') {
        const rel = parentRel ? `${parentRel}/${n.name}` : n.name;
        const kids = byParent.get(rel);
        if (kids) n.children = attach(rel, kids);
      }
    }
    return nodes;
  };
  return attach('', byParent.get('') ?? []);
}

/** Outline indentado desde una lista de paths POSIX (dirs + archivos). */
function buildOutline(paths: string[], maxLines = 400): string {
  const lines: string[] = [];
  const seenDir = new Set<string>();
  for (const p of paths) {
    const segs = p.split('/');
    for (let i = 0; i < segs.length - 1; i++) {
      const dir = segs.slice(0, i + 1).join('/');
      if (!seenDir.has(dir)) {
        seenDir.add(dir);
        lines.push(`${'  '.repeat(i)}${segs[i]}/`);
      }
    }
    lines.push(`${'  '.repeat(segs.length - 1)}${segs[segs.length - 1]}`);
    if (lines.length >= maxLines) break;
  }
  return lines.slice(0, maxLines).join('\n');
}

/**
 * Produce outline del repo + contenido de archivos candidatos (por keyword en el
 * path). Best-effort: devuelve `{outline:'', files:[]}` ante cualquier problema.
 */
export async function githubGrounding(opts: {
  fullName: string;
  branch: string;
  token: string;
  keywords: string[];
}): Promise<{ outline: string; files: ImplRepoFile[] }> {
  let treeResp: { tree?: Array<{ path: string; type: string; size?: number }> };
  try {
    treeResp = (await githubJson(
      `${GH_API}/repos/${opts.fullName}/git/trees/${encodeURIComponent(opts.branch)}?recursive=1`,
      opts.token,
    )) as typeof treeResp;
  } catch {
    return { outline: '', files: [] };
  }
  const allPaths = (treeResp.tree ?? [])
    .filter((t) => t.type === 'blob' && isCodePath(t.path))
    .map((t) => t.path)
    .sort();
  if (allPaths.length === 0) return { outline: '', files: [] };

  const outline = buildOutline(allPaths);

  // Candidatos: paths que contienen alguna keyword; si son pocos, sumar los más
  // superficiales (menor profundidad = archivos "de entrada" del proyecto).
  const kws = opts.keywords.map((k) => k.toLowerCase()).filter((k) => k.length >= 3);
  const scored = allPaths.filter((p) => kws.some((k) => p.toLowerCase().includes(k)));
  const candidates = [...new Set(scored)].slice(0, 20);
  if (candidates.length < 5) {
    for (const p of [...allPaths].sort((a, b) => a.split('/').length - b.split('/').length)) {
      if (candidates.length >= 12) break;
      if (!candidates.includes(p)) candidates.push(p);
    }
  }

  const files: ImplRepoFile[] = [];
  let usedBytes = 0;
  const MAX_TOTAL = 140_000;
  const MAX_PER = 20_000;
  for (const path of candidates) {
    if (usedBytes >= MAX_TOTAL) break;
    try {
      const c = (await githubJson(
        `${GH_API}/repos/${opts.fullName}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(opts.branch)}`,
        opts.token,
      )) as { content?: string; encoding?: string };
      if (c.encoding !== 'base64' || !c.content) continue;
      let content = Buffer.from(c.content, 'base64').toString('utf8');
      const truncated = content.length > MAX_PER;
      if (truncated) content = content.slice(0, MAX_PER);
      files.push({ path, content, language: path.split('.').pop(), truncated });
      usedBytes += content.length;
    } catch {
      /* saltar este archivo */
    }
  }
  return { outline, files };
}
