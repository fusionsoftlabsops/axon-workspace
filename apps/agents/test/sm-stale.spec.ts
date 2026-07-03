import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSmStaleSweep,
  STALE_ESCALATION_MARK,
  STALE_FOLLOWUP_MARK,
} from '../src/roles/sm-stale.js';
import type { AxonApi } from '../src/api/client.js';
import type { LlmProvider } from '../src/runtime/types.js';

const NOW = Date.parse('2026-07-03T12:00:00Z');
const OLD = new Date(NOW - 5 * 60 * 60 * 1000).toISOString(); // 5h sin actividad
const FRESH = new Date(NOW - 10 * 60 * 1000).toISOString();

function task(over: Record<string, unknown> = {}) {
  return {
    number: 7,
    title: 'HU 7',
    state: 'Desarrollo',
    stateCategory: 'IN_PROGRESS',
    assignee: null,
    updatedAt: OLD,
    ...over,
  };
}

function api(over: Partial<Record<string, unknown>> = {}): AxonApi {
  return {
    getMe: vi.fn().mockResolvedValue({ enabled: true }),
    listTasks: vi.fn().mockResolvedValue({ tasks: [task()] }),
    getTask: vi.fn().mockResolvedValue({ comments: [] }),
    comment: vi.fn().mockResolvedValue({ id: 'c' }),
    openRun: vi.fn().mockResolvedValue({ id: 'r1', tokenBudget: 10000 }),
    finishRun: vi.fn().mockResolvedValue({ ok: true }),
    recallBrain: vi.fn().mockResolvedValue({ memories: [] }),
    codeContext: vi.fn().mockResolvedValue({ status: 'NONE' }),
    ...over,
  } as unknown as AxonApi;
}

const OPTS = { projectId: 'p1', projectSlug: 'axon', now: () => NOW };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('createSmStaleSweep', () => {
  it('comenta accionable (fallback determinista) en la primera detección', async () => {
    const a = api();
    const sweep = createSmStaleSweep({ ...OPTS, api: a });
    expect(await sweep.sweepOnce()).toBe(1);
    const body = (a.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2] as string;
    expect(body).toContain(STALE_FOLLOWUP_MARK);
    expect(body).toContain('Desarrollo');
  });

  it('ignora HUs frescas y estados que no son de trabajo', async () => {
    const a = api({
      listTasks: vi.fn().mockResolvedValue({
        tasks: [
          task({ updatedAt: FRESH }),
          task({ number: 8, stateCategory: 'TODO' }),
          task({ number: 9, stateCategory: 'DONE' }),
        ],
      }),
    });
    expect(await createSmStaleSweep({ ...OPTS, api: a }).sweepOnce()).toBe(0);
    expect(a.comment).not.toHaveBeenCalled();
  });

  it('escala a humanos en la segunda detección y no insiste tras escalar', async () => {
    const a1 = api({ getTask: vi.fn().mockResolvedValue({ comments: [{ body: `${STALE_FOLLOWUP_MARK}: x` }] }) });
    await createSmStaleSweep({ ...OPTS, api: a1 }).sweepOnce();
    expect((a1.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2]).toContain(STALE_ESCALATION_MARK);

    const a2 = api({ getTask: vi.fn().mockResolvedValue({ comments: [{ body: `${STALE_ESCALATION_MARK}: y` }] }) });
    expect(await createSmStaleSweep({ ...OPTS, api: a2 }).sweepOnce()).toBe(0);
    expect(a2.comment).not.toHaveBeenCalled();
  });

  it('usa el runtime LLM cuando hay provider (comentario accionable del modelo)', async () => {
    const a = api();
    const provider: LlmProvider = {
      complete: vi.fn().mockResolvedValue({
        content: 'Revisar el error del build en CI y repushear.',
        toolCalls: [],
        usage: { promptTokens: 10, completionTokens: 5 },
        stopReason: 'stop',
      }),
    };
    await createSmStaleSweep({ ...OPTS, api: a, provider }).sweepOnce();
    const body = (a.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2] as string;
    expect(body).toContain('Revisar el error del build');
    expect(a.openRun).toHaveBeenCalled(); // corrida con bitácora
  });

  it('si el LLM falla cae al comentario determinista', async () => {
    const a = api();
    const provider: LlmProvider = { complete: vi.fn().mockRejectedValue(new Error('llm down')) };
    await createSmStaleSweep({ ...OPTS, api: a, provider }).sweepOnce();
    const body = (a.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2] as string;
    expect(body).toContain('Siguiente paso sugerido');
  });

  it('SM deshabilitado no barre; fallo en una HU no frena a las demás', async () => {
    const off = api({ getMe: vi.fn().mockResolvedValue({ enabled: false }) });
    expect(await createSmStaleSweep({ ...OPTS, api: off }).sweepOnce()).toBe(0);

    const a = api({
      listTasks: vi.fn().mockResolvedValue({ tasks: [task(), task({ number: 8 })] }),
      getTask: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue({ comments: [] }),
    });
    expect(await createSmStaleSweep({ ...OPTS, api: a }).sweepOnce()).toBe(1);
  });
});
