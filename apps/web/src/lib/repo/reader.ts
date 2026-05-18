/**
 * RepoReader: lectura sandboxed del filesystem del repo asociado a un
 * proyecto. Todas las rutas se resuelven contra `rootPath` y se rechaza
 * cualquier intento de escape (`..`, paths absolutos, symlinks que salen
 * del root). Aplica DEFAULT_IGNORES (binarios, build artifacts, secrets).
 *
 * Solo lectura. Sin operaciones de escritura ni de git.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_IGNORE_DIRS,
  DOTFILE_WHITELIST,
  isIgnoredDir,
  isIgnoredFile,
  looksBinary,
} from './ignore';

export interface TreeNode {
  name: string;
  path: string; // relativa a rootPath, con separador POSIX
  kind: 'dir' | 'file';
  size?: number;
  children?: TreeNode[];
}

export interface RepoFile {
  path: string;
  content: string;
  truncated: boolean;
  bytes: number;
  language?: string;
}

export interface GrepHit {
  path: string;
  line: number;
  text: string;
}

const MAX_FILE_BYTES_DEFAULT = 200 * 1024; // 200 KB por archivo
const MAX_TOTAL_BYTES_DEFAULT = 200 * 1024; // por defecto 200 KB combinado
const MAX_FILES_DEFAULT = 40;
const MAX_GREP_HITS = 100;

export class RepoAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepoAccessError';
  }
}

export class RepoReader {
  private readonly rootPath: string;

  constructor(rootPath: string) {
    if (!path.isAbsolute(rootPath)) {
      throw new RepoAccessError(`repoPath debe ser absoluto: ${rootPath}`);
    }
    // Normalizamos: sin trailing separator, resolvemos symlinks parciales
    this.rootPath = path.resolve(rootPath);
  }

  /** Resuelve un path relativo y verifica que no escape de rootPath. */
  private resolveRel(rel: string): string {
    // Rechazar paths absolutos directamente — el caller solo debe pasar relativos.
    if (path.isAbsolute(rel)) {
      throw new RepoAccessError(`path absoluto no permitido: ${rel}`);
    }
    // Rechazar tokens `..` antes de resolver
    const segs = rel.split(/[\\/]+/).filter(Boolean);
    if (segs.some((s) => s === '..')) {
      throw new RepoAccessError(`path con segmento '..' no permitido: ${rel}`);
    }
    const abs = path.resolve(this.rootPath, ...segs);
    // Verificación final: tras resolver, el absoluto debe seguir dentro del root.
    if (abs !== this.rootPath && !abs.startsWith(this.rootPath + path.sep)) {
      throw new RepoAccessError(`path escapa el repo root: ${rel}`);
    }
    return abs;
  }

  /** Relativiza un path absoluto a POSIX-style (con `/`). */
  private toRelPosix(abs: string): string {
    const rel = path.relative(this.rootPath, abs);
    return rel.split(path.sep).join('/');
  }

  /** Verifica que rootPath exista y sea directorio. */
  async validate(): Promise<void> {
    const stat = await fs.stat(this.rootPath).catch(() => null);
    if (!stat) {
      throw new RepoAccessError(`repoPath no existe: ${this.rootPath}`);
    }
    if (!stat.isDirectory()) {
      throw new RepoAccessError(`repoPath no es un directorio: ${this.rootPath}`);
    }
  }

  /**
   * Devuelve el árbol del repo desde `root` (default: raíz) hasta una
   * profundidad máxima, omitiendo carpetas/archivos en la ignore list.
   * Carga lazy por nivel: si maxDepth=1 solo trae el primer nivel.
   */
  async tree(opts: { root?: string; maxDepth?: number } = {}): Promise<TreeNode[]> {
    const startRel = opts.root ?? '.';
    const maxDepth = Math.max(1, Math.min(opts.maxDepth ?? 2, 6));
    const startAbs = this.resolveRel(startRel);
    return this.readDir(startAbs, maxDepth);
  }

  private async readDir(abs: string, remainingDepth: number): Promise<TreeNode[]> {
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return [];
    }
    const results: TreeNode[] = [];
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith('.') && !DOTFILE_WHITELIST.has(name)) {
        // Mantener algunos dotfiles útiles (gitignore, env.example, configs
        // de tooling), ocultar el resto (.claude/, .playwright-mcp/, .turbo/…).
        continue;
      }
      if (entry.isDirectory()) {
        if (isIgnoredDir(name)) continue;
        const childAbs = path.join(abs, name);
        const node: TreeNode = {
          name,
          path: this.toRelPosix(childAbs),
          kind: 'dir',
        };
        if (remainingDepth > 1) {
          node.children = await this.readDir(childAbs, remainingDepth - 1);
        }
        results.push(node);
      } else if (entry.isFile()) {
        if (isIgnoredFile(name)) continue;
        const childAbs = path.join(abs, name);
        const stat = await fs.stat(childAbs).catch(() => null);
        if (!stat) continue;
        results.push({
          name,
          path: this.toRelPosix(childAbs),
          kind: 'file',
          size: stat.size,
        });
      }
      // Symlinks ignorados — evitar ciclos / escape.
    }
    // Ordenar: directorios primero, luego archivos, alfabético.
    results.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return results;
  }

  /**
   * Lee múltiples archivos (o expande directorios) con guards de tamaño.
   * Trunca cada archivo a maxPerFile y la suma total a maxBytesTotal.
   */
  async readFiles(
    relPaths: string[],
    opts: { maxBytesTotal?: number; maxPerFile?: number; maxFiles?: number } = {},
  ): Promise<{ files: RepoFile[]; truncated: boolean }> {
    const maxBytesTotal = opts.maxBytesTotal ?? MAX_TOTAL_BYTES_DEFAULT;
    const maxPerFile = opts.maxPerFile ?? MAX_FILE_BYTES_DEFAULT;
    const maxFiles = opts.maxFiles ?? MAX_FILES_DEFAULT;

    // Expandir directorios a sus archivos recursivamente (con guards).
    const expanded = await this.expandToFiles(relPaths, maxFiles);

    const out: RepoFile[] = [];
    let used = 0;
    let truncated = expanded.length > maxFiles;

    for (const relFile of expanded.slice(0, maxFiles)) {
      if (used >= maxBytesTotal) {
        truncated = true;
        break;
      }
      const abs = this.resolveRel(relFile);
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat || !stat.isFile()) continue;

      // Sample para detectar binarios
      const fd = await fs.open(abs, 'r').catch(() => null);
      if (!fd) continue;
      try {
        const sampleSize = Math.min(8192, stat.size);
        const sample = Buffer.alloc(sampleSize);
        await fd.read(sample, 0, sampleSize, 0);
        if (looksBinary(sample)) {
          continue; // saltar binarios silenciosamente
        }
        const remainingBudget = maxBytesTotal - used;
        const readMax = Math.min(maxPerFile, remainingBudget, stat.size);
        const buf = Buffer.alloc(readMax);
        await fd.read(buf, 0, readMax, 0);
        const fileTruncated = readMax < stat.size;
        if (fileTruncated) truncated = true;

        out.push({
          path: relFile,
          content: buf.toString('utf8'),
          truncated: fileTruncated,
          bytes: readMax,
          language: guessLanguage(relFile),
        });
        used += readMax;
      } finally {
        await fd.close().catch(() => {});
      }
    }

    return { files: out, truncated };
  }

  /** Convierte mezcla de archivos y dirs en lista plana de archivos. */
  private async expandToFiles(
    relPaths: string[],
    maxFiles: number,
  ): Promise<string[]> {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const rel of relPaths) {
      if (out.length >= maxFiles) break;
      const abs = this.resolveRel(rel);
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat) continue;
      if (stat.isFile()) {
        const norm = this.toRelPosix(abs);
        if (!isIgnoredFile(path.basename(norm)) && !seen.has(norm)) {
          out.push(norm);
          seen.add(norm);
        }
      } else if (stat.isDirectory()) {
        await this.collectFilesInDir(abs, out, seen, maxFiles);
      }
    }
    return out;
  }

  private async collectFilesInDir(
    abs: string,
    out: string[],
    seen: Set<string>,
    maxFiles: number,
  ): Promise<void> {
    if (out.length >= maxFiles) return;
    const entries = await fs.readdir(abs, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      if (entry.isDirectory()) {
        if (isIgnoredDir(entry.name)) continue;
        await this.collectFilesInDir(path.join(abs, entry.name), out, seen, maxFiles);
      } else if (entry.isFile()) {
        if (isIgnoredFile(entry.name)) continue;
        const rel = this.toRelPosix(path.join(abs, entry.name));
        if (!seen.has(rel)) {
          out.push(rel);
          seen.add(rel);
        }
      }
    }
  }

  /**
   * Búsqueda por patrón (texto fijo, escapado como regex). Scope opcional
   * a una lista de paths. Devuelve hasta MAX_GREP_HITS hits.
   */
  async grep(pattern: string, scope?: string[]): Promise<GrepHit[]> {
    if (!pattern.trim()) return [];
    const re = new RegExp(escapeRegex(pattern), 'i');
    const files = scope && scope.length > 0
      ? await this.expandToFiles(scope, 500)
      : await this.expandToFiles(['.'], 500);

    const hits: GrepHit[] = [];
    for (const relFile of files) {
      if (hits.length >= MAX_GREP_HITS) break;
      const abs = this.resolveRel(relFile);
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat || stat.size > 500_000) continue;

      const content = await fs.readFile(abs, 'utf8').catch(() => null);
      if (content === null) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (hits.length >= MAX_GREP_HITS) break;
        if (re.test(lines[i]!)) {
          hits.push({ path: relFile, line: i + 1, text: lines[i]!.trim().slice(0, 240) });
        }
      }
    }
    return hits;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function guessLanguage(filePath: string): string | undefined {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
    swift: 'swift', php: 'php', cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c',
    md: 'markdown', json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml',
    scss: 'scss', css: 'css', html: 'html', sql: 'sql', sh: 'bash', prisma: 'prisma',
  };
  return map[ext];
}

/**
 * Factory: devuelve un RepoReader validado para un proyecto, o null si
 * no tiene `repoPath` configurado o si el path es inválido/inexistente.
 */
export async function repoReaderFor(project: { repoPath: string | null }): Promise<RepoReader | null> {
  if (!project.repoPath) return null;
  try {
    const reader = new RepoReader(project.repoPath);
    await reader.validate();
    return reader;
  } catch {
    return null;
  }
}

export { DEFAULT_IGNORE_DIRS };
