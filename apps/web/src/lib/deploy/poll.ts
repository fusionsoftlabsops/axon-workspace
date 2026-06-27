/**
 * Background status polling for deployments. Mirrors the fire-and-forget pattern
 * of lib/analysis/run.ts: the Node process is long-lived (self-hosted), so after
 * a deploy is triggered we poll the control-plane until the deployment reaches a
 * terminal state, persisting the result on the local Deployment row. The UI polls
 * getDeployViewAction to reflect it (no websocket needed).
 */
import { prisma } from '@/lib/db';
import * as fusion from './fusion-client';

/** High-level display state derived from the control-plane's latestDeployment. */
export type DeployState = 'PENDING' | 'BUILDING' | 'LIVE' | 'STOPPED' | 'FAILED';

export function deriveState(
  latest: { operation: fusion.DeploymentOperation; status: fusion.DeploymentStatus } | null,
): DeployState {
  if (!latest) return 'PENDING';
  if (latest.status === 'QUEUED' || latest.status === 'IN_PROGRESS') return 'BUILDING';
  if (latest.status === 'FAILED' || latest.status === 'CANCELLED') return 'FAILED';
  // FINISHED
  if (latest.operation === 'STOP' || latest.operation === 'REMOVE') return 'STOPPED';
  return 'LIVE';
}

const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_TICKS = 240; // ~20 min ceiling

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll a single in-flight deployment until terminal, updating its local row
 * (status / hostname / error). Best-effort; swallows transient errors.
 */
export async function pollDeployment(deploymentRowId: string, teamId: string): Promise<void> {
  for (let tick = 0; tick < POLL_MAX_TICKS; tick++) {
    await sleep(POLL_INTERVAL_MS);
    const row = await prisma.deployment.findUnique({ where: { id: deploymentRowId } });
    if (!row || !row.lastDeploymentId) return;
    try {
      const dep = await fusion.getDeployment(row.lastDeploymentId, teamId);
      const terminal =
        dep.status === 'FINISHED' || dep.status === 'FAILED' || dep.status === 'CANCELLED';
      const app =
        terminal && dep.status === 'FINISHED'
          ? await fusion.getApp(row.fusionAppId, teamId).catch(() => null)
          : null;
      const state = deriveState({ operation: dep.operation, status: dep.status });
      await prisma.deployment.update({
        where: { id: deploymentRowId },
        data: {
          status: state,
          hostname: app?.hostname ?? row.hostname,
          error: dep.errorReason ?? (state === 'FAILED' ? row.error : null),
        },
      });
      if (terminal) return;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[deploy] poll failed:', err);
    }
  }
}

/** Fire-and-forget the poller (used by the actions after a lifecycle op). */
export function startPolling(deploymentRowId: string, teamId: string): void {
  void pollDeployment(deploymentRowId, teamId).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[deploy] poller crashed:', err);
  });
}
