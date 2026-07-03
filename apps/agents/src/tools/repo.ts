/**
 * Herramientas de REPO para el agente Dev, sandboxeadas al workspace clonado:
 * ningún path puede escapar del directorio raíz (resolve + prefijo). Mínimas
 * a propósito: leer, listar, buscar y escribir — commit/push/PR son pasos
 * deterministas del pipeline, no del modelo.
 */
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep, relative } from 'node:path';
import type { ToolDef } from '../runtime/types.js';

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', '.next', 'coverage', '__pycache__']);
const MAX_FILE_CHARS = 40_000;
const MAX_RESULTS = 50;

function resolveSafe(root: string, path: string): string {
  const abs = resolve(root, path);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`path fuera del workspace: ${path}`);
  }
  return abs;
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!IGNORED_DIRS.has(e.name)) yield* walk(join(dir, e.name));
    } else {
      yield join(dir, e.name);
    }
  }
}

export function repoTools(root: string): ToolDef[] {
  const rootAbs = resolve(root);
  return [
    {
      name: 'read_file',
      description: 'Lee un archivo del repo (ruta relativa a la raíz).',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: { path: { type: 'string' } },
      },
      async execute(input: unknown): Promise<string> {
        const { path } = input as { path: string };
        const abs = resolveSafe(rootAbs, path);
        const content = await readFile(abs, 'utf8');
        return content.length > MAX_FILE_CHARS
          ? `${content.slice(0, MAX_FILE_CHARS)}\n…[truncado: ${content.length} chars]`
          : content;
      },
    },
    {
      name: 'list_files',
      description: 'Lista archivos del repo cuyo path contenga el filtro (vacío = primeros archivos).',
      inputSchema: {
        type: 'object',
        properties: { filter: { type: 'string', description: 'subcadena del path (ej. "src/roles")' } },
      },
      async execute(input: unknown): Promise<string> {
        const { filter } = (input ?? {}) as { filter?: string };
        const needle = (filter ?? '').toLowerCase();
        const hits: string[] = [];
        for await (const f of walk(rootAbs)) {
          const rel = relative(rootAbs, f).split(sep).join('/');
          if (!needle || rel.toLowerCase().includes(needle)) {
            hits.push(rel);
            if (hits.length >= MAX_RESULTS) break;
          }
        }
        return hits.length ? hits.join('\n') : '(sin resultados)';
      },
    },
    {
      name: 'search_files',
      description: 'Busca un texto/regex en los archivos del repo; devuelve path:línea: contenido.',
      inputSchema: {
        type: 'object',
        required: ['pattern'],
        properties: {
          pattern: { type: 'string', description: 'regex (o texto literal)' },
          filter: { type: 'string', description: 'limitar a paths que contengan esto' },
        },
      },
      async execute(input: unknown): Promise<string> {
        const { pattern, filter } = input as { pattern: string; filter?: string };
        let re: RegExp;
        try {
          re = new RegExp(pattern);
        } catch {
          re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        }
        const needle = (filter ?? '').toLowerCase();
        const hits: string[] = [];
        for await (const f of walk(rootAbs)) {
          const rel = relative(rootAbs, f).split(sep).join('/');
          if (needle && !rel.toLowerCase().includes(needle)) continue;
          let content: string;
          try {
            content = await readFile(f, 'utf8');
          } catch {
            continue; // binario / ilegible
          }
          const lines = content.split('\n');
          for (let i = 0; i < lines.length && hits.length < MAX_RESULTS; i++) {
            if (re.test(lines[i]!)) hits.push(`${rel}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`);
          }
          if (hits.length >= MAX_RESULTS) break;
        }
        return hits.length ? hits.join('\n') : '(sin coincidencias)';
      },
    },
    {
      name: 'write_file',
      description: 'Escribe (crea o reemplaza) un archivo del repo con el contenido dado.',
      inputSchema: {
        type: 'object',
        required: ['path', 'content'],
        properties: { path: { type: 'string' }, content: { type: 'string' } },
      },
      async execute(input: unknown): Promise<string> {
        const { path, content } = input as { path: string; content: string };
        const abs = resolveSafe(rootAbs, path);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content, 'utf8');
        const s = await stat(abs);
        return `escrito ${path} (${s.size} bytes)`;
      },
    },
  ];
}
