'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge, Button, EmptyState, Modal } from '@/components/ui';
import { useI18n } from '@/lib/i18n/i18n';
import {
  getConnectOptionsAction,
  connectDeployTargetAction,
  setEnvironmentClassAction,
  deployRepoAction,
  lifecycleAction,
  getRollbackTargetsAction,
  rollbackDeploymentAction,
  getDeployEnvKeysAction,
  setDeployEnvAction,
  getDeploymentLogsAction,
  getDbCatalogAction,
  provisionDatabaseAction,
  getDbCredentialsAction,
  listImportableAppsAction,
  linkExistingAppAction,
  deleteDeploymentAction,
  refreshDeploymentsAction,
  getGovernanceAction,
  type DeployView,
  type DeploymentView,
  type DeployRepoView,
  type ConnectOption,
} from '@/lib/actions/deploy';
import type { DbEngine, FusionDbCatalogEntry, FusionDbCredentials, FusionPolicy } from '@/lib/deploy/fusion-client';
import { SignalLine, type SignalState } from '@/components/SignalLine';
import styles from './deploy.module.scss';

type Tr = <T>(es: T, en: T) => T;
type Result<T> = { ok: true; data?: T } | { ok: false; error: string };

const ACTIVE = new Set<DeploymentView['status']>(['PENDING', 'BUILDING']);

// Map a deployment status to the SignalLine signature state.
function railState(status: DeploymentView['status']): SignalState {
  if (status === 'LIVE') return 'live';
  if (status === 'FAILED') return 'failed';
  if (status === 'BUILDING' || status === 'PENDING') return 'active';
  return 'idle';
}

// Human label for a deploy phase (the honest progress signal).
const PHASE_LABELS: Record<string, [string, string]> = {
  queued: ['En cola', 'Queued'],
  login: ['Autenticando registro', 'Authenticating registry'],
  pulling: ['Descargando imagen', 'Pulling image'],
  building: ['Construyendo imagen', 'Building image'],
  publishing: ['Publicando imagen', 'Publishing image'],
  pruning: ['Limpiando', 'Pruning'],
  starting: ['Arrancando contenedor', 'Starting container'],
  stopping: ['Deteniendo', 'Stopping'],
  removing: ['Eliminando', 'Removing'],
  running: ['Ejecutando', 'Running'],
  done: ['Listo', 'Done'],
  failed: ['Falló', 'Failed'],
  cancelled: ['Cancelado', 'Cancelled'],
};
function phaseLabel(phase: string | undefined, t: Tr): string {
  const [es, en] = PHASE_LABELS[phase ?? 'queued'] ?? ['Procesando', 'Working'];
  return t(es, en);
}

