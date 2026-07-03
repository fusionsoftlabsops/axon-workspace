'use client';

import { useState } from 'react';
import { Badge, Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n/i18n';
import {
  provisionAgentAction,
  setAgentEnabledAction,
  updateAgentAction,
  type AgentRunView,
  type AgentView,
} from '@/lib/actions/agents';
import styles from './agents.module.scss';

const ROLES = ['SM', 'DEV', 'QA'] as const;
type Role = (typeof ROLES)[number];

const DEFAULT_MODEL: Record<Role, string> = {
  SM: 'claude-sonnet-4-6',
  DEV: 'qwen3-coder-next',
  QA: 'claude-sonnet-4-6',
};

export function AgentsClient({
  slug,
  canManage,
  initialAgents,
  initialRuns,
}: {
  slug: string;
  canManage: boolean;
  initialAgents: AgentView[];
  initialRuns: AgentRunView[];
}) {
  const { t } = useI18n();
  const [agents, setAgents] = useState<AgentView[]>(initialAgents);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Token recién acuñado: se muestra UNA vez (no se persiste en claro).
  const [mintedToken, setMintedToken] = useState<string | null>(null);

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

  async function saveConfig(agent: AgentView, llmModel: string, tokenBudget: number) {
    setBusy(`save:${agent.id}`);
    setError(null);
    const res = await updateAgentAction(slug, agent.id, { llmModel, tokenBudget });
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
              onSave={(m, b) => void saveConfig(a, m, b)}
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
  onSave: (llmModel: string, tokenBudget: number) => void;
  t: <T>(es: T, en: T) => T;
}) {
  const [model, setModel] = useState(agent.llmModel);
  const [budget, setBudget] = useState(String(agent.tokenBudget));

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
              onClick={() => onSave(model, Number(budget))}
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
