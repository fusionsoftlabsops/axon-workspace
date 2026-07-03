/**
 * Corrida CON bitácora y presupuesto: abre un AgentRun antes de invocar al
 * modelo, corre el loop con corte duro en Agent.tokenBudget y cierra la
 * bitácora con el estado terminal + consumo. El cierre es best-effort: si la
 * API no responde al cerrar, el run queda RUNNING y se loguea (huérfano
 * detectable por startedAt viejo).
 */
import type { AxonApi } from '../api/client.js';
import { runAgentLoop, type AgentLoopOptions, type AgentLoopResult } from './runtime.js';

export interface TrackedRunOptions extends Omit<AgentLoopOptions, 'maxTotalTokens'> {
  api: AxonApi;
  projectSlug: string;
  storyId?: string;
  /** Contexto del evento disparador (queda en AgentRun.payload). */
  payload?: Record<string, unknown>;
  /** USD por millón de tokens (prompt+completion) para estimar costo. 0 = modelo propio. */
  usdPerMTok?: number;
}

const STATUS_BY_STOP: Record<AgentLoopResult['stopped'], 'SUCCEEDED' | 'FAILED' | 'BUDGET_EXCEEDED'> = {
  completed: 'SUCCEEDED',
  budget_exceeded: 'BUDGET_EXCEEDED',
  max_iterations: 'FAILED',
  truncated: 'FAILED',
  timeout: 'FAILED',
};

export interface TrackedRunResult extends AgentLoopResult {
  runId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'BUDGET_EXCEEDED';
}

export async function runTrackedLoop(goal: string, opts: TrackedRunOptions): Promise<TrackedRunResult> {
  const run = await opts.api.openRun(opts.projectSlug, {
    storyId: opts.storyId,
    payload: opts.payload,
  });

  let result: AgentLoopResult;
  try {
    result = await runAgentLoop(goal, {
      provider: opts.provider,
      system: opts.system,
      tools: opts.tools,
      maxIterations: opts.maxIterations,
      maxOutputTokens: opts.maxOutputTokens,
      onIteration: opts.onIteration,
      maxTotalTokens: run.tokenBudget,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await opts.api
      .finishRun(opts.projectSlug, run.id, {
        status: 'FAILED',
        promptTokens: 0,
        completionTokens: 0,
        error: message.slice(0, 4000),
      })
      .catch((e) => console.error('[agents] no se pudo cerrar el run (FAILED):', e));
    throw err;
  }

  const status = STATUS_BY_STOP[result.stopped];
  const costUsd = opts.usdPerMTok ? (result.usage.totalTokens / 1_000_000) * opts.usdPerMTok : 0;
  await opts.api
    .finishRun(opts.projectSlug, run.id, {
      status,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      costUsd,
      ...(status !== 'SUCCEEDED'
        ? { error: result.error ?? `stopped=${result.stopped} tras ${result.iterations} iteraciones` }
        : {}),
    })
    .catch((e) => console.error('[agents] no se pudo cerrar el run:', e));

  return { ...result, runId: run.id, status };
}
