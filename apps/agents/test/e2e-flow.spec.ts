/**
 * E2E de coreografía (axon#20, capa de código): una HU recorre
 * Preparación → Desarrollo → Verificación → Hecho con los TRES handlers
 * reales encadenados por eventos de dominio, contra un tablero fake en
 * memoria que respeta la semántica de la Admin API (incluido el guardarraíl).
 * La corrida VIVA en producción es el runbook de axon#19/#20.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventRouter } from '../src/router.js';
import { createSmAssignHandler } from '../src/roles/sm.js';
import { createDevHandler } from '../src/roles/dev.js';
import { createQaHandler } from '../src/roles/qa.js';
import type { AxonApi } from '../src/api/client.js';
import type { DomainEventV1 } from '../src/events.js';
import type { LlmProvider } from '../src/runtime/types.js';
import type { CommandRunner } from '../src/git/workspace.js';

const realFetch = globalThis.fetch;

/** Tablero en memoria con la semántica mínima de la Admin API. */
class FakeBoard {
  state = 'Preparación';
  assignee: string | null = null;
  submittedById: string | null = null;
  comments: string[] = [];
  events: DomainEventV1[] = [];
  runs: Array<{ role: string; status?: string }> = [];

  private emit(toCategory: string, actorId: string) {
    this.events.push({
      v: 1,
      type: 'story.state_changed',
      projectId: 'p1',
      storyId: 't42',
      storyNumber: 42,
      toState: { id: toCategory, name: this.state, category: toCategory },
      actorId,
      assigneeId: this.assignee,
      ts: 'now',
    });
  }

  /** Un AxonApi fake por rol (identidad propia, como los tokens reales). */
  apiFor(role: 'SM' | 'DEV' | 'QA'): AxonApi {
    const userId = `u-${role.toLowerCase()}`;
    const board = this;
    return {
      getMe: vi.fn(async () => ({ enabled: true, userId, role })),
      getTask: vi.fn(async () => ({
        number: 42,
        title: 'Agregar endpoint /ping',
        description: 'Criterio: GET /ping responde pong',
        state: board.state,
        assignee: board.assignee ? { id: board.assignee } : null,
        comments: board.comments.map((body) => ({ body })),
      })),
      listRepos: vi.fn(async () => ({
        repos: [{ name: 'r', kind: 'other', url: 'https://github.com/o/r', githubFullName: 'o/r', defaultBranch: 'main' }],
      })),
      patchTask: vi.fn(async (_s: string, _n: number, input: { toState?: string; assignToAgentRole?: string }) => {
        if (input.assignToAgentRole) board.assignee = `u-${input.assignToAgentRole.toLowerCase()}`;
        if (input.toState) {
          board.state = input.toState;
          board.emit('IN_PROGRESS', userId);
        }
        return { ok: true };
      }),
      comment: vi.fn(async (_s: string, _n: number, body: string) => {
        board.comments.push(body);
        return { id: 'c' };
      }),
      submitQaReview: vi.fn(async (_s: string, _n: number, input: { notes?: string }) => {
        board.submittedById = userId; // sellado por identidad, como el server real
        board.state = 'Verificación';
        board.comments.push(`Entregado a QA: ${input.notes ?? ''}`);
        board.emit('REVIEW', userId);
        return { ok: true };
      }),
      qaDecision: vi.fn(async (_s: string, _n: number, input: { decision: string; comment?: string }) => {
        // Guardarraíl real del server: quien entregó no aprueba.
        if (input.decision === 'approve' && board.submittedById === userId) {
          throw new Error('guardrail: el agente no puede aprobar su propio trabajo');
        }
        board.state = input.decision === 'approve' ? 'Terminada' : 'Desarrollo';
        board.comments.push(`QA ${input.decision}: ${input.comment ?? ''}`);
        board.emit(input.decision === 'approve' ? 'DONE' : 'IN_PROGRESS', userId);
        return { ok: true, decision: input.decision, movedTo: board.state };
      }),
      openRun: vi.fn(async () => {
        return { id: `run-${board.runs.push({ role: userId })}`, tokenBudget: 100_000 };
      }),
      finishRun: vi.fn(async (_s: string, runId: string, input: { status: string }) => {
        board.runs[Number(runId.split('-')[1]) - 1]!.status = input.status;
        return { ok: true };
      }),
      recallBrain: vi.fn(async () => ({ memories: [{ title: 'patrón ping', body: 'usar router existente' }] })),
      codeContext: vi.fn(async () => ({ status: 'READY', summary: 'API Express' })),
      captureMemory: vi.fn(async () => ({ id: 'm' })),
      listTasks: vi.fn(async () => ({ tasks: [] })),
    } as unknown as AxonApi;
  }
}

