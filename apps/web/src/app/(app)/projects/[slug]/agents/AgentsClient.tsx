'use client';

import { useState } from 'react';
import { Badge, Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n/i18n';
import {
  applyTeamPresetAction,
  setDevExecutorAction,
  verifyAgentsAction,
  type VerifyAgentsResult,
  provisionAgentAction,
  setAgentEnabledAction,
  updateAgentAction,
  type AgentRunView,
  type AgentStatsView,
  type AgentView,
} from '@/lib/actions/agents';
import { TEAM_PRESETS, PRESET_IDS, type TeamPreset } from '@/lib/agents/presets';
import styles from './agents.module.scss';

const ROLES = ['SM', 'PO', 'ARCHITECT', 'DESIGN', 'DEV', 'QA', 'REVIEWER', 'MARKETING', 'RELEASE'] as const;
type Role = (typeof ROLES)[number];

const DEFAULT_MODEL: Record<Role, string> = {
  SM: 'claude-sonnet-5',
  PO: 'claude-sonnet-5',
  ARCHITECT: 'claude-sonnet-5',
  DESIGN: 'claude-sonnet-5',
  DEV: 'qwen3-coder-next',
  QA: 'claude-sonnet-5',
  REVIEWER: 'claude-sonnet-5',
  MARKETING: 'claude-sonnet-5',
  RELEASE: 'claude-sonnet-5',
};

export function AgentsClient({
  slug,
  canManage,
  initialAgents,
  initialRuns,
  initialStats = null,
  initialPreset = null,
  initialDevExecutor = 'KAI',
}: {
  slug: string;
  canManage: boolean;
  initialAgents: AgentView[];
  initialRuns: AgentRunView[];
  initialStats?: AgentStatsView | null;
  initialPreset?: string | null;
  initialDevExecutor?: string;
}) {
  const { t } = useI18n();
  const [agents, setAgents] = useState<AgentView[]>(initialAgents);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Token recién acuñado: se muestra UNA vez (no se persiste en claro).
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  // Preset activo + tokens acuñados en bloque al aplicar un preset.
  const [activePreset, setActivePreset] = useState<string | null>(initialPreset);
  const [presetMinted, setPresetMinted] = useState<Array<{ role: string; token: string }>>([]);
  const [devExecutor, setDevExecutor] = useState<string>(initialDevExecutor);
  const [verifyResult, setVerifyResult] = useState<VerifyAgentsResult | null>(null);

  async function verify() {
    setBusy('verify');
    setError(null);
    setVerifyResult(null);
    const res = await verifyAgentsAction(slug);
    setBusy(null);
    if (!res.ok || !res.data) setError(res.ok ? 'Sin datos' : res.error);
    else setVerifyResult(res.data);
  }

  async function changeExecutor(mode: 'KAI' | 'CONSOLE' | 'HYBRID') {
    setBusy(`exec:${mode}`);
    setError(null);
    const res = await setDevExecutorAction(slug, mode);
    setBusy(null);
    if (!res.ok) setError(res.error);
    else setDevExecutor(mode);
  }

  async function applyPreset(preset: TeamPreset) {
    setBusy(`preset:${preset}`);
    setError(null);
    const res = await applyTeamPresetAction(slug, preset);
    setBusy(null);
    if (!res.ok || !res.data) {
      setError(res.ok ? 'Sin datos' : res.error);
      return;
    }
    setAgents(res.data.agents);
    setActivePreset(preset);
    setPresetMinted(res.data.minted);
  }

  const byRole = new Map(agents.map((a) => [a.role, a]));
  const missing = ROLES.filter((r) => !byRole.has(r));

  async function provision(role: Role) {
    setBusy(`prov:${role}`);
    setError(null);
    const res = await provisionAgentAction(slug, { role, llmModel: DEFAULT_MODEL[role] });
    setBusy(null);
    if (!res.ok || !res.data) {
      setError(res.ok ? 'Sin datos' : res.error);
      return;
    }
    setAgents(res.data.agents);
    setMintedToken(res.data.tokenPlain);
  }

  async function toggle(agent: AgentView) {
    setBusy(`toggle:${agent.id}`);
    setError(null);
    const res = await setAgentEnabledAction(slug, agent.id, !agent.enabled);
    setBusy(null);
    if (!res.ok) setError(res.error);
    else setAgents(res.data ?? []);
  }

  async function saveConfig(agent: AgentView, llmModel: string, tokenBudget: number, name: string) {
    setBusy(`save:${agent.id}`);
    setError(null);
    const res = await updateAgentAction(slug, agent.id, { llmModel, tokenBudget, displayName: name });
    setBusy(null);
    if (!res.ok) setError(res.error);
    else setAgents(res.data ?? []);
  }

  return (
    <div className={styles.grid}>
      {error && <p className={styles.error}>{error}</p>}

      {mintedToken && (
        <div className={styles.tokenBox} data-testid="minted-token">
          <p>
            {t(
              'Token del agente (se muestra UNA sola vez — configúralo en el worker axon-agents):',
              'Agent token (shown ONCE — set it on the axon-agents worker):',
            )}
          </p>
          <code>{mintedToken}</code>
          <Button size="sm" variant="secondary" onClick={() => setMintedToken(null)}>
            {t('Entendido, lo guardé', 'Got it, saved')}
          </Button>
        </div>
      )}

      <section data-testid="verify-agents">
        <h3 className={styles.sectionTitle}>{t('Salud del equipo', 'Team health')}</h3>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            disabled={!canManage || busy === 'verify'}
            data-testid="verify-button"
            onClick={() => void verify()}
          >
            {busy === 'verify' ? t('Verificando…', 'Verifying…') : t('🔁 Verificar y reactivar', '🔁 Verify & reactivate')}
          </Button>
          <span className={styles.hint}>
            {t(
              'Chequea el worker y re-dispara las HUs atascadas (ej. eventos perdidos durante un redeploy) para que los agentes retomen labores.',
              'Checks the worker and re-fires stuck stories (e.g. events lost during a redeploy) so agents resume work.',
            )}
          </span>
        </div>
        {verifyResult && (
          <div className={styles.card} style={{ marginTop: '0.5rem' }} data-testid="verify-result">
            <p className={styles.hint} style={{ margin: 0 }}>
              {verifyResult.worker.reachable
                ? verifyResult.worker.subscribed
                  ? t('✅ Worker vivo y suscrito a eventos.', '✅ Worker alive and subscribed to events.')
                  : t('⚠️ Worker vivo pero SIN suscripción a eventos — revisá Redis / redesplegá axon-agents.', '⚠️ Worker alive but NOT subscribed — check Redis / redeploy axon-agents.')
                : t('🛑 Worker inalcanzable — redesplegá axon-agents.', '🛑 Worker unreachable — redeploy axon-agents.')}
            </p>
            <p className={styles.hint} style={{ margin: '0.3rem 0 0' }}>
              {t('Reactivadas', 'Re-fired')}: {t('backlog', 'backlog')}{' '}
              {verifyResult.refired.backlog.length > 0 ? verifyResult.refired.backlog.map((n) => `#${n}`).join(', ') : '—'} ·{' '}
              {t('desarrollo', 'development')}{' '}
              {verifyResult.refired.development.length > 0 ? verifyResult.refired.development.map((n) => `#${n}`).join(', ') : '—'} ·{' '}
              {t('verificación', 'review')}{' '}
              {verifyResult.refired.review.length > 0 ? verifyResult.refired.review.map((n) => `#${n}`).join(', ') : '—'}
              {verifyResult.skippedRunning.length > 0 &&
                ` · ${t('en vuelo (no tocadas)', 'in flight (untouched)')}: ${verifyResult.skippedRunning.map((n) => `#${n}`).join(', ')}`}
            </p>
          </div>
        )}
      </section>

      <section data-testid="dev-executor">
        <h3 className={styles.sectionTitle}>{t('Ejecutor de desarrollo', 'Development executor')}</h3>
        <p className={styles.hint}>
          {t(
            'Quién implementa las HUs: el agente Kai, tu consola (Claude Code conectada por MCP, usando tu suscripción), o híbrido (triviales→Kai, UI/complejas→tu consola).',
            'Who implements stories: the Kai agent, your console (Claude Code over MCP, on your subscription), or hybrid (trivial→Kai, UI/complex→your console).',
          )}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {([
            ['KAI', '🤖 Kai (agente)', '🤖 Kai (agent)'],
            ['CONSOLE', '💻 Mi consola (Claude Code)', '💻 My console (Claude Code)'],
            ['HYBRID', '⚡ Híbrido', '⚡ Hybrid'],
          ] as const).map(([mode, es, en]) => (
            <Button
              key={mode}
              size="sm"
              variant={devExecutor === mode ? 'primary' : 'secondary'}
              disabled={!canManage || busy === `exec:${mode}` || devExecutor === mode}
              data-testid={`executor-${mode}`}
              onClick={() => void changeExecutor(mode)}
            >
              {busy === `exec:${mode}` ? t('Guardando…', 'Saving…') : t(es, en)}
            </Button>
          ))}
        </div>
        {devExecutor !== 'KAI' && (
          <p className={styles.hint} style={{ marginTop: '0.4rem' }}>
            {t(
              'Desde tu consola: get_team_chat (novedades/rechazos de QA) · list_dev_queue (tu cola) · generate_impl_plan (plan grounded) · submit_qa_review (entregar a QA) · post_team_chat (avisar al equipo).',
              'From your console: get_team_chat (updates/QA rejections) · list_dev_queue (your queue) · generate_impl_plan (grounded plan) · submit_qa_review (hand to QA) · post_team_chat (tell the team).',
            )}
          </p>
        )}
      </section>

      <section data-testid="team-presets">
        <h3 className={styles.sectionTitle}>{t('Configuración del equipo', 'Team configuration')}</h3>
        <p className={styles.hint}>
          {t(
            'Elegí una configuración según el esfuerzo del proyecto: setea modelos, presupuestos y qué agentes participan, con un click.',
            'Pick a configuration for the project effort: it sets models, budgets and which agents participate, in one click.',
          )}
        </p>
        <div style={{ overflowX: 'auto', margin: '0.6rem 0' }}>
          <table className={styles.runs} data-testid="preset-table">
            <thead>
              <tr>
                <th>{t('Rol', 'Role')}</th>
                {PRESET_IDS.map((id) => (
                  <th key={id}>{t(TEAM_PRESETS[id].name[0], TEAM_PRESETS[id].name[1])}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['SM', 'PO', 'ARCHITECT', 'DESIGN', 'DEV', 'QA', 'REVIEWER', 'MARKETING', 'RELEASE'] as const).map((role) => (
                <tr key={role}>
                  <td>{role}</td>
                  {PRESET_IDS.map((id) => {
                    const cfg = TEAM_PRESETS[id].roles[role];
                    return (
                      <td key={id}>
                        {cfg.enabled ? (
                          <>
                            <code>{cfg.llmModel.replace('claude-', '').replace('-20251001', '')}</code>{' '}
                            <span style={{ opacity: 0.6 }}>· {Math.round(cfg.tokenBudget / 1000)}k</span>
                          </>
                        ) : (
                          <span style={{ opacity: 0.45 }}>{t('apagado', 'off')}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td>{t('Costo aprox.', 'Approx. cost')}</td>
                {PRESET_IDS.map((id) => (
                  <td key={id}>{TEAM_PRESETS[id].costHint}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <div className={styles.cards}>
          {PRESET_IDS.map((id) => {
            const def = TEAM_PRESETS[id];
            const isActive = activePreset === id;
            return (
              <div key={id} className={styles.card} data-testid={`preset-${id}`}>
                <div className={styles.cardTop}>
                  <span className={styles.name}>{t(def.name[0], def.name[1])}</span>
                  {isActive && <Badge tone="ok">{t('activa', 'active')}</Badge>}
                </div>
                <p className={styles.hint}>{t(def.tagline[0], def.tagline[1])}</p>
                <p className={styles.hint}>
                  <strong>{t('Ideal para:', 'Ideal for:')}</strong>
                </p>
                <ul className={styles.hint} style={{ margin: '0 0 0.5rem', paddingLeft: '1.1rem' }}>
                  {def.examples.map((ex, i) => (
                    <li key={i}>{t(ex[0], ex[1])}</li>
                  ))}
                </ul>
                {canManage && (
                  <Button
                    size="sm"
                    variant={isActive ? 'secondary' : 'primary'}
                    disabled={busy === `preset:${id}` || isActive}
                    data-testid={`apply-preset-${id}`}
                    onClick={() => void applyPreset(id)}
                  >
                    {busy === `preset:${id}`
                      ? t('Aplicando…', 'Applying…')
                      : isActive
                        ? t('Configuración activa', 'Active configuration')
                        : t('Usar esta configuración', 'Use this configuration')}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        {presetMinted.length > 0 && (
          <div className={styles.tokenBox} data-testid="preset-minted-tokens">
            <p>
              {t(
                'Tokens de los agentes nuevos (se muestran UNA sola vez — configúralos en el worker axon-agents):',
                'New agent tokens (shown ONCE — set them on the axon-agents worker):',
              )}
            </p>
            {presetMinted.map((m) => (
              <p key={m.role} style={{ margin: '0.2rem 0' }}>
                <strong>AGENT_{m.role}_TOKEN</strong>: <code>{m.token}</code>
              </p>
            ))}
            <Button size="sm" variant="secondary" onClick={() => setPresetMinted([])}>
              {t('Entendido, los guardé', 'Got it, saved')}
            </Button>
          </div>
        )}
      </section>

      <section>
        <h3 className={styles.sectionTitle}>{t('Equipo', 'Team')}</h3>
        <div className={styles.cards}>
          {agents.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              canManage={canManage}
              busy={busy}
              onToggle={() => void toggle(a)}
              onSave={(m, b, n) => void saveConfig(a, m, b, n)}
              t={t}
            />
          ))}
          {canManage &&
            missing.map((role) => (
              <div key={role} className={styles.card}>
                <div className={styles.cardTop}>
                  <span className={styles.name}>{role}</span>
                  <Badge tone="neutral">{t('sin aprovisionar', 'not provisioned')}</Badge>
                </div>
                <p className={styles.hint}>
                  {t('Modelo por defecto:', 'Default model:')} <code>{DEFAULT_MODEL[role]}</code>
                </p>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy === `prov:${role}`}
                  data-testid={`provision-${role}`}
                  onClick={() => void provision(role)}
                >
                  {busy === `prov:${role}` ? t('Creando…', 'Creating…') : t('Aprovisionar', 'Provision')}
                </Button>
              </div>
            ))}
        </div>
      </section>

      {initialStats && initialStats.byRole.length > 0 && (
        <section data-testid="agent-stats">
          <h3 className={styles.sectionTitle}>{t('Salud y costo', 'Health & cost')}</h3>
          <div className={styles.cards}>
            {initialStats.byRole.map((s) => (
              <div key={s.role} className={styles.card}>
                <div className={styles.cardTop}>
                  <span className={styles.name}>{s.role}</span>
                  <Badge tone={s.total > 0 && s.succeeded / s.total >= 0.8 ? 'ok' : 'warn'}>
                    {s.total > 0 ? `${Math.round((s.succeeded / s.total) * 100)}%` : '—'}
                  </Badge>
                </div>
                <p className={styles.hint}>
                  {s.succeeded}/{s.total} {t('exitosas', 'succeeded')}
                  {s.budgetExceeded > 0 && ` · ${s.budgetExceeded} ${t('cortes de presupuesto', 'budget cuts')}`}
                  {s.failed > 0 && ` · ${s.failed} ${t('fallidas', 'failed')}`}
                </p>
                <p className={styles.hint}>
                  {(s.promptTokens + s.completionTokens).toLocaleString()} tokens · ${s.costUsd} USD
                </p>
              </div>
            ))}
            <div className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.name}>{t('Proyecto', 'Project')}</span>
              </div>
              <p className={styles.hint}>
                {t('Costo total:', 'Total cost:')} ${initialStats.totalCostUsd} USD
              </p>
              <p className={styles.hint}>
                {t('HUs devueltas por QA:', 'Stories rejected by QA:')} {initialStats.qaRejections}
              </p>
            </div>
          </div>
        </section>
      )}

      <section>
        <h3 className={styles.sectionTitle}>{t('Corridas recientes', 'Recent runs')}</h3>
        {initialRuns.length === 0 ? (
          <p className={styles.hint}>{t('Aún no hay corridas.', 'No runs yet.')}</p>
        ) : (
          <table className={styles.runs}>
            <thead>
              <tr>
                <th>{t('Rol', 'Role')}</th>
                <th>HU</th>
                <th>{t('Estado', 'Status')}</th>
                <th>Tokens</th>
                <th>USD</th>
                <th>{t('Inicio', 'Started')}</th>
              </tr>
            </thead>
            <tbody>
              {initialRuns.map((r) => (
                <tr key={r.id}>
                  <td>{r.role}</td>
                  <td>{r.storyNumber ? `#${r.storyNumber}` : '—'}</td>
                  <td>
                    <Badge tone={r.status === 'SUCCEEDED' ? 'ok' : r.status === 'RUNNING' ? 'neutral' : 'bad'}>
                      {r.status}
                    </Badge>
                  </td>
                  <td>{r.promptTokens + r.completionTokens}</td>
                  <td>{r.costUsd}</td>
                  <td>{new Date(r.startedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function AgentCard({
  agent,
  canManage,
  busy,
  onToggle,
  onSave,
  t,
}: {
  agent: AgentView;
  canManage: boolean;
  busy: string | null;
  onToggle: () => void;
  onSave: (llmModel: string, tokenBudget: number, name: string) => void;
  t: <T>(es: T, en: T) => T;
}) {
  const [model, setModel] = useState(agent.llmModel);
  const [budget, setBudget] = useState(String(agent.tokenBudget));
  const [name, setName] = useState(agent.name);

  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <span className={styles.name}>{agent.displayName}</span>
        <Badge tone={agent.enabled ? 'ok' : 'neutral'} dot>
          {agent.enabled ? t('Activo', 'Enabled') : t('Apagado', 'Disabled')}
        </Badge>
      </div>
      <p className={styles.hint}>
        {t('Token:', 'Token:')} <code>{agent.tokenPrefix ?? '—'}…</code>
      </p>
      {canManage ? (
        <>
          <label className={styles.field}>
            <span>{t('Nombre propio', 'Given name')}</span>
            <input
              className={styles.input}
              value={name}
              aria-label={`name-${agent.role}`}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>{t('Modelo LLM', 'LLM model')}</span>
            <input
              className={styles.input}
              value={model}
              aria-label={`model-${agent.role}`}
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>{t('Presupuesto (tokens/corrida)', 'Budget (tokens/run)')}</span>
            <input
              className={styles.input}
              type="number"
              value={budget}
              aria-label={`budget-${agent.role}`}
              onChange={(e) => setBudget(e.target.value)}
            />
          </label>
          <div className={styles.rowActions}>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy === `save:${agent.id}`}
              onClick={() => onSave(model, Number(budget), name)}
            >
              {t('Guardar', 'Save')}
            </Button>
            <Button
              size="sm"
              variant={agent.enabled ? 'danger' : 'primary'}
              disabled={busy === `toggle:${agent.id}`}
              data-testid={`toggle-${agent.role}`}
              onClick={onToggle}
            >
              {agent.enabled ? t('Apagar', 'Disable') : t('Activar', 'Enable')}
            </Button>
          </div>
        </>
      ) : (
        <p className={styles.hint}>
          {agent.llmModel} · {agent.tokenBudget.toLocaleString()} tokens
        </p>
      )}
    </div>
  );
}
