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
    postTeamChat: vi.fn().mockResolvedValue({ message: { id: 'tc' } }),
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
    const narrated = (a.postTeamChat as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
      kind: string;
      storyNumber: number;
      body: string;
    };
    expect(narrated).toMatchObject({ kind: 'HANDOFF', storyNumber: 16 });
    expect(narrated.body).toContain('APROBADA');
  });

  it('rechaza con feedback accionable', async () => {
    const a = api();
    const h = createQaHandler({ ...OPTS, api: a, provider: provider('{"decision":"reject","comment":"falta el test de sandbox"}') });
    await h.handle(evt());
    expect(a.qaDecision).toHaveBeenCalledWith('axon', 16, { decision: 'reject', comment: 'falta el test de sandbox' });
    const narrated = (a.postTeamChat as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { body: string };
    expect(narrated.body).toContain('RECHACÉ');
    expect(narrated.body).toContain('falta el test de sandbox');
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

describe('createQaHandler — review acotado', () => {
  it('pasa los criterios de aceptación + la disciplina decisiva al prompt', async () => {
    const prov = provider('{"decision":"approve","comment":"ok"}');
    const a = api({
      getTask: vi.fn().mockResolvedValue({
        title: 'HU',
        description: 'd',
        acceptanceCriteria: '- [ ] criterio-X-verificable',
        comments: [{ body: 'PR: https://github.com/pr/9' }],
      }),
    });
    await createQaHandler({ ...OPTS, api: a, provider: prov }).handle(evt());
    const call = (prov.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const dump = JSON.stringify(call);
    expect(dump).toContain('criterio-X-verificable'); // los criterios llegan al review
    expect(dump).toContain('DECISIVO'); // loop acotado (no re-lee todo el repo)
  });
});

describe('createQaHandler — git_diff + aprendizaje', () => {
  it('expone la tool git_diff al loop (primer tool del set)', async () => {
    const prov = provider('{"decision":"approve","comment":"ok"}');
    const a = api();
    await createQaHandler({ ...OPTS, api: a, provider: prov }).handle(evt());
    const call = (prov.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { tools?: Array<{ name: string }> };
    expect(call.tools?.map((t) => t.name)).toContain('git_diff');
    expect(call.tools?.some((t) => t.name === 'write_file')).toBe(false); // sigue read-only
  });

  it('reject captura GOTCHA al cerebro COMPARTIDO y NOTE al personal', async () => {
    const a = api({ captureMemory: vi.fn().mockResolvedValue({ id: 'm1' }) });
    await createQaHandler({ ...OPTS, api: a, provider: provider('{"decision":"reject","comment":"falta el test X"}') }).handle(evt());
    const caps = (a.captureMemory as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(caps.some((c: { scope: string }) => c.scope === 'LOCAL')).toBe(true);
    expect(caps.some((c: { scope: string; type: string }) => c.scope === 'PROJECT' && c.type === 'GOTCHA')).toBe(true);
  });

  it('approve captura solo la NOTE personal (sin GOTCHA grupal)', async () => {
    const a = api({ captureMemory: vi.fn().mockResolvedValue({ id: 'm1' }) });
    await createQaHandler({ ...OPTS, api: a, provider: provider('{"decision":"approve","comment":"ok"}') }).handle(evt());
    const caps = (a.captureMemory as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(caps).toHaveLength(1);
    expect(caps[0]).toMatchObject({ scope: 'LOCAL' });
  });
});

describe('createQaHandler — comentario en el PR real', () => {
  it('con un PR linkeado en los comentarios, comenta el veredicto también en el PR real', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const a = api({
      getTask: vi.fn().mockResolvedValue({
        title: 'HU',
        comments: [{ body: 'PR: https://github.com/o/r/pull/9' }],
      }),
    });
    await createQaHandler({ ...OPTS, api: a, provider: provider('{"decision":"approve","comment":"ok"}'), gitToken: 'ghp_x' }).handle(
      evt(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/o/r/issues/9/comments',
      expect.objectContaining({ method: 'POST' }),
    );
    const sent = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as { body: string };
    expect(sent.body).toContain('QA');
  });

  it('sin PR linkeado en los comentarios, no llama a la API git', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const a = api(); // fixture default: "https://github.com/pr/9" no matchea owner/repo/pull/N
    await createQaHandler({ ...OPTS, api: a, provider: provider('{"decision":"approve","comment":"ok"}') }).handle(evt());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('si comentar en el PR falla, el veredicto ya persistido en Axon no se ve afectado', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const a = api({
      getTask: vi.fn().mockResolvedValue({ title: 'HU', comments: [{ body: 'PR: https://github.com/o/r/pull/9' }] }),
    });
    await createQaHandler({ ...OPTS, api: a, provider: provider('{"decision":"approve","comment":"ok"}') }).handle(evt());
    expect(a.qaDecision).toHaveBeenCalledWith('axon', 16, { decision: 'approve', comment: 'ok' });
  });
});
