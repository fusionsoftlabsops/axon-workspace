'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { FileCategory, MemberRole } from '@prisma/client';
import { Button, EmptyState } from '@/components/ui';
import { CATEGORY_ORDER, CATEGORY_LABEL, categorize, formatBytes, MAX_FILE_BYTES } from '@/lib/files';
import { setFileContextAction, generateFileContextAction, type ContextStatus } from '@/lib/actions/files';
import { generateProjectImageAction } from '@/lib/actions/image';
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
  currentUserName,
  files,
}: {
  slug: string;
  role: MemberRole;
  currentUserId: string;
  currentUserName?: string;
  files: FileView[];
}) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Local, authoritative-once-mutated copy of the file list. Mutations patch it
  // directly from the API/action response (no dependency on router.refresh()
  // completing to reflect success — see incident: refresh() wrapped in a
  // transition can hang indefinitely on this deployment, freezing the UI).
  const [fileList, setFileList] = useState<FileView[]>(files);
  useEffect(() => setFileList(files), [files]);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (successTimer.current) clearTimeout(successTimer.current);
  }, []);
  function flashSuccess(msg: string) {
    setSuccess(msg);
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setSuccess(null), 4000);
  }
  function patchFile(id: string, patch: Partial<FileView>) {
    setFileList((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }
  // Category accordions — all collapsed by default.
  const [openCats, setOpenCats] = useState<Set<FileCategory>>(() => new Set());
  const toggleCat = (cat: FileCategory) =>
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  const canWrite = role !== 'VIEWER';
  const canManage = role === 'OWNER' || role === 'ADMIN';

  // Generación de imágenes (gpt-image-1): mockups de UI + assets → van al store.
  const [imgPrompt, setImgPrompt] = useState('');
  const [imgBusy, setImgBusy] = useState(false);

  async function genImage() {
    const prompt = imgPrompt.trim();
    if (!prompt || imgBusy) return;
    setImgBusy(true);
    setError(null);
    const res = await generateProjectImageAction(slug, prompt);
    setImgBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setImgPrompt('');
    flashSuccess(t('Imagen generada y guardada en Archivos', 'Image generated and saved to Files'));
    router.refresh();
  }

  const isContext = (f: FileView) => f.isContext;
  const isImage = (f: FileView) => f.category === 'IMAGE';
  const statusOf = (f: FileView): ContextStatus => f.contextStatus;
  const contextCount = fileList.filter(isContext).length;

  // Poll (via the action itself, not a full page refresh) while any document is
  // still generating its context artifact — this is a background job.
  const generatingKey = fileList
    .filter((f) => statusOf(f) === 'GENERATING')
    .map((f) => f.id)
    .sort()
    .join(',');
  useEffect(() => {
    if (!generatingKey) return;
    const ids = generatingKey.split(',');
    const timer = setInterval(() => {
      ids.forEach((fid) => {
        void generateFileContextAction(slug, fid).then((r) => {
          if (r.ok && r.data) patchFile(fid, { contextStatus: r.data.contextStatus });
        });
      });
    }, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatingKey, slug]);

  function toggleContext(file: FileView) {
    const next = !isContext(file);
    setError(null);
    setTogglingId(file.id);
    patchFile(file.id, { isContext: next }); // optimistic
    startTransition(async () => {
      const r = await setFileContextAction(slug, file.id, next);
      setTogglingId(null);
      if (!r.ok) {
        patchFile(file.id, { isContext: !next }); // revert
        setError(r.error);
        return;
      }
      // The action already returns the authoritative post-write state.
      patchFile(r.data!.id, { isContext: r.data!.isContext, contextStatus: r.data!.contextStatus });
    });
  }

  function generateContext(file: FileView) {
    setError(null);
    patchFile(file.id, { contextStatus: 'GENERATING' }); // optimistic
    startTransition(async () => {
      const r = await generateFileContextAction(slug, file.id);
      if (!r.ok) {
        patchFile(file.id, { contextStatus: 'FAILED' });
        setError(r.error);
        return;
      }
      patchFile(file.id, { contextStatus: r.data!.contextStatus });
    });
  }

  async function upload(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    const items = Array.from(list);
    const tooBig = items.find((f) => f.size > MAX_FILE_BYTES);
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
    items.forEach((f) => form.append('file', f));
    setUploading(true);
    try {
      const res = await fetch(`/api/v1/projects/${slug}/files`, { method: 'POST', body: form });
      let body: { ids?: string[]; error?: string } | null = null;
      try {
        body = await res.json();
      } catch {
        /* no/invalid body */
      }
      if (!res.ok) {
        setError(body?.error ?? t('Error al subir', 'Upload failed'));
        return;
      }
      if (inputRef.current) inputRef.current.value = '';
      const ids = Array.isArray(body?.ids) ? body!.ids : [];
      const now = new Date().toISOString();
      const added: FileView[] = items.map((f, i) => ({
        id: ids[i] ?? `tmp-${Date.now()}-${i}`,
        name: f.name || 'archivo',
        mimeType: f.type || 'application/octet-stream',
        size: f.size,
        category: categorize(f.type || '', f.name || ''),
        createdAt: now,
        uploadedById: currentUserId,
        uploaderName: currentUserName ?? t('Vos', 'You'),
        isContext: false,
        contextStatus: 'NONE',
      }));
      setFileList((prev) => [...added, ...prev]);
      flashSuccess(
        items.length === 1
          ? t(`"${items[0]!.name}" se subió correctamente`, `"${items[0]!.name}" uploaded successfully`)
          : t(`${items.length} archivos se subieron correctamente`, `${items.length} files uploaded successfully`),
      );
      // Best-effort background reconciliation (e.g. other users' uploads too).
      // The UI above already reflects success regardless of whether this succeeds.
      router.refresh();
    } catch {
      setError(t('Error de red al subir', 'Network error while uploading'));
    } finally {
      setUploading(false);
    }
  }

  function remove(file: FileView) {
    if (!confirm(t(`¿Eliminar "${file.name}"?`, `Delete "${file.name}"?`))) return;
    setError(null);
    setDeletingId(file.id);
    void (async () => {
      try {
        const res = await fetch(`/api/v1/projects/${slug}/files/${file.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          setError(j?.error ?? t('Error al eliminar', 'Delete failed'));
          return;
        }
        setFileList((prev) => prev.filter((x) => x.id !== file.id));
        flashSuccess(t(`"${file.name}" se eliminó correctamente`, `"${file.name}" deleted successfully`));
        router.refresh(); // best-effort background reconciliation
      } catch {
        setError(t('Error de red al eliminar', 'Network error while deleting'));
      } finally {
        setDeletingId(null);
      }
    })();
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: fileList.filter((f) => f.category === cat),
  })).filter((g) => g.items.length > 0);

  const busy = uploading || pending;

  return (
    <div className={styles.wrap}>
      {/* Slim horizontal upload bar — drag target + action on one line. */}
      {canWrite && (
        <div
          className={`${styles.uploader} ${dragOver ? styles.dragOver : ''}`}
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
          <span aria-hidden className={styles.uploaderGlyph}>⤒</span>
          <div className={styles.uploaderCopy}>
            <p className={styles.uploaderText}>
              {t('Arrastra archivos al almacén o', 'Drop files into the store, or')}
            </p>
            <p className={styles.uploaderHint}>
              {t('Imágenes, PDF, documentos…', 'Images, PDFs, documents…')} ·{' '}
              {t('máx.', 'max')} {Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB
            </p>
          </div>
          <Button variant="primary" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? t('Subiendo…', 'Uploading…') : t('Seleccionar archivos', 'Choose files')}
          </Button>
        </div>
      )}

      {/* Generación de imágenes con IA (gpt-image-1): mockups de UI + assets. */}
      {canWrite && (
        <div className={styles.uploader} data-testid="image-gen">
          <span aria-hidden className={styles.uploaderGlyph}>🎨</span>
          <div className={styles.uploaderCopy} style={{ flex: 1 }}>
            <p className={styles.uploaderText}>
              {t('Generar imagen con IA', 'Generate image with AI')}
            </p>
            <textarea
              value={imgPrompt}
              onChange={(e) => setImgPrompt(e.target.value)}
              rows={2}
              placeholder={t(
                'Describí un mockup de pantalla o un asset (ícono, ilustración, hero)…',
                'Describe a screen mockup or an asset (icon, illustration, hero)…',
              )}
              style={{
                width: '100%',
                marginTop: 4,
                padding: '0.4rem 0.6rem',
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                background: 'transparent',
                color: 'inherit',
                font: 'inherit',
                resize: 'vertical',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void genImage();
                }
              }}
            />
          </div>
          <Button variant="secondary" disabled={imgBusy || !imgPrompt.trim()} onClick={() => void genImage()}>
            {imgBusy ? t('Generando… (puede tardar)', 'Generating… (may take a while)') : t('Generar', 'Generate')}
          </Button>
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
      {success && (
        <p className={styles.success} role="status">
          ✓ {success}
        </p>
      )}

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

      {/* How the context system works — a compact, horizontal explainer. */}
      <aside className={styles.howto}>
        <p className={styles.howtoTitle}>
          <span aria-hidden className={styles.ctxStar}>✦</span>{' '}
          {t('Cómo funciona el contexto', 'How context works')}
        </p>
        <ol className={styles.howtoSteps}>
          <li className={styles.step}>
            <span className={styles.stepNum}>1</span>
            <span className={styles.stepBody}>
              <span className={styles.stepTitle}>{t('Genera el contexto', 'Generate the context')}</span>
              <span className={styles.stepText}>
                {t(
                  'Convierte un documento a Markdown una sola vez, en tu propio servidor — sin gastar tokens. Queda guardado.',
                  'Turns a document into Markdown once, on your own server — no token cost. It stays saved.',
                )}
              </span>
            </span>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNum}>2</span>
            <span className={styles.stepBody}>
              <span className={styles.stepTitle}>{t('Úsalo en el plan', 'Use it in the plan')}</span>
              <span className={styles.stepText}>
                {t(
                  'Márcalo y la planeación con IA y el chat lo tendrán en cuenta. Las imágenes se usan directamente.',
                  'Mark it and AI planning plus the chat take it into account. Images are used directly.',
                )}
              </span>
            </span>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNum}>3</span>
            <span className={styles.stepBody}>
              <span className={styles.stepTitle}>{t('Descárgalo o ajústalo', 'Download or adjust it')}</span>
              <span className={styles.stepText}>
                {t(
                  'Baja el .md generado cuando lo necesites, o deselecciona archivos desde el chat del plan.',
                  'Download the generated .md anytime, or deselect files from the plan chat.',
                )}
              </span>
            </span>
          </li>
        </ol>
      </aside>

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
        grouped.map(({ cat, items }) => {
          const open = openCats.has(cat);
          const usedHere = items.filter(isContext).length;
          return (
          <section key={cat} className={`${styles.group} ${open ? styles.groupOpen : ''}`}>
            <h2 className={styles.groupHeading}>
              <button
                type="button"
                className={styles.groupHeader}
                aria-expanded={open}
                onClick={() => toggleCat(cat)}
              >
                <span aria-hidden className={styles.chevron}>{open ? '▾' : '▸'}</span>
                <span aria-hidden className={styles.groupGlyph}>{CATEGORY_GLYPH[cat]}</span>
                <span className={styles.groupTitle}>{t(CATEGORY_LABEL[cat].es, CATEGORY_LABEL[cat].en)}</span>
                <span className={styles.groupCount}>{items.length}</span>
                {usedHere > 0 && (
                  <span className={styles.groupCtx} title={t('Usados como contexto', 'Used as context')}>
                    ✦ {usedHere}
                  </span>
                )}
              </button>
            </h2>
            {open && (
            <ul className={styles.rows}>
              {items.map((f) => {
                const href = `/api/v1/projects/${slug}/files/${f.id}`;
                const canDelete = canManage || f.uploadedById === currentUserId;
                const ctxOn = isContext(f);
                const status = statusOf(f);
                const image = isImage(f);
                const mdNode = image
                  ? ''
                  : status === 'READY'
                    ? styles.nodeDone
                    : status === 'GENERATING'
                      ? styles.nodeActive
                      : status === 'FAILED'
                        ? styles.nodeFail
                        : styles.nodePending;
                return (
                  <li
                    key={f.id}
                    className={`${styles.row} ${ctxOn ? styles.rowOn : ''}`}
                    data-testid="file-row"
                    data-file-id={f.id}
                  >
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.thumb}
                      title={t('Abrir', 'Open')}
                    >
                      {image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={href} alt={f.name} loading="lazy" className={styles.thumbImg} />
                      ) : (
                        <span aria-hidden className={styles.thumbGlyph}>{CATEGORY_GLYPH[cat]}</span>
                      )}
                    </a>

                    <div className={styles.rowMain}>
                      <a href={href} target="_blank" rel="noopener noreferrer" className={styles.rowName} title={f.name}>
                        {f.name}
                      </a>
                      <p className={styles.rowMeta}>
                        {formatBytes(f.size)} · {fmtDate(f.createdAt)} · {f.uploaderName}
                      </p>
                    </div>

                    {/* ---- Context pipeline (signature): uploaded → markdown → in plan ---- */}
                    <div className={styles.pipe}>
                      <div className={styles.track} aria-hidden>
                        <span className={`${styles.node} ${styles.nodeDone}`}>{t('subido', 'uploaded')}</span>
                        {!image && (
                          <>
                            <span className={`${styles.seg} ${status === 'READY' ? styles.segOn : ''}`} />
                            <span className={`${styles.node} ${mdNode}`}>markdown</span>
                          </>
                        )}
                        <span className={`${styles.seg} ${ctxOn ? styles.segOn : ''}`} />
                        <span className={`${styles.node} ${ctxOn ? styles.nodeDone : styles.nodePending}`}>
                          {t('en el plan', 'in plan')}
                        </span>
                      </div>

                      {canWrite && (
                        <div className={styles.pipeCtl}>
                          {image ? (
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
                            <span className={styles.ctxGen} role="status" aria-live="polite">
                              <span className={styles.spinner} aria-hidden />
                              <span className={styles.ctxGenText}>
                                {t('Generando contexto…', 'Generating context…')}
                              </span>
                            </span>
                          ) : status === 'READY' ? (
                            <>
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
                            </>
                          ) : (
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
                          )}
                        </div>
                      )}
                    </div>

                    <div className={styles.rowActions}>
                      <a className={styles.download} href={`${href}?download=1`}>
                        {t('Descargar', 'Download')}
                      </a>
                      {canDelete && (
                        <button
                          type="button"
                          className={styles.deleteBtn}
                          onClick={() => remove(f)}
                          disabled={deletingId === f.id}
                        >
                          {deletingId === f.id ? t('Eliminando…', 'Deleting…') : t('Eliminar', 'Delete')}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            )}
          </section>
          );
        })
      )}
    </div>
  );
}