function provider(text: string): LlmProvider {
  return {
    complete: vi.fn().mockResolvedValue({
      content: text,
      toolCalls: [],
      usage: { promptTokens: 200, completionTokens: 100 },
      stopReason: 'stop',
    }),
  };
}

const gitRunner: CommandRunner = async (_c, args) => ({
  code: 0,
  stdout: args[0] === 'status' ? ' M src/ping.ts\n' : '',
  stderr: '',
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({ html_url: 'https://github.com/o/r/pull/7' }),
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('dogfooding: Preparación → Hecho sin humano', () => {
  it('la HU recorre el ciclo completo con traza total y guardarraíl activo', async () => {
    const board = new FakeBoard();
    const router = new EventRouter();
    const OPTS = { projectId: 'p1', projectSlug: 'axon' };

    router.register(createSmAssignHandler({ ...OPTS, api: board.apiFor('SM') }));
    router.register(
      createDevHandler({ ...OPTS, api: board.apiFor('DEV'), provider: provider('Implementé /ping con test.'), run: gitRunner, gitToken: 'ghp_x' }),
    );
    router.register(
      createQaHandler({ ...OPTS, api: board.apiFor('QA'), provider: provider('{"decision":"approve","comment":"pong verificado"}'), run: gitRunner, gitToken: 'ghp_x' }),
    );

    // Chispa inicial: la HU nace en Preparación.
    board.events.push({
      v: 1,
      type: 'story.created',
      projectId: 'p1',
      storyId: 't42',
      storyNumber: 42,
      toState: { id: 's-prep' },
      actorId: 'humano',
      ts: 'now',
    });

    // Bomba de eventos: como el worker real, drena la cola despachando en orden.
    let guard = 0;
    while (board.events.length > 0 && guard < 10) {
      guard += 1;
      const event = board.events.shift()!;
      await router.dispatch(event);
    }

    // Estado final: Hecho, sin intervención humana tras la chispa.
    expect(board.state).toBe('Terminada');
    // Traza completa: SM asignó y comentó → Dev entregó → QA aprobó.
    expect(board.assignee).toBe('u-dev');
    expect(board.comments.some((c) => c.includes('SM'))).toBe(true);
    expect(board.comments.some((c) => c.includes('Entregado a QA'))).toBe(true);
    expect(board.comments.some((c) => c.includes('QA approve'))).toBe(true);
    // Guardarraíl: quien entregó fue u-dev; quien aprobó fue u-qa.
    expect(board.submittedById).toBe('u-dev');
    // Bitácora: corridas del Dev y del QA con estado terminal.
    expect(board.runs.length).toBeGreaterThanOrEqual(2);
    expect(board.runs.every((r) => r.status === 'SUCCEEDED')).toBe(true);
  });

  it('el rechazo de QA devuelve la HU a Desarrollo (ciclo de corrección)', async () => {
    const board = new FakeBoard();
    const router = new EventRouter();
    const OPTS = { projectId: 'p1', projectSlug: 'axon' };

    router.register(createSmAssignHandler({ ...OPTS, api: board.apiFor('SM') }));
    const devProvider = provider('Implementé /ping.');
    router.register(
      createDevHandler({ ...OPTS, api: board.apiFor('DEV'), provider: devProvider, run: gitRunner, gitToken: 'ghp_x' }),
    );
    router.register(
      createQaHandler({ ...OPTS, api: board.apiFor('QA'), provider: provider('{"decision":"reject","comment":"falta el test"}'), run: gitRunner, gitToken: 'ghp_x' }),
    );

    board.events.push({
      v: 1,
      type: 'story.created',
      projectId: 'p1',
      storyId: 't42',
      storyNumber: 42,
      toState: { id: 's-prep' },
      actorId: 'humano',
      ts: 'now',
    });

    // Drenar con tope bajo: el reject → IN_PROGRESS relanza al Dev (bucle
    // legítimo de corrección); cortamos tras el primer rechazo.
    let sawReject = false;
    let guard = 0;
    while (board.events.length > 0 && guard < 6 && !sawReject) {
      guard += 1;
      await router.dispatch(board.events.shift()!);
      sawReject = board.comments.some((c) => c.includes('QA reject'));
    }

    expect(sawReject).toBe(true);
    expect(board.comments.some((c) => c.includes('falta el test'))).toBe(true);
  });
});
