import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDevHandler } from '../src/roles/dev.js';
import type { AxonApi } from '../src/api/client.js';
import type { DomainEventV1 } from '../src/events.js';
import type { CommandRunner, LlmProvider } from '../src/runtime/types.js';
import type { CommandRunner as Runner } from '../src/git/workspace.js';

const fetchMock = vi.fn();
const realFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ html_url: 'https://github.com/pr/9' }) });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function provider(text = 'Resumen: implementado X'): LlmProvider {
  return {
    complete: vi.fn().mockResolvedValue({
      content: text,
      toolCalls: [],
      usage: { promptTokens: 100, completionTokens: 50 },
      stopReason: 'stop',
    }),
  };
}

function runner(statusOut = ' M src/x.ts\n'): Runner {
  return async (_cmd, args) => ({ code: 0, stdout: args[0] === 'status' ? statusOut : '', stderr: '' });
}

function api(over: Partial<Record<string, unknown>> = {}): AxonApi {
  return {
    getMe: vi.fn().mockResolvedValue({ enabled: true, userId: 'u-dev', role: 'DEV' }),
    getTask: vi.fn().mockResolvedValue({ title: 'HU 13', description: 'hacer X', comments: [] }),
    listRepos: vi.fn().mockResolvedValue({
      repos: [{ name: 'axon-workspace', kind: 'other', url: 'https://github.com/o/r', githubFullName: 'o/r', defaultBranch: 'main' }],
    }),
    openRun: vi.fn().mockResolvedValue({ id: 'run1', tokenBudget: 100000 }),
    finishRun: vi.fn().mockResolvedValue({ ok: true }),
    comment: vi.fn().mockResolvedValue({ id: 'c' }),
    submitQaReview: vi.fn().mockResolvedValue({ ok: true }),
    recallBrain: vi.fn().mockResolvedValue({ memories: [] }),
    codeContext: vi.fn().mockResolvedValue({ status: 'NONE' }),
    ...over,
  } as unknown as AxonApi;
}

function evt(over: Partial<DomainEventV1> = {}): DomainEventV1 {
  return {
    v: 1,
    type: 'story.state_changed',
    projectId: 'p1',
    storyId: 't13',
    storyNumber: 13,
    toState: { id: 's-dev', name: 'Desarrollo', category: 'IN_PROGRESS' },
    actorId: 'u-sm',
    assigneeId: 'u-dev',
    ts: 'now',
  ...over,
  };
}

const OPTS = { projectId: 'p1', projectSlug: 'axon', gitToken: 'ghp_x' };

describe('createDevHandler.matches', () => {
  it('acepta transiciones a IN_PROGRESS con asignado; rechaza lo demás', () => {
    const h = createDevHandler({ ...OPTS, api: api(), provider: provider(), run: runner() });
    expect(h.matches(evt())).toBe(true);
    expect(h.matches(evt({ toState: { id: 'x', category: 'REVIEW' } }))).toBe(false);
    expect(h.matches(evt({ assigneeId: null }))).toBe(false);
    expect(h.matches(evt({ projectId: 'otro' }))).toBe(false);
  });
});

describe('createDevHandler.handle', () => {
  it('pipeline completo: clone → loop → commit/push/PR → qa-review a Verificación', async () => {
    const a = api();
    const h = createDevHandler({ ...OPTS, api: a, provider: provider(), run: runner() });
    await h.handle(evt());
    expect(a.openRun).toHaveBeenCalled();
    const qa = (a.submitQaReview as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(qa[1]).toBe(13);
    expect(JSON.stringify(qa[2])).toContain('https://github.com/pr/9');
    expect(a.comment).not.toHaveBeenCalled();
  });

  it('ignora HUs asignadas a otra identidad', async () => {
    const a = api();
    const h = createDevHandler({ ...OPTS, api: a, provider: provider(), run: runner() });
    await h.handle(evt({ assigneeId: 'humano' }));
    expect(a.openRun).not.toHaveBeenCalled();
  });

  it('sin repo vinculado comenta y no intenta clonar', async () => {
    const a = api({ listRepos: vi.fn().mockResolvedValue({ repos: [] }) });
    const h = createDevHandler({ ...OPTS, api: a, provider: provider(), run: runner() });
    await h.handle(evt());
    expect((a.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2]).toContain('no tiene un repo');
    expect(a.submitQaReview).not.toHaveBeenCalled();
  });

  it('corrida sin cambios en el repo → comenta el análisis y queda en Desarrollo', async () => {
    const a = api();
    const h = createDevHandler({ ...OPTS, api: a, provider: provider('solo análisis'), run: runner('') });
    await h.handle(evt());
    const body = (a.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2] as string;
    expect(body).toContain('sin cambios');
    expect(body).toContain('solo análisis');
    expect(a.submitQaReview).not.toHaveBeenCalled();
  });

  it('corrida BUDGET_EXCEEDED → comenta el estado sin abrir PR', async () => {
    const a = api({ openRun: vi.fn().mockResolvedValue({ id: 'r', tokenBudget: 100 }) });
    const h = createDevHandler({ ...OPTS, api: a, provider: provider(), run: runner() });
    await h.handle(evt());
    const body = (a.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2] as string;
    expect(body).toContain('BUDGET_EXCEEDED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dev deshabilitado no actúa', async () => {
    const a = api({ getMe: vi.fn().mockResolvedValue({ enabled: false, userId: 'u-dev' }) });
    const h = createDevHandler({ ...OPTS, api: a, provider: provider(), run: runner() });
    await h.handle(evt());
    expect(a.getTask).not.toHaveBeenCalled();
  });
});