export function DeployClient({ slug, initial }: { slug: string; initial: DeployView }) {
  const { t } = useI18n();
  const [view, setView] = useState<DeployView>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Clase del ambiente a conectar: en PROD fusion-infra activa backups diarios
  // automáticos de las bases de datos del proyecto.
  const [envClass, setEnvClass] = useState<'DEV' | 'QA' | 'PROD'>('PROD');
  const [connectOptions, setConnectOptions] = useState<ConnectOption | null>(null);

  // Run an action that resolves to a fresh DeployView, surfacing errors inline.
  function apply(key: string, p: Promise<Result<DeployView>>) {
    setBusy(key);
    setError(null);
    return p
      .then((r) => {
        if (!r.ok) setError(r.error);
        else if (r.data) setView(r.data);
        return r;
      })
      .finally(() => setBusy(null));
  }

  // ---- polling: while any deployment is PENDING/BUILDING, refresh every ~5s ----
  const statusKey = view.deployments.map((d) => `${d.id}:${d.status}`).join('|');
  const hasActive = view.deployments.some((d) => ACTIVE.has(d.status));
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!hasActive) return;
    pollRef.current = setTimeout(async () => {
      const r = await refreshDeploymentsAction(slug);
      if (r.ok && r.data) setView(r.data);
    }, 5000);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [hasActive, statusKey, slug]);

  // ---- not configured ----
  if (!view.configured) {
    return (
      <EmptyState
        title={t('Despliegue no configurado', 'Deployment not configured')}
        hint={t(
          'Esta instancia de Axon no tiene fusion-infra conectada. Define FUSION_INFRA_URL y FUSION_INFRA_TOKEN para habilitar el despliegue.',
          'This Axon instance has no fusion-infra connected. Set FUSION_INFRA_URL and FUSION_INFRA_TOKEN to enable deployment.',
        )}
      />
    );
  }

  // ---- not connected ----
  async function startConnect() {
    setBusy('connect-options');
    setError(null);
    const r = await getConnectOptionsAction(slug);
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const servers = r.data?.servers ?? [];
    if (servers.length > 1) {
      setConnectOptions(r.data!);
      return;
    }
    void apply(
      'connect',
      connectDeployTargetAction(slug, servers.length === 1 ? { serverId: servers[0]!.id, envClass } : { envClass }),
    );
  }

  if (!view.connected) {
    return (
      <div className={styles.section}>
        <div className={styles.card}>
          <h3 className={styles.sectionTitle}>{t('Conectar a infraestructura', 'Connect to infrastructure')}</h3>
          <p className={styles.reason}>
            {t(
              'Crea el proyecto y el entorno en fusion-infra para empezar a desplegar los repos.',
              'Create the project and environment on fusion-infra to start deploying the repos.',
            )}
          </p>

          <div className={styles.rowActions} data-testid="env-class-selector">
            <span className={styles.reason}>{t('Clase de ambiente:', 'Environment class:')}</span>
            {(['DEV', 'QA', 'PROD'] as const).map((cls) => (
              <Button
                key={cls}
                size="sm"
                variant={envClass === cls ? 'primary' : 'ghost'}
                data-testid={`env-class-${cls}`}
                onClick={() => setEnvClass(cls)}
              >
                {cls === 'DEV' ? t('Desarrollo', 'Dev') : cls === 'QA' ? 'QA' : t('Producción', 'Production')}
              </Button>
            ))}
          </div>
          <p className={styles.reason}>
            {envClass === 'PROD'
              ? t('Producción: las bases de datos se respaldan automáticamente cada día.', 'Production: databases are backed up automatically every day.')
              : t('Dev/QA: sin backups automáticos (datos desechables).', 'Dev/QA: no automatic backups (disposable data).')}
          </p>

          {connectOptions ? (
            <div className={styles.grid}>
              <p className={styles.reason}>{t('Elige un servidor de destino:', 'Choose a target server:')}</p>
              {connectOptions.servers.map((s) => (
                <div key={s.id} className={styles.cardTop}>
                  <span className={styles.name}>{s.name}</span>
                  <Badge tone={s.agentStatus === 'ONLINE' ? 'ok' : 'neutral'}>{s.agentStatus}</Badge>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy === 'connect'}
                    onClick={() => void apply('connect', connectDeployTargetAction(slug, { serverId: s.id, envClass }))}
                  >
                    {t('Usar este servidor', 'Use this server')}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.rowActions}>
              <Button
                variant="primary"
                disabled={busy === 'connect-options' || busy === 'connect'}
                onClick={() => void startConnect()}
              >
                {busy ? t('Conectando…', 'Connecting…') : t('Conectar', 'Connect')}
              </Button>
            </div>
          )}

          {error && <p className={styles.error}>{error}</p>}
        </div>
      </div>
    );
  }

  // ---- connected ----
  const deployments = view.deployments;
  const byRepo = new Map(deployments.filter((d) => d.repoId).map((d) => [d.repoId!, d]));
  const looseDeployments = deployments.filter((d) => !d.repoId);

  return (
    <div className={styles.page}>
      {error && <p className={styles.error}>{error}</p>}

      {/* ---- Binding header (hero): project ──signal──▶ infrastructure ---- */}
      <section className={styles.section}>
        <div className={styles.binding}>
          <div className={styles.node}>
            <span className={styles.lbl}>{t('Proyecto', 'Project')}</span>
            <span className={styles.nodeName}>{slug}</span>
            <span className={styles.nodeSub}>
              {view.repos.length} {t('repos', 'repos')}
            </span>
          </div>
          <div className={styles.bindLink}>
            <SignalLine state="live" className={styles.bindSignal} />
            <span className={styles.bindArrow} aria-hidden>
              ▶
            </span>
          </div>
          <div className={styles.node}>
            <span className={styles.lbl}>fusion-infra</span>
            <span className={styles.nodeName}>{t('producción', 'production')}</span>
            <span className={styles.nodeSub}>{view.target?.serverId}</span>
          </div>
        </div>
      </section>

      {/* ---- Repos ---- */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>{t('Repositorios', 'Repositories')}</h3>
          <SignalLine className={styles.headRule} />
          <Button
            variant="ghost"
            size="sm"
            disabled={busy === 'refresh'}
            onClick={() => void apply('refresh', refreshDeploymentsAction(slug))}
          >
            {t('Actualizar', 'Refresh')}
          </Button>
        </div>
        {view.repos.length === 0 && (
          <p className={styles.reason}>
            {t('Vincula repos en la pestaña Plan para poder desplegarlos.', 'Link repos on the Plan tab to deploy them.')}
          </p>
        )}
        <div className={styles.grid}>
          {view.repos.map((repo) => {
            const dep = byRepo.get(repo.id);
            return dep ? (
              <DeploymentCard key={repo.id} slug={slug} dep={dep} busy={busy} apply={apply} setError={setError} t={t} />
            ) : (
              <RepoCard key={repo.id} slug={slug} repo={repo} busy={busy} apply={apply} t={t} />
            );
          })}
        </div>
      </section>

      {/* ---- Other deployments (databases / imported apps without a repo) ---- */}
      {looseDeployments.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t('Otros despliegues', 'Other deployments')}</h3>
          <div className={styles.grid}>
            {looseDeployments.map((dep) => (
              <DeploymentCard key={dep.id} slug={slug} dep={dep} busy={busy} apply={apply} setError={setError} t={t} />
            ))}
          </div>
        </section>
      )}

      {/* ---- Import existing ---- */}
      <ImportSection slug={slug} repos={view.repos} busy={busy} apply={apply} setError={setError} t={t} />

      {/* ---- Databases ---- */}
      <DatabaseSection slug={slug} busy={busy} apply={apply} setError={setError} t={t} />

      {/* ---- Governance ---- */}
      <GovernancePanel slug={slug} t={t} />
    </div>
  );
}

