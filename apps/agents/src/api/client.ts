/**
 * Cliente de la Admin API v1 de axon-web — la única superficie por la que los
 * agentes tocan la plataforma (misma API que un humano con token, misma
 * auditoría). Un cliente por rol: cada uno lleva SU token.
 */

export interface AgentMe {
  id: string;
  role: 'SM' | 'DEV' | 'QA';
  llmModel: string;
  credentialRef: string | null;
  tokenBudget: number;
  enabled: boolean;
}

export interface RunHandle {
  id: string;
  tokenBudget: number;
}

export interface FinishRunInput {
  status: 'SUCCEEDED' | 'FAILED' | 'BUDGET_EXCEEDED' | 'CANCELLED';
  promptTokens: number;
  completionTokens: number;
  costUsd?: number;
  error?: string;
}

export class AxonApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AxonApiError';
  }
}

export class AxonApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 60_000,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const msg =
        data && typeof data === 'object' && 'error' in data
          ? String((data as { error: unknown }).error)
          : `HTTP ${res.status}`;
      throw new AxonApiError(res.status, msg);
    }
    return data as T;
  }

  /** Config del agente (por identidad del token). 404 si el token no es de un agente. */
  getMe(slug: string): Promise<AgentMe> {
    return this.request('GET', `/projects/${slug}/agents/me`);
  }

  /** Abre la bitácora de una corrida. 403 si el agente está deshabilitado. */
  openRun(slug: string, input: { storyId?: string; payload?: Record<string, unknown> } = {}): Promise<RunHandle> {
    return this.request('POST', `/projects/${slug}/agent-runs`, input);
  }

  /** Cierra la corrida con su estado terminal y el consumo. */
  finishRun(slug: string, runId: string, input: FinishRunInput): Promise<{ ok: boolean }> {
    return this.request('PATCH', `/projects/${slug}/agent-runs/${runId}`, input);
  }

  // ---- Operaciones de tablero (las mismas de un humano) ----

  getTask(slug: string, taskNumber: number): Promise<Record<string, unknown>> {
    return this.request('GET', `/projects/${slug}/tasks/${taskNumber}`);
  }

  patchTask(
    slug: string,
    taskNumber: number,
    input: { toState?: string; title?: string; description?: string; priority?: string },
  ): Promise<{ ok: boolean }> {
    return this.request('PATCH', `/projects/${slug}/tasks/${taskNumber}`, input);
  }

  comment(slug: string, taskNumber: number, body: string): Promise<{ id: string }> {
    return this.request('POST', `/projects/${slug}/tasks/${taskNumber}/comments`, { body });
  }

  submitQaReview(slug: string, taskNumber: number, input: Record<string, unknown>): Promise<{ ok: boolean }> {
    return this.request('POST', `/projects/${slug}/tasks/${taskNumber}/qa-review`, input);
  }

  qaDecision(
    slug: string,
    taskNumber: number,
    input: { decision: 'approve' | 'reject'; comment?: string },
  ): Promise<{ ok: boolean; decision: string; movedTo: string }> {
    return this.request('POST', `/projects/${slug}/tasks/${taskNumber}/qa-decision`, input);
  }

  // ---- Contexto (solo lectura) ----

  /** Memorias del cerebro del proyecto (recall por query). */
  recallBrain(slug: string, query?: string, limit = 10): Promise<Record<string, unknown>> {
    const q = query ? `?q=${encodeURIComponent(query)}&limit=${limit}` : `?limit=${limit}`;
    return this.request('GET', `/projects/${slug}/brain/recall${q}`);
  }

  /** Resumen del grafo de código (CodeAnalysis de graphify). */
  codeContext(slug: string): Promise<Record<string, unknown>> {
    return this.request('GET', `/projects/${slug}/context/code`);
  }
}
