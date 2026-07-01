'use client';

import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n/i18n';
import {
  createSkillAction,
  reviewSkillAction,
  deleteSkillAction,
  type SkillView,
  type SkillCategory,
  type SkillKind,
} from '@/lib/actions/skills';

const CATEGORIES: SkillCategory[] = ['TESTING', 'QUALITY', 'WORKFLOW', 'ARCHITECTURE', 'GIT', 'OTHER'];
const KINDS: SkillKind[] = ['COMMAND', 'GUIDELINE'];

const card: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  background: 'var(--color-surface)',
  marginBottom: '0.9rem',
};
const badge = (bg: string): React.CSSProperties => ({
  fontSize: '0.68rem',
  fontWeight: 700,
  padding: '0.05rem 0.4rem',
  borderRadius: 999,
  background: bg,
  color: '#fff',
});
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: '0.82rem' };
const muted: React.CSSProperties = { color: 'var(--color-fg-muted)', fontSize: '0.85rem' };
const pre: React.CSSProperties = {
  margin: '0.5rem 0 0',
  padding: '0.6rem 0.7rem',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  fontFamily: 'var(--font-mono)',
  fontSize: '0.76rem',
  whiteSpace: 'pre-wrap',
  overflowX: 'auto',
  maxHeight: 260,
};