// ---- governance info panel ----
function GovernancePanel({ slug, t }: { slug: string; t: Tr }) {
  const [policies, setPolicies] = useState<FusionPolicy[] | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    if (loading) return;
    setLoading(true);
    void getGovernanceAction(slug).then((r) => {
      setLoading(false);
      if (!r.ok) { setErr(r.error); return; }
      setPolicies((r.data ?? []).map((s) => s.policy).filter((p): p is FusionPolicy => !!p));
    });
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && policies === null) load();
  }

  const active = policies?.filter((p) =>
    p.requireApproval || p.qualityChecks.length > 0 || p.deployerRole !== 'MEMBER' || p.maxMemoryMb || p.maxCpuPercent,
  ) ?? [];

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{t('Gobernanza', 'Governance')}</h3>
        <button
          type="button"
          className={styles.miniBtn}
          onClick={toggle}
        >
          {open ? t('Ocultar', 'Hide') : t('Ver políticas', 'View policies')}
        </button>
      </div>

      {open && (
        loading ? (
          <p className={styles.reason}>{t('Cargando…', 'Loading…')}</p>
        ) : err ? (
          <p className={styles.error}>{err}</p>
        ) : !policies?.length ? (
          <p className={styles.reason}>
            {t(
              'Sin políticas configuradas — todos los deploys siguen el flujo estándar.',
              'No policies configured — all deploys follow the standard flow.',
            )}
          </p>
        ) : (
          <div className={styles.grid}>
            {policies.map((p) => (
              <div key={p.environmentId} className={styles.card}>
                <div className={styles.cardTop}>
                  <span className={styles.name}>
                    {t('Environment', 'Environment')}: {p.environmentId.slice(-8)}
                  </span>
                  {active.some((a) => a.environmentId === p.environmentId) && (
                    <Badge tone="warn">{t('política activa', 'policy active')}</Badge>
                  )}
                </div>

                <div className={styles.reason} style={{ fontSize: '0.78rem', lineHeight: 1.7 }}>
                  {p.requireApproval && (
                    <div>⏸ {t('Requiere aprobación antes de deploy', 'Requires approval before deploy')}</div>
                  )}
                  <div>👤 {t('Rol mínimo para deploy', 'Min role to deploy')}: <strong>{p.deployerRole}</strong></div>
                  <div>🗄 {t('Retención de builds', 'Build retention')}: <strong>{p.retentionBuilds}</strong></div>
                  {p.maxMemoryMb && (
                    <div>💾 {t('Memoria máx', 'Max memory')}: <strong>{p.maxMemoryMb} MB</strong> ({t('advisory', 'advisory')})</div>
                  )}
                  {p.maxCpuPercent && (
                    <div>⚙ {t('CPU máx', 'Max CPU')}: <strong>{p.maxCpuPercent}%</strong> ({t('advisory', 'advisory')})</div>
                  )}
                  {p.qualityChecks.length > 0 && (
                    <div>
                      🧪 {t('Checks de calidad', 'Quality checks')}:
                      {p.qualityChecks.map((c) => (
                        <span key={c.name} style={{ marginLeft: 6, opacity: 0.8 }}>
                          {c.name} ({c.image})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </section>
  );
}

// ---- status badge ----
function StatusBadge({ status, t }: { status: DeploymentView['status']; t: Tr }) {
  switch (status) {
    case 'LIVE':
      return <Badge tone="ok" dot>{t('Activo', 'Live')}</Badge>;
    case 'BUILDING':
      return (
        <Badge tone="warn">
          <span className={styles.spinner} aria-hidden /> {t('Construyendo…', 'Building…')}
        </Badge>
      );
    case 'STOPPED':
      return <Badge tone="neutral">{t('Detenido', 'Stopped')}</Badge>;
    case 'FAILED':
      return <Badge tone="bad">{t('Falló', 'Failed')}</Badge>;
    default:
      return <Badge tone="neutral">{t('Pendiente', 'Pending')}</Badge>;
  }
}

// ---- repo card with a deploy form ----
function RepoCard({
  slug,
  repo,
  busy,
  apply,
  t,
}: {
  slug: string;
  repo: DeployRepoView;
  busy: string | null;
  apply: (key: string, p: Promise<Result<DeployView>>) => Promise<unknown>;
  t: Tr;
}) {
  const [open, setOpen] = useState(false);
  const [port, setPort] = useState('');
  const [dockerfile, setDockerfile] = useState('Dockerfile');

  const key = `deploy:${repo.id}`;
  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <span className={styles.name}>{repo.name}</span>
        <Badge tone="neutral">{repo.kind}</Badge>
      </div>
      {!repo.url && (
        <p className={styles.reason}>{t('Sin URL de GitHub para desplegar.', 'No GitHub URL to deploy.')}</p>
      )}
      {open ? (
        <div className={styles.form}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('Puerto expuesto', 'Exposed port')}</span>
            <input
              className={styles.input}
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="3000"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('Ruta del Dockerfile', 'Dockerfile path')}</span>
            <input
              className={styles.input}
              value={dockerfile}
              onChange={(e) => setDockerfile(e.target.value)}
            />
          </label>
          <div className={styles.rowActions}>
            <Button
              variant="primary"
              size="sm"
              disabled={busy === key || !port.trim() || !repo.url}
              onClick={() =>
                void apply(
                  key,
                  deployRepoAction(slug, repo.id, {
                    exposedPort: Number(port),
                    dockerfilePath: dockerfile.trim() || 'Dockerfile',
                  }),
                ).then((r) => {
                  if ((r as Result<DeployView>).ok) setOpen(false);
                })
              }
            >
              {busy === key ? t('Desplegando…', 'Deploying…') : t('Desplegar', 'Deploy')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              {t('Cancelar', 'Cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.rowActions}>
          <Button variant="primary" size="sm" disabled={!repo.url} onClick={() => setOpen(true)}>
            {t('Desplegar', 'Deploy')}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---- deployment card with lifecycle controls + modals ----
type ModalKind = null | 'rollback' | 'env' | 'logs' | 'creds' | 'delete';

function DeploymentCard({
  slug,
  dep,
  busy,
  apply,
  setError,
  t,
}: {
  slug: string;
  dep: DeploymentView;
  busy: string | null;
  apply: (key: string, p: Promise<Result<DeployView>>) => Promise<unknown>;
  setError: (e: string | null) => void;
  t: Tr;
}) {
  const [modal, setModal] = useState<ModalKind>(null);
  const k = (op: string) => `${op}:${dep.id}`;
  const isDb = dep.kind === 'DATABASE';

  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <span className={styles.name}>{dep.name}</span>
        <StatusBadge status={dep.status} t={t} />
        {isDb && <Badge tone="accent">DB</Badge>}
        {dep.imported && <Badge tone="neutral">{t('importado', 'imported')}</Badge>}
      </div>
      {dep.url && (
        <a className={styles.link} href={dep.url} target="_blank" rel="noreferrer">
          {dep.url}
        </a>
      )}
      {dep.status === 'FAILED' && dep.error && <p className={styles.error}>{dep.error}</p>}

      {dep.status === 'BUILDING' || dep.status === 'PENDING' ? (
        <div className={styles.progress}>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuenow={dep.progress?.percent ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('Progreso del despliegue', 'Deployment progress')}
          >
            <div className={styles.progressFill} style={{ width: `${dep.progress?.percent ?? 6}%` }} />
          </div>
          <p className={styles.progressMeta}>
            {phaseLabel(dep.progress?.phase, t)}
            {dep.progress ? ` · ${dep.progress.percent}%` : ''}
            {dep.progress?.lastLine ? ` · ${dep.progress.lastLine.slice(0, 80)}` : ''}
          </p>
        </div>
      ) : (
        <div className={styles.rail}>
          <SignalLine state={railState(dep.status)} />
        </div>
      )}

      <div className={styles.rowActions}>
        {dep.repoId && (
          <button
            type="button"
            className={styles.miniBtn}
            disabled={!!busy}
            onClick={() =>
              void apply(k('redeploy'), deployRepoAction(slug, dep.repoId!, { exposedPort: dep.exposedPort ?? 3000 }))
            }
          >
            {busy === k('redeploy') ? t('Redesplegando…', 'Redeploying…') : t('Redesplegar', 'Redeploy')}
          </button>
        )}
        {dep.status === 'STOPPED' ? (
          <button
            type="button"
            className={styles.miniBtn}
            disabled={!!busy}
            onClick={() => void apply(k('start'), lifecycleAction(slug, dep.id, 'start'))}
          >
            {t('Iniciar', 'Start')}
          </button>
        ) : (
          <button
            type="button"
            className={styles.miniBtn}
            disabled={!!busy}
            onClick={() => void apply(k('stop'), lifecycleAction(slug, dep.id, 'stop'))}
          >
            {t('Detener', 'Stop')}
          </button>
        )}
        <button
          type="button"
          className={styles.miniBtn}
          disabled={!!busy}
          onClick={() => {
            if (confirm(t('¿Recrear este despliegue?', 'Recreate this deployment?')))
              void apply(k('recreate'), lifecycleAction(slug, dep.id, 'recreate'));
          }}
        >
          {t('Recrear', 'Recreate')}
        </button>
        <button type="button" className={styles.miniBtn} onClick={() => setModal('rollback')}>
          {t('Revertir', 'Rollback')}
        </button>
        <button type="button" className={styles.miniBtn} onClick={() => setModal('env')}>
          {t('Variables', 'Env')}
        </button>
        <button type="button" className={styles.miniBtn} onClick={() => setModal('logs')}>
          {t('Logs', 'Logs')}
        </button>
        {isDb && (
          <button type="button" className={styles.miniBtn} onClick={() => setModal('creds')}>
            {t('Credenciales', 'Credentials')}
          </button>
        )}
        <button
          type="button"
          className={`${styles.miniBtn} ${styles.miniDanger}`}
          onClick={() => setModal('delete')}
        >
          {t('Eliminar', 'Delete')}
        </button>
      </div>

      {modal === 'rollback' && (
        <RollbackModal slug={slug} dep={dep} apply={apply} setError={setError} onClose={() => setModal(null)} t={t} />
      )}
      {modal === 'env' && (
        <EnvModal slug={slug} dep={dep} apply={apply} setError={setError} onClose={() => setModal(null)} t={t} />
      )}
      {modal === 'logs' && <LogsModal slug={slug} dep={dep} setError={setError} onClose={() => setModal(null)} t={t} />}
      {modal === 'creds' && (
        <CredsModal slug={slug} dep={dep} setError={setError} onClose={() => setModal(null)} t={t} />
      )}
      {modal === 'delete' && (
        <DeleteModal slug={slug} dep={dep} apply={apply} onClose={() => setModal(null)} t={t} />
      )}
    </div>
  );
}

// ---- rollback ----
function RollbackModal({
  slug,
  dep,
  apply,
  setError,
  onClose,
  t,
}: {
  slug: string;
  dep: DeploymentView;
  apply: (key: string, p: Promise<Result<DeployView>>) => Promise<unknown>;
  setError: (e: string | null) => void;
  onClose: () => void;
  t: Tr;
}) {
  const [targets, setTargets] = useState<Array<{ id: string; status: string; operation: string }> | null>(null);

  useEffect(() => {
    void getRollbackTargetsAction(slug, dep.id).then((r) => {
      if (r.ok && r.data) setTargets(r.data);
      else if (!r.ok) setError(r.error);
    });
  }, [slug, dep.id, setError]);

  return (
    <Modal open onClose={onClose} title={t('Revertir despliegue', 'Roll back deployment')}>
      {!targets ? (
        <p className={styles.reason}>{t('Cargando historial…', 'Loading history…')}</p>
      ) : targets.length === 0 ? (
        <p className={styles.reason}>{t('No hay versiones anteriores.', 'No previous versions.')}</p>
      ) : (
        <div className={styles.grid}>
          {targets.map((d) => (
            <div key={d.id} className={styles.cardTop}>
              <span className={styles.name}>{d.id.slice(0, 8)}</span>
              <Badge tone="neutral">{d.status}</Badge>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  void apply(`rollback:${dep.id}`, rollbackDeploymentAction(slug, dep.id, d.id)).then(() => onClose());
                }}
              >
                {t('Revertir a esta', 'Roll back to this')}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ---- env editor ----
function EnvModal({
  slug,
  dep,
  apply,
  setError,
  onClose,
  t,
}: {
  slug: string;
  dep: DeploymentView;
  apply: (key: string, p: Promise<Result<DeployView>>) => Promise<unknown>;
  setError: (e: string | null) => void;
  onClose: () => void;
  t: Tr;
}) {
  const [keys, setKeys] = useState<string[] | null>(null);
  const [unset, setUnset] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Array<{ key: string; value: string }>>([{ key: '', value: '' }]);

  useEffect(() => {
    void getDeployEnvKeysAction(slug, dep.id).then((r) => {
      if (r.ok && r.data) setKeys(r.data);
      else if (!r.ok) setError(r.error);
    });
  }, [slug, dep.id, setError]);

  function toggleUnset(key: string) {
    setUnset((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function save() {
    const set: Record<string, string> = {};
    for (const r of rows) if (r.key.trim()) set[r.key.trim()] = r.value;
    void apply(`env:${dep.id}`, setDeployEnvAction(slug, dep.id, {
      set: Object.keys(set).length ? set : undefined,
      unset: unset.size ? [...unset] : undefined,
    })).then(() => onClose());
  }

  return (
    <Modal open onClose={onClose} title={t('Variables de entorno', 'Environment variables')}>
      {!keys ? (
        <p className={styles.reason}>{t('Cargando…', 'Loading…')}</p>
      ) : (
        <>
          {keys.length === 0 ? (
            <p className={styles.reason}>{t('Sin variables definidas.', 'No variables set.')}</p>
          ) : (
            <ul className={styles.keyList}>
              {keys.map((key) => (
                <li key={key}>
                  <label className={styles.checkbox}>
                    <input type="checkbox" checked={unset.has(key)} onChange={() => toggleUnset(key)} />
                    <code>{key}</code>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.fieldLabel}>{t('Añadir / actualizar', 'Add / update')}</p>
          {rows.map((row, i) => (
            <div key={i} className={styles.envRow}>
              <input
                className={styles.input}
                placeholder="KEY"
                value={row.key}
                aria-label={`env-key-${i}`}
                onChange={(e) =>
                  setRows((rs) => rs.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))
                }
              />
              <input
                className={styles.input}
                placeholder="VALUE"
                value={row.value}
                aria-label={`env-value-${i}`}
                onChange={(e) =>
                  setRows((rs) => rs.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
                }
              />
            </div>
          ))}
          <div className={styles.modalActions}>
            <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, { key: '', value: '' }])}>
              {t('+ Fila', '+ Row')}
            </Button>
            <Button variant="primary" size="sm" onClick={save}>
              {t('Guardar y redesplegar', 'Save & redeploy')}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---- logs ----
function LogsModal({
  slug,
  dep,
  setError,
  onClose,
  t,
}: {
  slug: string;
  dep: DeploymentView;
  setError: (e: string | null) => void;
  onClose: () => void;
  t: Tr;
}) {
  const [data, setData] = useState<{ status: string; lines: Array<{ seq: number; stream: string; text: string }> } | null>(null);

  useEffect(() => {
    void getDeploymentLogsAction(slug, dep.id).then((r) => {
      if (r.ok && r.data) setData(r.data);
      else if (!r.ok) setError(r.error);
    });
  }, [slug, dep.id, setError]);

  return (
    <Modal open onClose={onClose} title={t('Logs del despliegue', 'Deployment logs')}>
      {!data ? (
        <p className={styles.reason}>{t('Cargando logs…', 'Loading logs…')}</p>
      ) : data.lines.length === 0 ? (
        <p className={styles.reason}>{t('Sin logs todavía.', 'No logs yet.')}</p>
      ) : (
        <pre className={styles.logs}>
          {data.lines.map((l) => (
            <div key={l.seq} className={l.stream === 'stderr' ? styles.logErr : undefined}>
              {l.text}
            </div>
          ))}
        </pre>
      )}
    </Modal>
  );
}

// ---- db credentials ----
function CredsModal({
  slug,
  dep,
  setError,
  onClose,
  t,
}: {
  slug: string;
  dep: DeploymentView;
  setError: (e: string | null) => void;
  onClose: () => void;
  t: Tr;
}) {
  const [creds, setCreds] = useState<FusionDbCredentials | null>(null);

  useEffect(() => {
    void getDbCredentialsAction(slug, dep.id).then((r) => {
      if (r.ok && r.data) setCreds(r.data);
      else if (!r.ok) setError(r.error);
    });
  }, [slug, dep.id, setError]);

  function copy(value: string) {
    try {
      void navigator.clipboard?.writeText(value);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <Modal open onClose={onClose} title={t('Credenciales de la base de datos', 'Database credentials')}>
      {!creds ? (
        <p className={styles.reason}>{t('Cargando…', 'Loading…')}</p>
      ) : (
        <ul className={styles.creds}>
          {(
            [
              ['engine', creds.local.engine],
              ['host', creds.local.host],
              ['port', String(creds.local.port)],
              ['username', creds.local.username],
              ['password', creds.local.password],
              ['database', creds.local.database],
            ] as const
          ).map(([label, value]) => (
            <li key={label} className={styles.credRow}>
              <span className={styles.credKey}>{label}</span>
              <span className={styles.credVal}>{value}</span>
              <button
                type="button"
                className={styles.miniBtn}
                aria-label={`copy-${label}`}
                onClick={() => copy(value)}
              >
                {t('Copiar', 'Copy')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// ---- delete ----
function DeleteModal({
  slug,
  dep,
  apply,
  onClose,
  t,
}: {
  slug: string;
  dep: DeploymentView;
  apply: (key: string, p: Promise<Result<DeployView>>) => Promise<unknown>;
  onClose: () => void;
  t: Tr;
}) {
  const [destroy, setDestroy] = useState(false);

  return (
    <Modal open onClose={onClose} title={t('Eliminar despliegue', 'Delete deployment')}>
      <p className={styles.reason}>
        {t('Se quitará el vínculo de este despliegue del proyecto.', 'This will unlink the deployment from the project.')}
      </p>
      <label className={styles.checkbox}>
        <input type="checkbox" checked={destroy} onChange={(e) => setDestroy(e.target.checked)} />
        {t('También destruir en fusion-infra', 'Also destroy on fusion-infra')}
      </label>
      <div className={styles.modalActions}>
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('Cancelar', 'Cancel')}
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            void apply(`delete:${dep.id}`, deleteDeploymentAction(slug, dep.id, { destroy })).then(() => onClose());
          }}
        >
          {t('Eliminar', 'Delete')}
        </Button>
      </div>
    </Modal>
  );
}

// ---- import existing apps ----
function ImportSection({
  slug,
  repos,
  busy,
  apply,
  setError,
  t,
}: {
  slug: string;
  repos: DeployRepoView[];
  busy: string | null;
  apply: (key: string, p: Promise<Result<DeployView>>) => Promise<unknown>;
  setError: (e: string | null) => void;
  t: Tr;
}) {
  const [open, setOpen] = useState(false);
  const [apps, setApps] = useState<Array<{ id: string; name: string; kind: string; status: DeploymentView['status']; url: string | null }> | null>(null);
  const [repoFor, setRepoFor] = useState<Record<string, string>>({});

  async function load() {
    setOpen(true);
    setApps(null);
    const r = await listImportableAppsAction(slug);
    if (r.ok && r.data) setApps(r.data);
    else if (!r.ok) setError(r.error);
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{t('Importar app existente', 'Import existing app')}</h3>
        <SignalLine className={styles.headRule} />
        <Button variant="secondary" size="sm" disabled={busy === 'import-list'} onClick={() => void load()}>
          {open ? t('Recargar', 'Reload') : t('Buscar apps', 'Find apps')}
        </Button>
      </div>
      {open &&
        (!apps ? (
          <p className={styles.reason}>{t('Cargando…', 'Loading…')}</p>
        ) : apps.length === 0 ? (
          <p className={styles.reason}>{t('No hay apps sin vincular.', 'No unlinked apps.')}</p>
        ) : (
          <div className={styles.grid}>
            {apps.map((a) => (
              <div key={a.id} className={styles.importItem}>
                <div className={styles.cardTop}>
                  <span className={styles.name}>{a.name}</span>
                  <StatusBadge status={a.status} t={t} />
                  {a.url && (
                    <a className={styles.link} href={a.url} target="_blank" rel="noreferrer">
                      {a.url}
                    </a>
                  )}
                </div>
                <div className={styles.cardTop}>
                  <select
                    className={styles.select}
                    aria-label={`repo-for-${a.id}`}
                    value={repoFor[a.id] ?? ''}
                    onChange={(e) => setRepoFor((m) => ({ ...m, [a.id]: e.target.value }))}
                  >
                    <option value="">{t('(sin repo)', '(no repo)')}</option>
                    {repos.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!!busy}
                    onClick={() =>
                      void apply(
                        `link:${a.id}`,
                        linkExistingAppAction(slug, a.id, repoFor[a.id] ? { repoId: repoFor[a.id] } : {}),
                      )
                    }
                  >
                    {t('Vincular', 'Link')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ))}
    </section>
  );
}

// ---- databases ----
function DatabaseSection({
  slug,
  busy,
  apply,
  setError,
  t,
}: {
  slug: string;
  busy: string | null;
  apply: (key: string, p: Promise<Result<DeployView>>) => Promise<unknown>;
  setError: (e: string | null) => void;
  t: Tr;
}) {
  const [catalog, setCatalog] = useState<FusionDbCatalogEntry[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [engine, setEngine] = useState<DbEngine | ''>('');
  const [version, setVersion] = useState('');
  const [exposePublic, setExposePublic] = useState(false);

  async function load() {
    setOpen(true);
    const r = await getDbCatalogAction(slug);
    if (r.ok && r.data) {
      setCatalog(r.data);
      if (r.data[0]) {
        setEngine(r.data[0].engine);
        setVersion(r.data[0].versions[0] ?? '');
      }
    } else if (!r.ok) setError(r.error);
  }

  const entry = catalog?.find((c) => c.engine === engine);

  function submit() {
    if (!engine) return;
    void apply(
      'db-create',
      provisionDatabaseAction(slug, { name: name.trim(), engine, version, exposePublic }),
    ).then((r) => {
      if ((r as Result<DeployView>).ok) {
        setName('');
        setOpen(false);
      }
    });
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{t('Bases de datos', 'Databases')}</h3>
        <SignalLine className={styles.headRule} />
        <Button variant="secondary" size="sm" onClick={() => void load()}>
          {t('Aprovisionar base de datos', 'Provision database')}
        </Button>
      </div>
      {open && catalog && (
        <div className={styles.form}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('Nombre', 'Name')}</span>
            <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('Motor', 'Engine')}</span>
            <select
              className={styles.select}
              aria-label="db-engine"
              value={engine}
              onChange={(e) => {
                const eng = e.target.value as DbEngine;
                setEngine(eng);
                const c = catalog.find((x) => x.engine === eng);
                setVersion(c?.versions[0] ?? '');
              }}
            >
              {catalog.map((c) => (
                <option key={c.engine} value={c.engine}>
                  {c.engine}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('Versión', 'Version')}</span>
            <select
              className={styles.select}
              aria-label="db-version"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            >
              {(entry?.versions ?? []).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={exposePublic} onChange={(e) => setExposePublic(e.target.checked)} />
            {t('Exponer públicamente', 'Expose publicly')}
          </label>
          <div className={styles.modalActions}>
            <Button variant="primary" size="sm" disabled={!!busy || !name.trim() || !engine} onClick={submit}>
              {busy === 'db-create' ? t('Creando…', 'Creating…') : t('Crear', 'Create')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              {t('Cancelar', 'Cancel')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
