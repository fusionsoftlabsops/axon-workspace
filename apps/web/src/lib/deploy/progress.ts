/**
 * Derive a human deploy phase + a coarse percentage from a fusion-infra
 * deployment's status and its log step ids. The control-plane has no numeric
 * progress, but every build step carries a `stepId` (login → build → push →
 * prune → run, or a lifecycle step), so we map the furthest step reached to a
 * phase. The phase name is the honest signal; the percent is an indicator.
 */
export type ProgressPhase =
  | 'queued'
  | 'login'
  | 'pulling'
  | 'building'
  | 'publishing'
  | 'pruning'
  | 'starting'
  | 'stopping'
  | 'removing'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface DeployProgress {
  phase: ProgressPhase;
  percent: number;
  lastLine: string | null;
}

// stepId (first id passed to step() in the control-plane build-plan) → phase.
const STEP_PHASE: Record<string, { phase: ProgressPhase; percent: number }> = {
  login: { phase: 'login', percent: 12 },
  pull: { phase: 'pulling', percent: 40 },
  build: { phase: 'building', percent: 35 },
  push: { phase: 'publishing', percent: 78 },
  prune: { phase: 'pruning', percent: 88 },
  run: { phase: 'starting', percent: 94 },
  start: { phase: 'starting', percent: 60 },
  stop: { phase: 'stopping', percent: 60 },
  remove: { phase: 'removing', percent: 60 },
  script: { phase: 'running', percent: 50 },
};

type Status = 'QUEUED' | 'IN_PROGRESS' | 'FINISHED' | 'FAILED' | 'CANCELLED';

export function deriveProgress(
  status: Status,
  logs: ReadonlyArray<{ text: string; stepId?: string | null }>,
): DeployProgress {
  const lastLine = logs.length ? (logs[logs.length - 1]!.text ?? null) : null;
  if (status === 'FINISHED') return { phase: 'done', percent: 100, lastLine };
  if (status === 'FAILED') return { phase: 'failed', percent: 100, lastLine };
  if (status === 'CANCELLED') return { phase: 'cancelled', percent: 100, lastLine };

  // QUEUED / IN_PROGRESS — find the latest log that carries a step id.
  let stepId: string | null = null;
  for (let i = logs.length - 1; i >= 0; i--) {
    const s = logs[i]!.stepId;
    if (s) {
      stepId = s;
      break;
    }
  }
  if (!stepId) return { phase: 'queued', percent: 5, lastLine };

  const mapped = STEP_PHASE[stepId] ?? { phase: 'building' as ProgressPhase, percent: 30 };
  let percent = mapped.percent;
  // Gentle creep through the long build phase so the bar keeps moving.
  if (mapped.phase === 'building') {
    const buildLines = logs.filter((l) => l.stepId === 'build').length;
    percent = Math.min(72, mapped.percent + buildLines * 2);
  }
  return { phase: mapped.phase, percent, lastLine };
}
