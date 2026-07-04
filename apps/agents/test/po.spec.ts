import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPoHandler } from '../src/roles/po.js';
import type { AxonApi } from '../src/api/client.js';
import type { DomainEventV1 } from '../src/events.js';

function api(over: Partial<Record<string, unknown>> = {}): AxonApi {
  return {
    getMe: vi.fn().mockResolvedValue({ enabled: true, role: 'PO' }),
    getTask: vi.fn().mockResolvedValue({ state: 'Preparación', title: 'HU X', acceptanceCriteria: '' }),
    refineTask: vi.fn().mockResolvedValue({ ok: true, refinement: { description: 'd', acceptanceCriteria: '- [ ] c', priority: 'MEDIUM' } }),
    comment: vi.fn().mockResolvedValue({ id: 'c1' }),
    postTeamChat: vi.fn().mockResolvedValue({ message: { id: 'tc' } }),
    ...over,
  } as unknown as AxonApi;
}

function evt(over: Partial<DomainEventV1> = {}): DomainEventV1 {
  return { v: 1, type: 'story.created', projectId: 'p1', storyId: 't1', storyNumber: 30, actorId: 'human', ts: 'now', ...over };
}

const OPTS = { projectId: 'p1', projectSlug: 'axon' };

beforeEach(() => vi.restoreAllMocks());

describe('createPoHandler.matches', () => {
  it('acepta story.created, y state_changed a TODO (backlog) o DONE (DoD)', () => {
    const h = createPoHandler({ ...OPTS, api: api() });
    expect(h.matches(evt())).toBe(true);
    expect(h.matches(evt({ type: 'story.state_changed', toState: { id: 's', category: 'TODO' } }))).toBe(true);
    expect(h.matches(evt({ type: 'story.state_changed', toState: { id: 's', category: 'DONE' } }))).toBe(true);
  });
  it('rechaza otros proyectos, IN_PROGRESS y refined/commented', () => {
    const h = createPoHandler({ ...OPTS, api: api() });
    expect(h.matches(evt({ projectId: 'otro' }))).toBe(false);
    expect(h.matches(evt({ type: 'story.state_changed', toState: { id: 's', category: 'IN_PROGRESS' } }))).toBe(false);
    expect(h.matches(evt({ type: 'story.refined' as never }))).toBe(false);
    expect(h.matches(evt({ storyNumber: undefined }))).toBe(false);
  });
});

describe('createPoHandler.handle — DoR (refinamiento)', () => {
  it('refina una HU del backlog SIN criterios (IA + comentario + narración)', async () => {
    const a = api();
    await createPoHandler({ ...OPTS, api: a }).handle(evt());
    expect(a.refineTask).toHaveBeenCalledWith('axon', 30);
    expect((a.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2]).toContain('Definition of Ready');
    const narrated = (a.postTeamChat as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1] as { kind: string; body: string };
    expect(narrated).toMatchObject({ kind: 'HANDOFF', storyNumber: 30 });
    expect(narrated.body).toContain('DoR');
  });

  it('NO refina una HU que ya trae criterios (nada que hacer)', async () => {
    const a = api({ getTask: vi.fn().mockResolvedValue({ state: 'Preparación', acceptanceCriteria: '- [ ] ya está' }) });
    await createPoHandler({ ...OPTS, api: a }).handle(evt());
    expect(a.refineTask).not.toHaveBeenCalled();
  });

  it('NO refina si la HU ya salió del backlog', async () => {
    const a = api({ getTask: vi.fn().mockResolvedValue({ state: 'Desarrollo', acceptanceCriteria: '' }) });
    await createPoHandler({ ...OPTS, api: a }).handle(evt());
    expect(a.refineTask).not.toHaveBeenCalled();
  });
});

describe('createPoHandler.handle — DoD (aceptación)', () => {
  it('firma la aceptación cuando la HU llega a DONE', async () => {
    const a = api({ getTask: vi.fn().mockResolvedValue({ state: 'Terminada', title: 'HU X', acceptanceCriteria: '- [ ] c' }) });
    await createPoHandler({ ...OPTS, api: a }).handle(
      evt({ type: 'story.state_changed', toState: { id: 's', category: 'DONE' } }),
    );
    expect(a.refineTask).not.toHaveBeenCalled();
    expect((a.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2]).toContain('Definition of Done');
    const narrated = (a.postTeamChat as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1] as { body: string };
    expect(narrated.body).toContain('DoD');
  });
});

describe('createPoHandler — kill switch', () => {
  it('PO deshabilitado no actúa', async () => {
    const a = api({ getMe: vi.fn().mockResolvedValue({ enabled: false }) });
    await createPoHandler({ ...OPTS, api: a }).handle(evt());
    expect(a.getTask).not.toHaveBeenCalled();
    expect(a.refineTask).not.toHaveBeenCalled();
  });
});
