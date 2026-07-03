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
import { subscribeToDomainEvents, type Subscription } from './subscribe.js';
import { createHealthServer, type HealthState } from './health.js';

const config = loadConfig();

const state: HealthState = {
  enabled: config.enabled,
  subscribed: false,
  eventsReceived: 0,
  eventsDispatched: 0,
  startedAt: new Date().toISOString(),
};

createHealthServer(state, config.PORT);

const router = new EventRouter();
const team = buildTeam(config, router);
console.log(`[agents] roles registrados: ${team.registered.join(', ') || '(ninguno)'}`);
for (const s of team.skipped) console.log(`[agents] omitido ${s.role}: ${s.reason}`);

// Sweep de estancadas del SM (tiempo, no eventos).
if (config.enabled && team.staleSweep && config.STALE_SWEEP_MINUTES > 0) {
  const everyMs = config.STALE_SWEEP_MINUTES * 60_000;
  setInterval(() => {
    void team.staleSweep!.sweepOnce().catch((e) => console.error('[agents] stale sweep:', e));
  }, everyMs);
  console.log(`[agents] sweep de estancadas cada ${config.STALE_SWEEP_MINUTES} min`);
}

let subscription: Subscription | null = null;

if (!config.enabled) {
  console.log('[agents] AGENTS_ENABLED off — worker en modo pasivo (solo /health)');
} else if (!config.REDIS_URL) {
  console.error('[agents] AGENTS_ENABLED on pero sin REDIS_URL — modo pasivo');
} else {
  subscription = await subscribeToDomainEvents(config.REDIS_URL, async (event) => {
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
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[agents] ${signal} — cerrando`);
  if (subscription) await subscription.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