function download(name: string, body: string) {
  const blob = new Blob([body], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function SkillCard({
  skill,
  isMaster,
  onChange,
  onRemove,
}: {
  skill: SkillView;
  isMaster: boolean;
  onChange: (s: SkillView) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, start] = useTransition();

  function review(patch: { status?: SkillView['status']; official?: boolean }) {
    start(async () => {
      const r = await reviewSkillAction(skill.id, patch);
      if (r.ok && r.data) onChange(r.data);
    });
  }
  function remove() {
    if (!confirm(t('¿Eliminar este skill?', 'Delete this skill?'))) return;
    start(async () => {
      const r = await deleteSkillAction(skill.id);
      if (r.ok) onRemove(skill.id);
    });
  }

  return (
    <section style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 0.9rem' }}>
        <code style={mono}>/{skill.slug}</code>
        <strong style={{ flex: 1 }}>{skill.name}</strong>
        {skill.official ? <span style={badge('#3b82f6')}>{t('Oficial', 'Official')}</span> : <span style={badge('#6b7280')}>{t('Comunidad', 'Community')}</span>}
        {skill.status !== 'APPROVED' && <span style={badge(skill.status === 'PENDING' ? '#eab308' : '#ef4444')}>{skill.status}</span>}
        <span style={{ ...muted, ...mono }}>{skill.category.toLowerCase()}</span>
        <button type="button" onClick={() => setOpen((v) => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-fg)' }}>
          {open ? '▾' : '▸'}
        </button>
      </div>
      <div style={{ padding: '0 0.9rem 0.8rem' }}>
        <p style={{ ...muted, margin: 0 }}>{skill.description}</p>
        {skill.tags.length > 0 && (
          <div style={{ marginTop: '0.35rem', display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
            {skill.tags.map((tag) => (
              <span key={tag} style={{ ...muted, ...mono, fontSize: '0.7rem' }}>#{tag}</span>
            ))}
          </div>
        )}
        {open && <pre style={pre}>{skill.body}</pre>}
        <div style={{ display: 'flex', gap: 8, marginTop: '0.6rem', flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            onClick={() =>
              navigator.clipboard?.writeText(skill.body).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? t('¡Copiado!', 'Copied!') : t('Copiar', 'Copy')}
          </Button>
          <Button variant="secondary" onClick={() => download(`${skill.slug}.md`, skill.body)}>
            {t('Descargar .md', 'Download .md')}
          </Button>
          {isMaster && (
            <>
              {skill.status !== 'APPROVED' && (
                <Button variant="primary" onClick={() => review({ status: 'APPROVED' })} disabled={busy}>
                  {t('Aprobar', 'Approve')}
                </Button>
              )}
              <Button variant="secondary" onClick={() => review({ official: !skill.official })} disabled={busy}>
                {skill.official ? t('Quitar oficial', 'Unmark official') : t('Marcar oficial', 'Mark official')}
              </Button>
              {skill.status !== 'DEPRECATED' && (
                <Button variant="secondary" onClick={() => review({ status: 'DEPRECATED' })} disabled={busy}>
                  {t('Deprecar', 'Deprecate')}
                </Button>
              )}
              <Button variant="secondary" onClick={remove} disabled={busy}>
                {t('Eliminar', 'Delete')}
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ContributeForm({ onCreated }: { onCreated: (s: SkillView) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ slug: '', name: '', description: '', category: 'OTHER' as SkillCategory, kind: 'COMMAND' as SkillKind, body: '', tags: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const r = await createSkillAction({
        slug: form.slug,
        name: form.name,
        description: form.description,
        category: form.category,
        kind: form.kind,
        body: form.body,
        tags: form.tags.split(',').map((s) => s.trim()).filter(Boolean),
      });
      if (!r.ok) setError(r.error);
      else if (r.data) {
        onCreated(r.data);
        setForm({ slug: '', name: '', description: '', category: 'OTHER', kind: 'COMMAND', body: '', tags: '' });
        setOpen(false);
      }
    });
  }

  const input: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    background: 'var(--color-bg)',
    color: 'var(--color-fg)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.86rem',
    marginTop: '0.25rem',
  };

  if (!open) {
    return (
      <div style={{ margin: '0.5rem 0 1.5rem' }}>
        <Button variant="primary" onClick={() => setOpen(true)}>{t('+ Contribuir un skill', '+ Contribute a skill')}</Button>
      </div>
    );
  }
  return (
    <section style={{ ...card, padding: '0.9rem', marginBottom: '1.5rem' }}>
      <h3 style={{ margin: '0 0 0.5rem' }}>{t('Contribuir un skill', 'Contribute a skill')}</h3>
      <p style={{ ...muted, margin: '0 0 0.5rem' }}>{t('Entra como pendiente; un administrador lo revisa y lo marca oficial.', 'Enters as pending; an admin reviews it and marks it official.')}</p>
      <label style={muted}>Slug (kebab-case)<input style={input} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="mi-skill" /></label>
      <label style={muted}>{t('Nombre', 'Name')}<input style={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <label style={muted}>{t('Descripción', 'Description')}<input style={input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      <div style={{ display: 'flex', gap: '0.6rem' }}>
        <label style={{ ...muted, flex: 1 }}>{t('Categoría', 'Category')}
          <select style={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as SkillCategory })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={{ ...muted, flex: 1 }}>{t('Tipo', 'Kind')}
          <select style={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as SkillKind })}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
      </div>
      <label style={muted}>Tags ({t('separadas por coma', 'comma-separated')})<input style={input} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></label>
      <label style={muted}>{t('Contenido (Markdown)', 'Content (Markdown)')}<textarea style={{ ...input, minHeight: 140, fontFamily: 'var(--font-mono)' }} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
      {error && <p style={{ color: 'var(--color-danger)', marginTop: '0.4rem' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: '0.6rem' }}>
        <Button variant="primary" onClick={submit} disabled={busy}>{busy ? t('Enviando…', 'Submitting…') : t('Enviar para revisión', 'Submit for review')}</Button>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>{t('Cancelar', 'Cancel')}</Button>
      </div>
    </section>
  );
}

export function SkillsClient({ initialSkills, isMaster }: { initialSkills: SkillView[]; isMaster: boolean }) {
  const { t } = useI18n();
  const [skills, setSkills] = useState(initialSkills);

  const update = (s: SkillView) => setSkills((cur) => cur.map((x) => (x.id === s.id ? s : x)));
  const remove = (id: string) => setSkills((cur) => cur.filter((x) => x.id !== id));
  const created = (s: SkillView) => setSkills((cur) => [s, ...cur]);

  // Community members only see approved skills + their own contributions; masters see all.
  const visible = isMaster ? skills : skills.filter((s) => s.status === 'APPROVED');
  const byCategory = useMemo(() => {
    const groups: Record<string, SkillView[]> = {};
    for (const s of visible) (groups[s.category] ??= []).push(s);
    return groups;
  }, [visible]);

  return (
    <div>
      <section style={{ ...card, padding: '0.9rem', marginBottom: '1.2rem' }}>
        <h3 style={{ margin: '0 0 0.4rem' }}>{t('Instalar / sincronizar', 'Install / sync')}</h3>
        <p style={{ ...muted, margin: '0 0 0.4rem' }}>
          {t('En Fusion Code, corré ', 'In Fusion Code, run ')}
          <code style={mono}>/skills sync</code>
          {t(' para bajar el paquete a ~/.qwen (quedan disponibles como comandos, ej. ', ' to pull the package into ~/.qwen (they become commands, e.g. ')}
          <code style={mono}>/cerrar-hu</code>
          {t('). También podés descargar cualquier skill como .md y ponerlo en ~/.qwen/commands.', '). You can also download any skill as .md and drop it in ~/.qwen/commands.')}
        </p>
        <p style={{ ...muted, margin: 0 }}>
          {t('Vía API/MCP: ', 'Via API/MCP: ')}
          <code style={mono}>GET /api/v1/skills</code> · <code style={mono}>list_skills</code>
          {t(' (leer) y ', ' (read) and ')}
          <code style={mono}>submit_skill</code>
          {t(' (contribuir).', ' (contribute).')}
        </p>
      </section>

      <ContributeForm onCreated={created} />

      {visible.length === 0 && <p style={muted}>{t('Todavía no hay skills.', 'No skills yet.')}</p>}
      {CATEGORIES.filter((c) => byCategory[c]?.length).map((c) => (
        <div key={c} style={{ marginBottom: '1.2rem' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>{c}</h3>
          {byCategory[c]!.map((s) => (
            <SkillCard key={s.id} skill={s} isMaster={isMaster} onChange={update} onRemove={remove} />
          ))}
        </div>
      ))}
    </div>
  );
}
