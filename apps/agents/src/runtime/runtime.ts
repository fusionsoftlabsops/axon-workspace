/**
 * Loop de herramientas multi-turno (tool_call → ejecución → tool_result →
 * modelo), compartido por los 3 roles. Lo que lib/ai de axon-web NO tiene
 * (allí el tool-use es solo salida estructurada en una pasada).
 *
 * Reglas:
 * - Los errores de una tool NO tumban la corrida: se devuelven al modelo como
 *   tool_result "ERROR: ..." para que reaccione (reintente / cambie de plan).
 * - Tope duro de iteraciones (loops infinitos) y de tokens (presupuesto,
 *   cableado a Agent.tokenBudget en axon#8).
 * - Tope duro de DURACIÓN TOTAL: cada llamada al LLM tiene su propio timeout,
 *   pero muchas iteraciones lentas (o una tool colgada — post-dogfooding: un
 *   segundo ciclo vivo se quedó sin resolver por ~20 min sin que ningún
 *   timeout individual lo cortara) podían sumar sin techo. Ambos topes son
 *   defensa en profundidad, no alternativas entre sí.
 * - El transcript completo queda disponible para la bitácora (AgentRun).
 */
import type { ChatMessage, LlmProvider, ToolCall, ToolDef, Usage } from './types.js';

export interface AgentLoopOptions {
  provider: LlmProvider;
  system: string;
  tools: ToolDef[];
  /** Tope de iteraciones modelo→tools (default 12). */
  maxIterations?: number;
  /** Presupuesto de tokens (prompt+completion acumulados). Corte duro. */
  maxTotalTokens?: number;
  maxOutputTokens?: number;
  /** Tope de reloj de la corrida completa en ms (default 20 min). */
  maxDurationMs?: number;
  /** Tope por llamada a una tool individual en ms (default 60s). */
  toolTimeoutMs?: number;
  /** Callback por iteración (telemetría / heartbeat). */
  onIteration?(info: { iteration: number; usage: Usage; toolCalls: ToolCall[] }): void;
}

export interface AgentLoopResult {
  finalText: string;
  stopped: 'completed' | 'max_iterations' | 'budget_exceeded' | 'truncated' | 'timeout';
  iterations: number;
  usage: Usage & { totalTokens: number };
  transcript: ChatMessage[];
}

const DEFAULT_MAX_DURATION_MS = 20 * 60_000;
const DEFAULT_TOOL_TIMEOUT_MS = 60_000;

function parseArgs(raw: string): unknown {
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
}

async function executeTool(tools: ToolDef[], call: ToolCall, toolTimeoutMs: number): Promise<string> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return `ERROR: tool desconocida "${call.name}"`;
  const args = parseArgs(call.arguments);
  if (args === null) return `ERROR: argumentos no son JSON válido para "${call.name}"`;
  try {
    return await Promise.race([
      tool.execute(args),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error(`tool "${call.name}" colgada (>${toolTimeoutMs}ms)`)), toolTimeoutMs),
      ),
    ]);
  } catch (err) {
    return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function runAgentLoop(goal: string, opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const maxIterations = opts.maxIterations ?? 12;
  const maxDurationMs = opts.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const toolTimeoutMs = opts.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const deadline = Date.now() + maxDurationMs;
  const transcript: ChatMessage[] = [{ role: 'user', content: goal }];
  const usage: Usage = { promptTokens: 0, completionTokens: 0 };
  let iterations = 0;
  let lastContent = '';

  while (iterations < maxIterations) {
    if (Date.now() >= deadline) {
      const total = usage.promptTokens + usage.completionTokens;
      return { finalText: lastContent, stopped: 'timeout', iterations, usage: { ...usage, totalTokens: total }, transcript };
    }
    iterations += 1;
    const res = await opts.provider.complete({
      system: opts.system,
      messages: transcript,
      tools: opts.tools,
      maxOutputTokens: opts.maxOutputTokens,
    });
    usage.promptTokens += res.usage.promptTokens;
    usage.completionTokens += res.usage.completionTokens;
    lastContent = res.content || lastContent;
    transcript.push({ role: 'assistant', content: res.content, toolCalls: res.toolCalls });
    opts.onIteration?.({ iteration: iterations, usage: { ...usage }, toolCalls: res.toolCalls });

    const total = usage.promptTokens + usage.completionTokens;
    if (opts.maxTotalTokens && total >= opts.maxTotalTokens) {
      return { finalText: lastContent, stopped: 'budget_exceeded', iterations, usage: { ...usage, totalTokens: total }, transcript };
    }
    if (res.stopReason === 'length') {
      return { finalText: lastContent, stopped: 'truncated', iterations, usage: { ...usage, totalTokens: total }, transcript };
    }
    if (res.toolCalls.length === 0) {
      return { finalText: res.content, stopped: 'completed', iterations, usage: { ...usage, totalTokens: total }, transcript };
    }

    // Ejecutar TODAS las tool calls del turno (algunos modelos emiten varias).
    for (const call of res.toolCalls) {
      const result = await executeTool(opts.tools, call, toolTimeoutMs);
      transcript.push({ role: 'tool', content: result, toolCallId: call.id, toolName: call.name });
    }
  }

  const total = usage.promptTokens + usage.completionTokens;
  return { finalText: lastContent, stopped: 'max_iterations', iterations, usage: { ...usage, totalTokens: total }, transcript };
}
