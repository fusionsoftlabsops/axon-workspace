import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReviewerHandler } from '../src/roles/reviewer.js';
import type { AxonApi } from '../src/api/client.js';
import type { DomainEventV1 } from '../src/events.js';
import type { LlmProvider } from '../src/runtime/types.js';
import type { CommandRunner } from '../src/git/workspace.js';

const realFetch = globalThis.fetch;
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => {
  globalThis.fetch = realFetch;
});

function provider(text: string): LlmProvider {
  return {
    complete: vi.fn().mockResolvedValue({ content: text, toolCalls: [], usage: { promptTokens: 80, completionTokens: 40 }, stopReason: 'stop' }),
  };
}
const okRunner: CommandRunner = async () => ({ code: 0, stdout: '', stderr: '' });
const failCloneRunner: CommandRunner = async (_c, args) =>
  args[0] === 'clone' ? { code: 128, stdout: '', stderr: 'not found' } : { code: 0, stdout: '', stderr: '' };

function api(over: Partial<Record<string, unknown>> = {}): AxonApi {
  return {
    getMe: vi.fn().mockResolvedValue({ enabled: true, userId: 'u-rev', role: 'REVIEWER' }),
    getTask: vi.fn().mockResolvedValue({ title: 'HU 28', comments: [{ body: 'Cierre — PR: https://github.com/pr/9' }] }),
    listRepos: vi.fn().mockResolvedValue({ repos: [{ name: 'r', kind: 'other', url: 'https://github.com/o/r', defaultBranch: 'main' }] }),
    openRun: vi.fn().mockResolvedValue({ id: 'r1', tokenBudget: 100000 }),
    finishRun: vi.fn().mockResolvedValue({ ok: true }),
    comment: vi.fn().mockResolvedValue({ id: 'c' }),
    qaDecision: vi.fn().mockResolvedValue({ ok: true }),
    postTeamChat: vi.fn().mockResolvedValue({ message: { id: 'tc' } }),
    recallBrain: vi.fn().mockResolvedValue({ memories: [] }),
    codeContext: vi.fn().mockResolvedValue({ status: 'NONE' }),
    ...over,
  } as unknown as AxonApi;
}

function evt(over: Partial<DomainEventV1> = {}): DomainEventV1 {
  return { v: 1, type: 'story.state_changed', projectId: 'p1', storyId: 't28', storyNumber: 28, toState: { id: 's', name: 'Verificación', category: 'REVIEW' }, actorId: 'u-dev', ts: 'now', ...over };
}

const OPTS = { projectId: 'p1', projectSlug: 'axon', run: okRunner };

describe('createReviewerHandler.matches', () => {
  it('acepta llegadas a REVIEW de su proyecto', () => {
    const h = createReviewerHandler({ ...OPTS, api: api(), provider: provider('{}') });
    expect(h.matches(evt())).toBe(true);
    expect(h.matches(evt({ toState: { id: 'x', category: 'DONE' } }))).toBe(false);
    expect(h.matches(evt({ projectId: 'otro' }))).toBe(false);
  });
});

describe('createReviewerHandler.handle', () => {
  it('comenta el review (advisory) y NO mueve la HU', async () => {
    const a = api();
    await createReviewerHandler({ ...OPTS, api: a, provider: provider('{"severity":"ok","comment":"limpio"}') }).handle(evt());
    const body = (a.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2] as string;
    expect(body).toContain('Code Review');
    expect(body).toContain('ok');
    expect(a.qaDecision).not.toHaveBeenCalled(); // advisory: no toca el estado
  });

  it('marca blocker con severidad y hallazgos', async () => {
    const a = api();
    await createReviewerHandler({ ...OPTS, api: a, provider: provider('{"severity":"blocker","comment":"SQL sin parametrizar en x.ts"}') }).handle(evt());
    const body = (a.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2] as string;
    expect(body).toContain('blocker');
    expect(body).toContain('SQL sin parametrizar');
  });

  it('sin la rama del dev (clone falla) no revisa', async () => {
    const a = api();
    await createReviewerHandler({ ...OPTS, run: failCloneRunner, api: a, provider: provider('{}') }).handle(evt());
    expect(a.comment).not.toHaveBeenCalled();
  });

  it('deshabilitado → silencio', async () => {
    const a = api({ getMe: vi.fn().mockResolvedValue({ enabled: false }) });
    await createReviewerHandler({ ...OPTS, api: a, provider: provider('{}') }).handle(evt());
    expect(a.getTask).not.toHaveBeenCalled();
  });
});

describe('createReviewerHandler — comentario en el PR real', () => {
  it('con un PR linkeado en los comentarios, comenta el review también en el PR real', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const a = api({ getTask: vi.fn().mockResolvedValue({ title: 'HU 28', comments: [{ body: 'PR: https://github.com/o/r/pull/9' }] }) });
    await createReviewerHandler({ ...OPTS, api: a, provider: provider('{"severity":"ok","comment":"limpio"}'), gitToken: 'ghp_x' }).handle(
      evt(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/o/r/issues/9/comments',
      expect.objectContaining({ method: 'POST' }),
    );
    const sent = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as { body: string };
    expect(sent.body).toContain('Code Review');
  });

  it('sin PR linkeado en los comentarios, no llama a la API git', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const a = api(); // fixture default: "https://github.com/pr/9" no matchea owner/repo/pull/N
    await createReviewerHandler({ ...OPTS, api: a, provider: provider('{"severity":"ok","comment":"limpio"}') }).handle(evt());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('si comentar en el PR falla, el comentario ya persistido en Axon no se ve afectado', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const a = api({ getTask: vi.fn().mockResolvedValue({ title: 'HU 28', comments: [{ body: 'PR: https://github.com/o/r/pull/9' }] }) });
    await createReviewerHandler({ ...OPTS, api: a, provider: provider('{"severity":"ok","comment":"limpio"}') }).handle(evt());
    expect(a.comment).toHaveBeenCalled();
  });
});
