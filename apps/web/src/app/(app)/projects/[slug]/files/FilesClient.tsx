'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { FileCategory, MemberRole } from '@prisma/client';
import { Button, Badge, EmptyState } from '@/components/ui';
import { CATEGORY_ORDER, CATEGORY_LABEL, formatBytes, MAX_FILE_BYTES } from '@/lib/files';
import { useI18n } from '@/lib/i18n/i18n';
import styles from './files.module.scss';

interface FileView {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  category: FileCategory;
  createdAt: string;
  uploadedById: string;
  uploaderName: string;
}

const CATEGORY_GLYPH: Record<FileCategory, string> = {
  IMAGE: '▦',
  PDF: '◳',
  DOCUMENT: '▤',
  SPREADSHEET: '▦',
  PRESENTATION: '◰',
  ARCHIVE: '◫',
  AUDIO: '♪',
  VIDEO: '▷',
  CODE: '⟨⟩',
  OTHER: '▪',
};

export function FilesClient({
  slug,
  role,
  currentUserId,
  files,
}: {
  slug: string;
  role: MemberRole;
  currentUserId: string;
  files: FileView[];
}) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const canWrite = role !== 'VIEWER';
  const canManage = role === 'OWNER' || role === 'ADMIN';

  async function upload(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    const tooBig = Array.from(list).find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) {
      setError(
        t(
          `"${tooBig.name}" supera el límite de ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB`,
          `"${tooBig.name}" exceeds the ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB limit`,
        ),
      );
      return;
    }
    const form = new FormData();
    Array.from(list).forEach((f) => form.append('file', f));
    setUploading(true);
    try {
      const res = await fetch(`/api/v1/projects/${slug}/files`, { method: 'POST', body: form });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? t('Error al subir', 'Upload failed'));
        return;
      }
      if (inputRef.current) inputRef.current.value = '';
      startTransition(() => router.refresh());
    } catch {
      setError(t('Error de red al subir', 'Network error while uploading'));
    } finally {
      setUploading(false);
    }
  }

  function remove(file: FileView) {
    if (!confirm(t(`¿Eliminar "${file.name}"?`, `Delete "${file.name}"?`))) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/v1/projects/${slug}/files/${file.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? t('Error al eliminar', 'Delete failed'));
        return;
      }
      router.refresh();
    });
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: files.filter((f) => f.category === cat),
  })).filter((g) => g.items.length > 0);

  const busy = uploading || pending;

  return (
    <div className={styles.wrap}>
      {canWrite && (
        <div
          className={`${styles.dropzone} ${dragOver ? styles.dragOver : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void upload(e.dataTransfer.files);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            className={styles.hiddenInput}
            onChange={(e) => void upload(e.target.files)}
          />
          <p className={styles.dropText}>
            {t('Arrastra archivos aquí o', 'Drag files here or')}
          </p>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? t('Subiendo…', 'Uploading…') : t('Seleccionar archivos', 'Choose files')}
          </Button>
          <p className={styles.hint}>
            {t('Imágenes, PDF, documentos…', 'Images, PDFs, documents…')} ·{' '}
            {t('máx.', 'max')} {Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB
          </p>
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}

      {grouped.length === 0 ? (
        <EmptyState
          title={t('Aún no hay archivos', 'No files yet')}
          hint={
            canWrite
              ? t('Sube el primero para empezar el almacén del proyecto.', 'Upload the first one to start the project store.')
              : t('Cuando el equipo suba archivos, aparecerán aquí.', 'When the team uploads files, they will appear here.')
          }
        />
      ) : (
        grouped.map(({ cat, items }) => (
          <section key={cat} className={styles.group}>
            <header className={styles.groupHeader}>
              <h2 className={styles.groupTitle}>
                <span aria-hidden className={styles.groupGlyph}>{CATEGORY_GLYPH[cat]}</span>
                {t(CATEGORY_LABEL[cat].es, CATEGORY_LABEL[cat].en)}
              </h2>
              <Badge tone="neutral">{items.length}</Badge>
            </header>
            <ul className={styles.grid}>
              {items.map((f) => {
                const href = `/api/v1/projects/${slug}/files/${f.id}`;
                const canDelete = canManage || f.uploadedById === currentUserId;
                return (
                  <li key={f.id} className={styles.card}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.preview}
                      title={t('Abrir', 'Open')}
                    >
                      {cat === 'IMAGE' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={href} alt={f.name} loading="lazy" className={styles.thumb} />
                      ) : (
                        <span aria-hidden className={styles.fileGlyph}>{CATEGORY_GLYPH[cat]}</span>
                      )}
                    </a>
                    <div className={styles.meta}>
                      <a href={href} target="_blank" rel="noopener noreferrer" className={styles.name} title={f.name}>
                        {f.name}
                      </a>
                      <p className={styles.sub}>
                        {formatBytes(f.size)} · {fmtDate(f.createdAt)}
                      </p>
                      <p className={styles.sub}>{f.uploaderName}</p>
                      <div className={styles.actions}>
                        <a className={styles.download} href={`${href}?download=1`}>
                          {t('Descargar', 'Download')}
                        </a>
                        {canDelete && (
                          <button
                            type="button"
                            className={styles.deleteBtn}
                            onClick={() => remove(f)}
                            disabled={busy}
                          >
                            {t('Eliminar', 'Delete')}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
