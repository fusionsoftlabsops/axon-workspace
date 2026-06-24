import type { FileCategory } from '@prisma/client';

/** Per-file upload cap. Files live in MinIO; the route still buffers the body,
 *  so keep it within a reasonable memory budget. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

/** Derive a coarse category from the mime type (and filename as a fallback),
 *  used to organize the project file store by type. */
export function categorize(mimeType: string, name = ''): FileCategory {
  const m = (mimeType || '').toLowerCase();
  const ext = name.toLowerCase().split('.').pop() ?? '';

  if (m.startsWith('image/')) return 'IMAGE';
  if (m.startsWith('audio/')) return 'AUDIO';
  if (m.startsWith('video/')) return 'VIDEO';
  if (m === 'application/pdf' || ext === 'pdf') return 'PDF';

  if (
    m.includes('spreadsheet') ||
    m === 'text/csv' ||
    ['xls', 'xlsx', 'csv', 'ods'].includes(ext)
  ) {
    return 'SPREADSHEET';
  }
  if (m.includes('presentation') || ['ppt', 'pptx', 'odp', 'key'].includes(ext)) {
    return 'PRESENTATION';
  }
  if (
    m.includes('wordprocessing') ||
    m === 'application/msword' ||
    m === 'application/rtf' ||
    ['doc', 'docx', 'odt', 'rtf', 'txt', 'md'].includes(ext)
  ) {
    return 'DOCUMENT';
  }
  if (
    m === 'application/zip' ||
    m.includes('compressed') ||
    m === 'application/x-tar' ||
    m === 'application/gzip' ||
    ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2'].includes(ext)
  ) {
    return 'ARCHIVE';
  }
  if (
    m === 'application/json' ||
    m.startsWith('text/') ||
    ['js', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'json', 'yml', 'yaml', 'sh', 'sql', 'html', 'css', 'scss'].includes(ext)
  ) {
    return 'CODE';
  }
  return 'OTHER';
}

/** Order categories appear in the UI (most common first). */
export const CATEGORY_ORDER: FileCategory[] = [
  'IMAGE',
  'PDF',
  'DOCUMENT',
  'SPREADSHEET',
  'PRESENTATION',
  'ARCHIVE',
  'AUDIO',
  'VIDEO',
  'CODE',
  'OTHER',
];

/** Bilingual labels for each category (es, en). */
export const CATEGORY_LABEL: Record<FileCategory, { es: string; en: string }> = {
  IMAGE: { es: 'Imágenes', en: 'Images' },
  PDF: { es: 'PDF', en: 'PDF' },
  DOCUMENT: { es: 'Documentos', en: 'Documents' },
  SPREADSHEET: { es: 'Hojas de cálculo', en: 'Spreadsheets' },
  PRESENTATION: { es: 'Presentaciones', en: 'Presentations' },
  ARCHIVE: { es: 'Comprimidos', en: 'Archives' },
  AUDIO: { es: 'Audio', en: 'Audio' },
  VIDEO: { es: 'Vídeo', en: 'Video' },
  CODE: { es: 'Código', en: 'Code' },
  OTHER: { es: 'Otros', en: 'Other' },
};

/** Human-readable file size. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
