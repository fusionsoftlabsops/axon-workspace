import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createQaHandler } from '../src/roles/qa.js';
import type { AxonApi } from '../src/api/client.js';
import type { DomainEventV1 } from '../src/events.js';
import type { LlmProvider } from '../src/runtime/types.js';
import type { CommandRunner } from '../src/git/workspace.js';

const realFetch = globalThis.fetch;
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function provider(text: string): LlmProvider {
  return {
    complete: vi.fn().mockResolvedValue({
      content: text,
      toolCalls: [],
      usage: { promptTokens: 80, completionTokens: 40 },
      stopReason: 'stop',
    }),
  };
}

const okRunner: CommandRunner = async () => ({ code: 0, stdout: '', stderr: '' });
const failCloneRunner: CommandRunner = async (_c, args) =>
  args[0] === 'clone' ? { code: 128, stdout: '', stderr: 'not found' } : { code: 0, stdout: '', stderr: '' };

function api(over: Partial<Record<string, unknown>> = {}): AxonApi {
  return {
    getMe: vi.fn().mockResolvedValue({ enabled: true, userId: 'u-qa', role: 'QA' }),
    getTask: vi.fn().mockResolvedValue({
      title: 'HU 16',
      description: 'criterios...',
      comments: [{ body: 'Entregado a QA — PR: https://github.com/pr/9' }],
    }),
    listRepos: vi.fn().mockResolvedValue({
      repos: [{ name: 'r', kind: 'other', url: 'https://github.com/o/r', githubFullName: 'o/r', defaultBranch: 'main' }],
    }),
    openRun: vi.fn().mockResolvedValue({ id: 'r1', tokenBudget: 100000 }),
    finishRun: vi.fn().mockResolvedValue({ ok: true }),
    comment: vi.fn().mockResolvedValue({ id: 'c' }),
    qaDecision: vi.fn().mockResolvedValue({ ok: true, decision: 'approve', movedTo: 'Terminada' }),
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
    storyId: 't16',
    storyNumber: 16,
    toState: { id: 's-rev', name: 'Verificación', category: 'REVIEW' },
    actorId: 'u-dev',
    ts: 'now',
    ...over,
  };
}

const OPTS = { projectId: 'p1', projectSlug: 'axon', run: okRunner };

describe('createQaHandler.matches', () => {
  it('acepta llegadas a REVIEW de su proyecto', () => {
    const h = createQaHandler({ ...OPTS, api: api(), provider: provider('{}') });
    expect(h.matches(evt())).toBe(true);
    expect(h.matches(evt({ toState: { id: 'x', category: 'DONE' } }))).toBe(false);
    expect(h.matches(evt({ projectId: 'otro' }))).toBe(false);
  });
});

describe('createQaHandler.handle', () => {
  it('aprueba vía qa-decision cuando no logra refutar', async () => {
    const a = api();
    const h = createQaHandler({ ...OPTS, api: a, provider: provider('{"decision":"approve","comment":"criterios cubiertos"}') });
    await h.handle(evt());
    expect(a.qaDecision).toHaveBeenCalledWith('axon', 16, { decision: 'approve', comment: 'criterios cubiertos' });
  });

  it('rechaza con feedback accionable', async () => {
    const a = api();
    const h = createQaHandler({ ...OPTS, api: a, provider: provider('{"decision":"reject","comment":"falta el test de sandbox"}') });
    await h.handle(evt());
    expect(a.qaDecision).toHaveBeenCalledWith('axon', 16, { decision: 'reject', comment: 'falta el test de sandbox' });
  });

  it('si el clone de la rama del dev falla, cae a la default y sigue', async () => {
    let cloneCalls = 0;
    const fallbackRunner: CommandRunner = async (_c, args) => {
      if (args[0] === 'clone') {
        cloneCalls += 1;
        return cloneCalls === 1 ? { code: 128, stdout: '', stderr: 'no branch' } : { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const a = api();
    const h = createQaHandler({ ...OPTS, run: fallbackRunner, api: a, provider: provider('{"decision":"approve"}') });
    await h.handle(evt());
    expect(cloneCalls).toBe(2);
    expect(a.qaDecision).toHaveBeenCalled();
  });

  it('sin repo clonable revisa igual (conservador, con contexto)', async () => {
    const a = api();
    const h = createQaHandler({ ...OPTS, run: failCloneRunner, api: a, provider: provider('{"decision":"reject","comment":"sin evidencia"}') });
    await h.handle(evt());
    expect(a.qaDecision).toHaveBeenCalledWith('axon', 16, expect.objectContaining({ decision: 'reject' }));
  });

  it('veredicto no parseable → comenta y deja para humanos (sin decisión)', async () => {
    const a = api();
    const h = createQaHandler({ ...OPTS, api: a, provider: provider('no soy json') });
    await h.handle(evt());
    expect(a.qaDecision).not.toHaveBeenCalled();
    expect((a.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2]).toContain('sin veredicto parseable');
  });

  it('corrida no exitosa → comenta el estado; QA disabled → silencio', async () => {
    const a = api({ openRun: vi.fn().mockResolvedValue({ id: 'r', tokenBudget: 50 }) });
    const h = createQaHandler({ ...OPTS, api: a, provider: provider('{"decision":"approve"}') });
    await h.handle(evt());
    expect((a.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2]).toContain('no pude completar');

    const off = api({ getMe: vi.fn().mockResolvedValue({ enabled: false }) });
    await createQaHandler({ ...OPTS, api: off, provider: provider('{}') }).handle(evt());
    expect(off.getTask).not.toHaveBeenCalled();
  });
});
