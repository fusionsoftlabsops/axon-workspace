/**
 * Cliente de la Admin API v1 de axon-web — la única superficie por la que los
 * agentes tocan la plataforma (misma API que un humano con token, misma
 * auditoría). Un cliente por rol: cada uno lleva SU token.
 */

export interface AgentMe {
  id: string;
  role: 'SM' | 'DEV' | 'QA' | 'PO' | 'DESIGN' | 'REVIEWER' | 'ARCHITECT' | 'MARKETING';
  userId: string;
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

  listTasks(slug: string): Promise<{
    tasks: Array<{
      number: number;
      title: string;
      state: string;
      stateCategory: string;
      assignee: { id: string; name: string } | null;
      updatedAt: string;
    }>;
  }> {
    return this.request('GET', `/projects/${slug}/tasks`);
  }

  patchTask(
    slug: string,
    taskNumber: number,
    input: {
      toState?: string;
      title?: string;
      description?: string;
      priority?: string;
      assignToAgentRole?: 'SM' | 'DEV' | 'QA' | 'PO' | 'DESIGN' | 'REVIEWER' | 'ARCHITECT' | 'MARKETING';
    },
  ): Promise<{ ok: boolean }> {
    return this.request('PATCH', `/projects/${slug}/tasks/${taskNumber}`, input);
  }

  comment(slug: string, taskNumber: number, body: string): Promise<{ id: string }> {
    return this.request('POST', `/projects/${slug}/tasks/${taskNumber}/comments`, { body });
  }

  submitQaReview(slug: string, taskNumber: number, input: Record<string, unknown>): Promise<{ ok: boolean }> {
    return this.request('POST', `/projects/${slug}/tasks/${taskNumber}/qa-review`, input);
  }

  /**
   * Genera (con IA, server-side) el plan de implementación de la HU y lo
   * persiste en la HU. Lo usa el Dev al tomarla como contexto para implementar.
   */
  generateImplPlan(slug: string, taskNumber: number): Promise<{ ok: boolean; implPlan: string }> {
    return this.request('POST', `/projects/${slug}/tasks/${taskNumber}/impl-plan`, { lang: 'es' });
  }

  /**
   * Refina la HU (descripción + criterios de aceptación + prioridad) con IA y la
   * marca lista (dispara `story.refined` → el SM la asigna). Lo usa el Product Owner.
   */
  refineTask(
    slug: string,
    taskNumber: number,
  ): Promise<{ ok: boolean; refinement: { description: string; acceptanceCriteria: string; priority: string } }> {
    return this.request('POST', `/projects/${slug}/tasks/${taskNumber}/refine`, { lang: 'es' });
  }

  /**
   * Genera el spec de diseño de una HU de UI (notas + mockup gpt-image-1) y lo
   * persiste (dispara `story.designed` → el SM la asigna). Lo usa el agente Diseño.
   */
  designTask(
    slug: string,
    taskNumber: number,
  ): Promise<{ ok: boolean; design: { notes: string; mockupFileId: string | null } }> {
    return this.request('POST', `/projects/${slug}/tasks/${taskNumber}/design`, { lang: 'es' });
  }

  /**
   * Genera el diseño técnico de una HU compleja (arquitectura + descomposición)
   * y lo persiste. Advisory (no cambia estado). Lo usa el Arquitecto (Dax).
   */
  techDesign(slug: string, taskNumber: number): Promise<{ ok: boolean; design: string }> {
    return this.request('POST', `/projects/${slug}/tasks/${taskNumber}/tech-design`, { lang: 'es' });
  }

  /**
   * Genera el kit de marketing de una HU (copy + SEO + social + asset de marca) y
   * lo persiste. Advisory. Lo usa el agente Branding/SEO (Sol).
   */
  marketingKit(
    slug: string,
    taskNumber: number,
  ): Promise<{ ok: boolean; marketing: { kit: string; assetFileId: string | null } }> {
    return this.request('POST', `/projects/${slug}/tasks/${taskNumber}/marketing`, { lang: 'es' });
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

  /** Repos vinculados al proyecto (para el workspace del Dev). */
  listRepos(slug: string): Promise<{
    repos: Array<{ name: string; kind: string; url: string | null; githubFullName: string | null; defaultBranch: string }>;
  }> {
    return this.request('GET', `/projects/${slug}/repos`);
  }

  /** Mensaje al chat del equipo (el standup permanente del proyecto). */
  postTeamChat(
    slug: string,
    input: { body: string; kind?: 'CHAT' | 'STATUS' | 'HANDOFF'; storyNumber?: number },
  ): Promise<{ message: Record<string, unknown> }> {
    return this.request('POST', `/projects/${slug}/team-chat`, input);
  }

  /** Publica una memoria en el cerebro (scope PROJECT = visible al equipo). */
  captureMemory(
    slug: string,
    input: {
      type: 'DECISION' | 'GOTCHA' | 'PATTERN' | 'ANTIPATTERN' | 'RUNBOOK' | 'GLOSSARY' | 'NOTE';
      title: string;
      body: string;
      tags?: string[];
      scope?: 'LOCAL' | 'PROJECT';
      sourceTaskNumber?: number;
    },
  ): Promise<{ id: string }> {
    return this.request('POST', `/projects/${slug}/brain/memories`, input);
  }
}
