import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSmAssignHandler } from '../src/roles/sm.js';
import type { AxonApi } from '../src/api/client.js';
import type { DomainEventV1 } from '../src/events.js';

function api(over: Partial<Record<string, unknown>> = {}): AxonApi {
  return {
    getMe: vi.fn().mockResolvedValue({ enabled: true, role: 'SM' }),
    getTask: vi.fn().mockResolvedValue({ state: 'Preparación', title: 'HU X', assignee: null }),
    recallBrain: vi.fn().mockResolvedValue({ memories: [{ title: 'gotcha', body: 'usar pnpm' }] }),
    patchTask: vi.fn().mockResolvedValue({ ok: true }),
    comment: vi.fn().mockResolvedValue({ id: 'c1' }),
    ...over,
  } as unknown as AxonApi;
}

function evt(over: Partial<DomainEventV1> = {}): DomainEventV1 {
  return {
    v: 1,
    type: 'story.created',
    projectId: 'p1',
    storyId: 't1',
    storyNumber: 22,
    actorId: 'human',
    ts: 'now',
    ...over,
  };
}

const OPTS = { projectId: 'p1', projectSlug: 'axon' };

beforeEach(() => vi.restoreAllMocks());

describe('createSmAssignHandler.matches', () => {
  it('acepta story.created de SU proyecto y transiciones a TODO', () => {
    const h = createSmAssignHandler({ ...OPTS, api: api() });
    expect(h.matches(evt())).toBe(true);
    expect(h.matches(evt({ type: 'story.state_changed', toState: { id: 's', category: 'TODO' } }))).toBe(true);
  });

  it('rechaza otros proyectos, otros estados y eventos sin número', () => {
    const h = createSmAssignHandler({ ...OPTS, api: api() });
    expect(h.matches(evt({ projectId: 'otro' }))).toBe(false);
    expect(h.matches(evt({ type: 'story.state_changed', toState: { id: 's', category: 'REVIEW' } }))).toBe(false);
    expect(h.matches(evt({ storyNumber: undefined }))).toBe(false);
    expect(h.matches(evt({ type: 'story.commented' }))).toBe(false);
  });
});

describe('createSmAssignHandler.handle', () => {
  it('asigna al Dev, mueve a Desarrollo y comenta con contexto del cerebro', async () => {
    const a = api();
    const h = createSmAssignHandler({ ...OPTS, api: a });
    await h.handle(evt());
    expect(a.patchTask).toHaveBeenCalledWith('axon', 22, { toState: 'Desarrollo', assignToAgentRole: 'DEV' });
    const comment = (a.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2] as string;
    expect(comment).toContain('Agente Dev');
    expect(comment).toContain('gotcha');
    expect(comment).toContain('usar pnpm');
  });

  it('no hace nada si el SM está deshabilitado (kill-switch, cacheado)', async () => {
    const a = api({ getMe: vi.fn().mockResolvedValue({ enabled: false }) });
    const h = createSmAssignHandler({ ...OPTS, api: a });
    await h.handle(evt());
    await h.handle(evt());
    expect(a.patchTask).not.toHaveBeenCalled();
    expect(a.getMe).toHaveBeenCalledTimes(1); // cache
  });

  it('no pisa HUs que ya salieron de Preparación o ya tienen dueño', async () => {
    const a1 = api({ getTask: vi.fn().mockResolvedValue({ state: 'Desarrollo', assignee: null }) });
    await createSmAssignHandler({ ...OPTS, api: a1 }).handle(evt());
    expect(a1.patchTask).not.toHaveBeenCalled();

    const a2 = api({ getTask: vi.fn().mockResolvedValue({ state: 'Preparación', assignee: { id: 'humano' } }) });
    await createSmAssignHandler({ ...OPTS, api: a2 }).handle(evt());
    expect(a2.patchTask).not.toHaveBeenCalled();
  });

  it('asigna igual cuando el recall del cerebro falla (contexto opcional)', async () => {
    const a = api({ recallBrain: vi.fn().mockRejectedValue(new Error('brain down')) });
    const h = createSmAssignHandler({ ...OPTS, api: a });
    await h.handle(evt());
    expect(a.patchTask).toHaveBeenCalled();
    const comment = (a.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2] as string;
    expect(comment).not.toContain('Contexto del cerebro');
  });

  it('getMe que falla se trata como disabled (no revienta el router)', async () => {
    const a = api({ getMe: vi.fn().mockRejectedValue(new Error('403')) });
    const h = createSmAssignHandler({ ...OPTS, api: a });
    await h.handle(evt());
    expect(a.patchTask).not.toHaveBeenCalled();
  });

  it('respeta developmentState custom', async () => {
    const a = api();
    const h = createSmAssignHandler({ ...OPTS, api: a, developmentState: 'Doing' });
    await h.handle(evt());
    expect(a.patchTask).toHaveBeenCalledWith('axon', 22, { toState: 'Doing', assignToAgentRole: 'DEV' });
  });
});
