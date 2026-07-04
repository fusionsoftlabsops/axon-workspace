/**
 * Bootstrap del worker axon-agents.
 *
 * Modo pasivo (sin AGENTS_ENABLED o sin REDIS_URL): solo levanta /health y se
 * queda quieto — permite desplegar la app oscura en fusion-infra. Modo activo:
 * se suscribe al canal de eventos de dominio y despacha al router de roles.
 * Los handlers reales (SM/Dev/QA) se registran a medida que existen.
 */
import { loadConfig } from './config.js';
import { EventRouter } from './router.js';
import { buildTeam } from './bootstrap.js';
import { createRuntimeRegistry } from './runtime/registry.js';
import { subscribeToDomainEvents, type Subscription } from './subscribe.js';
import { createHealthServer, type HealthState } from './health.js';

const config = loadConfig();
const multiTenant = !!config.AGENT_RUNTIME_TOKEN;

const state: HealthState = {
  enabled: config.enabled,
  subscribed: false,
  eventsReceived: 0,
  eventsDispatched: 0,
  startedAt: new Date().toISOString(),
};

createHealthServer(state, config.PORT);

const router = new EventRouter();
const registry = multiTenant ? createRuntimeRegistry(config, router) : null;

if (registry) {
  // MULTI-TENANT: cargar todos los equipos y refrescar en intervalo.
  const refreshMs = config.AGENT_RUNTIME_REFRESH_SEC * 1000;
  const doRefresh = async (): Promise<void> => {
    try {
      const r = await registry.refresh();
      console.log(`[agents] multi-tenant: ${r.projects} proyectos, ${r.handlers} handlers — ${r.summary.join(' ')}`);
    } catch (e) {
      console.error('[agents] refresh de runtime falló:', e instanceof Error ? e.message : e);
    }
  };
  await doRefresh();
  setInterval(() => void doRefresh(), refreshMs);
  console.log(`[agents] refresco de runtime cada ${config.AGENT_RUNTIME_REFRESH_SEC}s`);
  if (config.enabled && config.STALE_SWEEP_MINUTES > 0) {
    setInterval(() => void registry.sweepAll(), config.STALE_SWEEP_MINUTES * 60_000);
    console.log(`[agents] sweep de estancadas (todos los proyectos) cada ${config.STALE_SWEEP_MINUTES} min`);
  }
} else {
  // LEGACY single-project.
  const team = buildTeam(config, router);
  console.log(`[agents] roles registrados: ${team.registered.join(', ') || '(ninguno)'}`);
  for (const s of team.skipped) console.log(`[agents] omitido ${s.role}: ${s.reason}`);

  if (config.enabled && team.staleSweep && config.STALE_SWEEP_MINUTES > 0) {
    const everyMs = config.STALE_SWEEP_MINUTES * 60_000;
    setInterval(() => {
      void team.staleSweep!.sweepOnce().catch((e) => console.error('[agents] stale sweep:', e));
    }, everyMs);
    console.log(`[agents] sweep de estancadas cada ${config.STALE_SWEEP_MINUTES} min`);
  }
}

let subscription: Subscription | null = null;

if (!config.enabled) {
  console.log('[agents] AGENTS_ENABLED off — worker en modo pasivo (solo /health)');
} else if (!config.REDIS_URL) {
  console.error('[agents] AGENTS_ENABLED on pero sin REDIS_URL — modo pasivo');
} else {
  // Hardening post-dogfooding: un Redis inaccesible (NOAUTH, caído, password
  // rotado) NO puede tumbar el worker en crash-loop — modo pasivo + reintento.
  const RETRY_MS = 60_000;
  const trySubscribe = async (): Promise<void> => {
    try {
      subscription = await subscribeToDomainEvents(config.REDIS_URL!, async (event) => {
        state.eventsReceived += 1;
        const results = await router.dispatch(event);
        state.eventsDispatched += results.length;
        if (results.length > 0) {
          console.log(
            `[agents] ${event.type} #${event.storyNumber ?? '?'} → ${results
              .map((r) => `${r.role}:${r.ok ? 'ok' : 'fail'}`)
              .join(', ')}`,
          );
        }
      });
      state.subscribed = true;
      console.log('[agents] suscripción activa');
    } catch (err) {
      state.subscribed = false;
      console.error(
        `[agents] suscripción falló (${err instanceof Error ? err.message : err}) — reintento en ${RETRY_MS / 1000}s`,
      );
      setTimeout(() => void trySubscribe(), RETRY_MS);
    }
  };
  await trySubscribe();
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[agents] ${signal} — cerrando`);
  if (subscription) await subscription.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Última línea de defensa: un error asíncrono huérfano (p.ej. del parser de
// redis) no tumba el worker — se loguea y el proceso sigue sirviendo /health.
process.on('unhandledRejection', (err) => {
  console.error('[agents] unhandledRejection:', err instanceof Error ? err.message : err);
});
process.on('uncaughtException', (err) => {
  console.error('[agents] uncaughtException:', err.message);
});
