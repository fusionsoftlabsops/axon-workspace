'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useI18n } from '@/lib/i18n/i18n';
import { createProjectAgentTokenAction, type ProjectAgentSetup } from '@/lib/actions/fusion-code';

export interface DevelopHU {
  number: number;
  title: string;
  state: string;
  done: boolean;
  sprint: string | null;
}

const card: React.CSSProperties = {
  padding: '1rem 1.25rem',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  marginBottom: '1.25rem',
};
const stepNum: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  borderRadius: 999,
  background: 'var(--color-accent)',
  color: 'var(--color-accent-fg)',
  fontSize: '0.75rem',
  fontWeight: 700,
  marginRight: 8,
};

function CopyRow({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', margin: '0.4rem 0' }}>
      <pre
        style={{
          flex: 1,
          margin: 0,
          padding: '0.55rem 0.7rem',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8rem',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          overflowX: 'auto',
        }}
      >
        {value}
      </pre>
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })}
        style={{
          padding: '0.4rem 0.75rem',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          background: 'transparent',
          color: 'var(--color-fg)',
          whiteSpace: 'nowrap',
        }}
      >
        {copied ? t('¡Copiado!', 'Copied!') : (label ?? t('Copiar', 'Copy'))}
      </button>
    </div>
  );
}

export function DevelopClient({
  slug,
  canGenerate,
  fusionBase,
  mcpUrl,
  hus,
}: {
  slug: string;
  canGenerate: boolean;
  fusionBase: string | null;
  mcpUrl: string;
  hus: DevelopHU[];
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<ProjectAgentSetup | null>(null);
  const [os, setOs] = useState<'sh' | 'ps1'>('sh');

  const installOneLiner = fusionBase
    ? os === 'sh'
      ? `curl -fsSL ${fusionBase.replace(/\/$/, '')}/api/coding-tools/install.sh | sh`
      : `irm ${fusionBase.replace(/\/$/, '')}/api/coding-tools/install.ps1 | iex`
    : null;

  const envLine = setup ? `AXON_API_TOKEN=${setup.plainToken}` : '';
  const axonConfig = `{ "projectSlug": "${slug}" }`;
  const mcpSnippet = setup
    ? JSON.stringify(
        { mcpServers: { axon: { httpUrl: mcpUrl, headers: { Authorization: 'Bearer ${AXON_API_TOKEN}' } } } },
        null,
        2,
      )
    : '';

  function generate() {
    setError(null);
    start(async () => {
      const r = await createProjectAgentTokenAction(slug);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (r.data) setSetup(r.data);
    });
  }

  return (
    <div>
      {/* Step 1 — install */}
      <section style={card}>
        <h3 style={{ margin: '0 0 0.5rem' }}>
          <span style={stepNum}>1</span>
          {t('Instalá Fusion Code', 'Install Fusion Code')}
        </h3>
        <p style={{ margin: '0 0 0.5rem', color: 'var(--color-fg-muted)', fontSize: '0.9rem' }}>
          {t(
            'Nuestro editor: Qwen Code configurado contra nuestro modelo (Qwen3-Coder-Next en GPU propia), con convenciones, comandos y los MCP de la plataforma. Requiere Node.js.',
            'Our editor: Qwen Code configured against our model (Qwen3-Coder-Next on our own GPU), with conventions, commands and the platform MCPs. Requires Node.js.',
          )}
        </p>
        {installOneLiner ? (
          <>
            <div style={{ display: 'inline-flex', gap: 4, marginBottom: 6 }}>
              {(['sh', 'ps1'] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOs(o)}
                  style={{
                    padding: '0.2rem 0.6rem',
                    border: '1px solid var(--color-border)',
                    borderRadius: 6,
                    background: os === o ? 'var(--color-accent)' : 'transparent',
                    color: os === o ? 'var(--color-accent-fg)' : 'var(--color-fg)',
                    fontSize: '0.75rem',
                  }}
                >
                  {o === 'sh' ? 'macOS / Linux' : 'Windows'}
                </button>
              ))}
            </div>
            <CopyRow value={installOneLiner} />
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--color-fg-muted)' }}>
              {t(
                'El instalador te pide la URL del modelo y tu token del modelo — generalos en la página Coding Tools de la plataforma.',
                'The installer asks for the model URL and your model token — generate them on the platform Coding Tools page.',
              )}
            </p>
          </>
        ) : (
          <p style={{ fontSize: '0.85rem', color: 'var(--color-fg-muted)' }}>
            {t(
              'Instalá Fusion Code desde la página Coding Tools de la plataforma (fusion-soft-lab).',
              'Install Fusion Code from the platform Coding Tools page (fusion-soft-lab).',
            )}
          </p>
        )}
      </section>

      {/* Step 2 — connect this project to Axon */}
      <section style={card}>
        <h3 style={{ margin: '0 0 0.5rem' }}>
          <span style={stepNum}>2</span>
          {t('Conectá este proyecto', 'Connect this project')}
        </h3>
        <p style={{ margin: '0 0 0.6rem', color: 'var(--color-fg-muted)', fontSize: '0.9rem' }}>
          {t(
            'Generá un token de este proyecto para que el editor lea tus HU y el cerebro. Se muestra una sola vez.',
            'Generate a token for this project so the editor can read your stories and the brain. Shown only once.',
          )}
        </p>
        {!setup ? (
          <button
            type="button"
            onClick={generate}
            disabled={pending || !canGenerate}
            style={{
              padding: '0.5rem 1rem',
              border: 'none',
              borderRadius: 6,
              background: 'var(--color-accent)',
              color: 'var(--color-accent-fg)',
              fontWeight: 600,
              opacity: canGenerate ? 1 : 0.5,
            }}
          >
            {pending ? t('Generando…', 'Generating…') : t('Generar token del proyecto', 'Generate project token')}
          </button>
        ) : (
          <div>
            <p style={{ margin: '0 0 0.2rem', fontSize: '0.82rem', fontWeight: 600 }}>
              {t('1) Pegá esta línea en ', '1) Paste this line into ')}
              <code>~/.qwen/.env</code>:
            </p>
            <CopyRow value={envLine} />
            <p style={{ margin: '0.5rem 0 0.2rem', fontSize: '0.82rem', fontWeight: 600 }}>
              {t('2) Creá ', '2) Create ')}
              <code>.axon/config.json</code>
              {t(' en la raíz del repo:', ' at the repo root:')}
            </p>
            <CopyRow value={axonConfig} />
            <details style={{ marginTop: '0.5rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.82rem', color: 'var(--color-fg-muted)' }}>
                {t('¿El MCP «axon» no aparece? Agregá esto a ', 'MCP "axon" missing? Add this to ')}
                <code>~/.qwen/settings.json</code>
              </summary>
              <CopyRow value={mcpSnippet} />
            </details>
            {canGenerate && (
              <button
                type="button"
                onClick={generate}
                disabled={pending}
                style={{
                  marginTop: '0.5rem',
                  padding: '0.3rem 0.7rem',
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  background: 'transparent',
                  color: 'var(--color-fg)',
                  fontSize: '0.8rem',
                }}
              >
                {t('Regenerar (revoca el anterior si lo revocás en Ajustes)', 'Regenerate')}
              </button>
            )}
          </div>
        )}
        {error && <p style={{ color: 'var(--color-danger)', marginTop: '0.5rem' }}>{error}</p>}
      </section>

      {/* Step 3 — pick an HU */}
      <section style={card}>
        <h3 style={{ margin: '0 0 0.5rem' }}>
          <span style={stepNum}>3</span>
          {t('Elegí una HU y empezá', 'Pick a story and start')}
        </h3>
        <p style={{ margin: '0 0 0.6rem', color: 'var(--color-fg-muted)', fontSize: '0.9rem' }}>
          {t('Corré ', 'Run ')}
          <code>qwen</code>
          {t(' en tu repo y usá ', ' in your repo and use ')}
          <code>/task N</code>
          {t(': baja la HU (título, descripción, criterios) + el cerebro a ', ': it pulls the story (title, description, criteria) + the brain to ')}
          <code>.axon/current-task.md</code>.
        </p>
        {hus.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--color-fg-muted)' }}>
            {t('Todavía no hay HUs. Publicá un plan en ', 'No stories yet. Publish a plan in ')}
            <Link href={`/projects/${slug}/plan`}>{t('Plan', 'Plan')}</Link>.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <tbody>
              {hus.map((h) => (
                <tr key={h.number} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.4rem 0.3rem', fontFamily: 'var(--font-mono)', color: 'var(--color-fg-muted)' }}>
                    #{h.number}
                  </td>
                  <td style={{ padding: '0.4rem 0.3rem', opacity: h.done ? 0.55 : 1 }}>
                    {h.title}
                    {h.sprint ? <span style={{ color: 'var(--color-fg-muted)' }}> · {h.sprint}</span> : null}
                  </td>
                  <td style={{ padding: '0.4rem 0.3rem', color: 'var(--color-fg-muted)', whiteSpace: 'nowrap' }}>
                    {h.state}
                  </td>
                  <td style={{ padding: '0.4rem 0.3rem', textAlign: 'right' }}>
                    <CopyRow value={`/task ${h.number}`} label={t('Copiar /task', 'Copy /task')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ marginTop: '0.5rem', fontSize: '0.82rem' }}>
          <Link href={`/projects/${slug}/board`}>{t('Ver el tablero →', 'Open the board →')}</Link>
        </p>
      </section>

      {/* Step 4 — finish */}
      <section style={card}>
        <h3 style={{ margin: '0 0 0.5rem' }}>
          <span style={stepNum}>4</span>
          {t('Al terminar', 'When you finish')}
        </h3>
        <p style={{ margin: 0, color: 'var(--color-fg-muted)', fontSize: '0.9rem' }}>
          <code>/sync</code>
          {t(' publica los aprendizajes al cerebro del proyecto; ', ' publishes learnings to the project brain; ')}
          <code>/doctor</code>
          {t(' diagnostica el setup (modelo, tokens y MCP).', ' diagnoses the setup (model, tokens and MCP).')}
        </p>
      </section>
    </div>
  );
}
