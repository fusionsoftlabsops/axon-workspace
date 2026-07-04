import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReleaseHandler, parsePrNumber } from '../src/roles/release.js';
import type { AxonApi } from '../src/api/client.js';
import type { DomainEventV1 } from '../src/events.js';

function api(over: Partial<Record<string, unknown>> = {}): AxonApi {
  return {
    getMe: vi.fn().mockResolvedValue({ enabled: true, role: 'RELEASE' }),
    getTask: vi.fn().mockResolvedValue({ title: 'HU', comments: [{ body: 'Cierre — PR: https://github.com/o/r/pull/52' }] }),
    listRepos: vi.fn().mockResolvedValue({ repos: [{ name: 'r', githubFullName: 'o/r', url: 'https://github.com/o/r', defaultBranch: 'main' }] }),
    comment: vi.fn().mockResolvedValue({ id: 'c' }),
    postTeamChat: vi.fn().mockResolvedValue({ message: { id: 'tc' } }),
    ...over,
  } as unknown as AxonApi;
}
function evt(over: Partial<DomainEventV1> = {}): DomainEventV1 {
  return { v: 1, type: 'story.state_changed', projectId: 'p1', storyId: 't1', storyNumber: 28, toState: { id: 's', name: 'Terminada', category: 'DONE' }, actorId: 'po', ts: 'now', ...over };
}
const OPTS = { projectId: 'p1', projectSlug: 'axon', gitToken: 'ghp_x' };

function ghFetch(prBody: unknown, statusBody: unknown = { state: 'success' }) {
  return vi.fn().mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => (url.includes('/status') ? statusBody : prBody),
    }),
  );
}

beforeEach(() => vi.restoreAllMocks());

describe('parsePrNumber', () => {
  it('saca el nº de PR del último link github', () => {
    expect(parsePrNumber([{ body: 'PR: https://github.com/o/r/pull/52' }])).toBe(52);
    expect(parsePrNumber([{ body: 'sin pr' }])).toBeNull();
  });
});

describe('createReleaseHandler', () => {
  it('matches solo story.state_changed a DONE', () => {
    const h = createReleaseHandler({ ...OPTS, api: api(), fetchImpl: ghFetch({}) as unknown as typeof fetch });
    expect(h.matches(evt())).toBe(true);
    expect(h.matches(evt({ toState: { id: 'x', category: 'REVIEW' } }))).toBe(false);
  });

  it('PR mergeado + CI verde → listo para desplegar', async () => {
    const a = api();
    await createReleaseHandler({ ...OPTS, api: a, fetchImpl: ghFetch({ merged: true, head: { sha: 'abc' } }, { state: 'success' }) as unknown as typeof fetch }).handle(evt());
    const body = (a.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2] as string;
    expect(body).toContain('listo para desplegar');
  });

  it('PR sin mergear → falta el merge', async () => {
    const a = api();
    await createReleaseHandler({ ...OPTS, api: a, fetchImpl: ghFetch({ merged: false, state: 'open' }) as unknown as typeof fetch }).handle(evt());
    expect((a.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2]).toContain('sin mergear');
  });

  it('sin PR en los comentarios → no comenta', async () => {
    const a = api({ getTask: vi.fn().mockResolvedValue({ title: 'HU', comments: [{ body: 'sin pr' }] }) });
    await createReleaseHandler({ ...OPTS, api: a, fetchImpl: ghFetch({}) as unknown as typeof fetch }).handle(evt());
    expect(a.comment).not.toHaveBeenCalled();
  });

  it('deshabilitado → no actúa', async () => {
    const a = api({ getMe: vi.fn().mockResolvedValue({ enabled: false }) });
    await createReleaseHandler({ ...OPTS, api: a, fetchImpl: ghFetch({}) as unknown as typeof fetch }).handle(evt());
    expect(a.getTask).not.toHaveBeenCalled();
  });
});
