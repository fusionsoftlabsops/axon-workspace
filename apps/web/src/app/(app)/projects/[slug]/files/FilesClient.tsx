'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { FileCategory, MemberRole } from '@prisma/client';
import { Button, Badge, EmptyState } from '@/components/ui';
import { CATEGORY_ORDER, CATEGORY_LABEL, formatBytes, MAX_FILE_BYTES } from '@/lib/files';
import { setFileContextAction, generateFileContextAction, type ContextStatus } from '@/lib/actions/files';
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
  isContext: boolean;
  contextStatus: ContextStatus;
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
  // Optimistic overlays by file id, layered over the server-rendered values.
  const [ctxOverride, setCtxOverride] = useState<Record<string, boolean>>({});
  const [genOverride, setGenOverride] = useState<Record<string, ContextStatus>>({});
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const canWrite = role !== 'VIEWER';
  const canManage = role === 'OWNER' || role === 'ADMIN';

  const isContext = (f: FileView) => ctxOverride[f.id] ?? f.isContext;
  const isImage = (f: FileView) => f.category === 'IMAGE';
  // Prefer the server's terminal state; otherwise show the optimistic overlay.
  const statusOf = (f: FileView): ContextStatus =>
    f.contextStatus === 'READY' || f.contextStatus === 'FAILED'
      ? f.contextStatus
      : genOverride[f.id] ?? f.contextStatus;
  const contextCount = files.filter(isContext).length;

  // Poll while any document is still generating its context artifact.
  const anyGenerating = files.some((f) => statusOf(f) === 'GENERATING');
  useEffect(() => {
    if (!anyGenerating) return;
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [anyGenerating, router]);

  function toggleContext(file: FileView) {
    const next = !isContext(file);
    setError(null);
    setTogglingId(file.id);
    setCtxOverride((prev) => ({ ...prev, [file.id]: next }));
    startTransition(async () => {
      const r = await setFileContextAction(slug, file.id, next);
      setTogglingId(null);
      if (!r.ok) {
        setCtxOverride((prev) => ({ ...prev, [file.id]: !next })); // revert
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  function generateContext(file: FileView) {
    setError(null);
    setGenOverride((prev) => ({ ...prev, [file.id]: 'GENERATING' }));
    startTransition(async () => {
      const r = await generateFileContextAction(slug, file.id);
      if (!r.ok) {
        setGenOverride((prev) => ({ ...prev, [file.id]: 'FAILED' }));
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

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

      {contextCount > 0 ? (
        <p className={styles.ctxSummary}>
          <span aria-hidden className={styles.ctxStar}>✦</span>
          {t(
            `${contextCount} ${contextCount === 1 ? 'archivo alimenta' : 'archivos alimentan'} la planeación con IA`,
            `${contextCount} ${contextCount === 1 ? 'file feeds' : 'files feed'} AI planning`,
          )}{' '}
          ·{' '}
          <Link href={`/projects/${slug}/plan`} className={styles.ctxLink}>
            {t('Ver en Planeación', 'View in Planning')}
          </Link>
        </p>
      ) : (
        canWrite && (
          <p className={styles.ctxSummary}>
            {t(
              'Marca un archivo como contexto (✦) para que la planeación con IA y el chat lo tengan en cuenta.',
              'Mark a file as context (✦) so AI planning and the chat take it into account.',
            )}
          </p>
        )
      )}

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
                const ctxOn = isContext(f);
                const status = statusOf(f);
                return (
                  <li key={f.id} className={`${styles.card} ${ctxOn ? styles.cardContext : ''}`}>
                    {ctxOn && (
                      <span className={styles.contextRibbon} title={t('Usado como contexto', 'Used as context')}>
                        ✦ {t('Contexto', 'Context')}
                      </span>
                    )}
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

                      {/* ---- Context (double card) ---- */}
                      {canWrite && (
                        <div className={styles.ctxZone}>
                          {isImage(f) ? (
                            // Images: usable directly (fed as vision), no .md to generate.
                            <button
                              type="button"
                              className={`${styles.ctxBtn} ${ctxOn ? styles.ctxBtnOn : ''}`}
                              onClick={() => toggleContext(f)}
                              disabled={togglingId === f.id}
                              aria-pressed={ctxOn}
                            >
                              {togglingId === f.id
                                ? '…'
                                : ctxOn
                                  ? t('✦ En contexto', '✦ In context')
                                  : t('✦ Usar como contexto', '✦ Use as context')}
                            </button>
                          ) : status === 'GENERATING' ? (
                            <span className={styles.ctxGen}>⟳ {t('Generando contexto…', 'Generating context…')}</span>
                          ) : status === 'READY' ? (
                            <div className={styles.ctxReady}>
                              <span className={styles.ctxReadyTag}>✦ {t('Contexto listo', 'Context ready')}</span>
                              <label className={styles.ctxUse}>
                                <input
                                  type="checkbox"
                                  checked={ctxOn}
                                  disabled={togglingId === f.id}
                                  onChange={() => toggleContext(f)}
                                />
                                {t('Usar en el plan', 'Use in the plan')}
                              </label>
                              <a className={styles.download} href={`${href}/context`}>
                                {t('Descargar .md', 'Download .md')}
                              </a>
                            </div>
                          ) : (
                            <div className={styles.ctxGenWrap}>
                              <button
                                type="button"
                                className={styles.ctxBtn}
                                onClick={() => generateContext(f)}
                                disabled={pending}
                              >
                                {status === 'FAILED'
                                  ? t('⚠ Reintentar contexto', '⚠ Retry context')
                                  : t('✦ Generar contexto', '✦ Generate context')}
                              </button>
                            </div>
                          )}
                        </div>
                      )}

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
