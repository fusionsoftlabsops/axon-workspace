/**
 * Patterns excluidos por default al leer el repo. Mantenemos esto
 * conservador: bloquea binarios, build artifacts, dependencias y
 * cualquier carpeta sensible que NO querríamos enviar al LLM.
 */

export const DEFAULT_IGNORE_DIRS = [
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.pnpm-store',
  '.next',
  '.turbo',
  '.cache',
  'dist',
  'build',
  'out',
  'coverage',
  '.nyc_output',
  '.idea',
  '.vscode',
  '.claude',
  '.playwright-mcp',
  '.cursor',
  '__pycache__',
  '.venv',
  'venv',
  'target',         // Rust
  '.gradle',
  '.mvn',
  'vendor',         // Go
  '.terraform',
];

/**
 * Dotfiles que SÍ queremos mostrar en el árbol (útiles para que el LLM
 * entienda config/tooling del repo).
 */
export const DOTFILE_WHITELIST = new Set([
  '.gitignore',
  '.gitattributes',
  '.env.example',
  '.dockerignore',
  '.editorconfig',
  '.prettierrc.json',
  '.prettierrc',
  '.eslintrc.json',
  '.eslintrc',
  '.nvmrc',
  '.node-version',
]);

export const DEFAULT_IGNORE_EXTS = [
  // Binarios / multimedia
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff',
  '.svg',  // a veces útil, pero suele ser ruido
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.mp3', '.mp4', '.wav', '.mov', '.avi', '.webm',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  // Build artifacts
  '.map', '.min.js', '.min.css',
  '.lock',
  // Logs
  '.log',
  // Sospechosos
  '.pem', '.key', '.crt', '.p12', '.pfx',  // certificados
  '.env',                                    // dotfiles de env
];

export const SOFT_IGNORE_FILES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
];

const IGNORE_DIR_SET = new Set(DEFAULT_IGNORE_DIRS);
const IGNORE_EXT_SET = new Set(DEFAULT_IGNORE_EXTS);
const SOFT_IGNORE_SET = new Set(SOFT_IGNORE_FILES);

export function isIgnoredDir(name: string): boolean {
  return IGNORE_DIR_SET.has(name);
}

export function isIgnoredFile(name: string): boolean {
  if (SOFT_IGNORE_SET.has(name)) return true;
  const lower = name.toLowerCase();
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx === -1) return false;
  const ext = lower.slice(dotIdx);
  if (IGNORE_EXT_SET.has(ext)) return true;
  // Cualquier archivo que termine con .min.<algo> o .map se considera generado.
  if (lower.endsWith('.min.js') || lower.endsWith('.min.css')) return true;
  return false;
}

/**
 * Heurística rápida para detectar archivos binarios: si los primeros 8 KB
 * contienen un null byte o más del 30% de bytes no-printables, lo tratamos
 * como binario.
 */
export function looksBinary(sample: Buffer): boolean {
  if (sample.length === 0) return false;
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i]!;
    if (b === 0) return true;
    // Tabs / newlines son texto. Caracteres < 0x20 (excepto control de texto)
    // o > 0x7e que no son UTF-8 continuation cuentan como sospechosos.
    if (b < 9 || (b > 13 && b < 32)) nonPrintable++;
  }
  return nonPrintable / sample.length > 0.3;
}
