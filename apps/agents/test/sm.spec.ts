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
    postTeamChat: vi.fn().mockResolvedValue({ message: { id: 'tc1' } }),
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

    const narrated = (a.postTeamChat as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(narrated[0]).toBe('axon');
    expect(narrated[1]).toMatchObject({ kind: 'HANDOFF', storyNumber: 22 });
    expect(narrated[1].body).toContain('HU X');
    expect(narrated[1].body).toContain('Dev');
  });

  it('no hace nada si el SM está deshabilitado (kill-switch, cacheado)', async () => {
    const a = api({ getMe: vi.fn().mockResolvedValue({ enabled: false }) });
    const h = createSmAssignHandler({ ...OPTS, api: a });
    await h.handle(evt());
    await h.handle(evt());
    expect(a.patchTask).not.toHaveBeenCalled();
    expect(a.getMe).toHaveBeenCalledTimes(1); // cache
  });

  it('no pisa HUs que ya salieron de Preparación ni con dueño humano DELIBERADO', async () => {
    const a1 = api({ getTask: vi.fn().mockResolvedValue({ state: 'Desarrollo', assignee: null }) });
    await createSmAssignHandler({ ...OPTS, api: a1 }).handle(evt());
    expect(a1.patchTask).not.toHaveBeenCalled();

    // Delegación deliberada: asignada a alguien DISTINTO del creador → respetar.
    const a2 = api({
      getTask: vi.fn().mockResolvedValue({
        state: 'Preparación',
        assignee: { id: 'ana' },
        reporter: { id: 'manuel' },
      }),
    });
    await createSmAssignHandler({ ...OPTS, api: a2 }).handle(evt());
    expect(a2.patchTask).not.toHaveBeenCalled();
  });

  it('con PO activo, DIFIERE una HU sin criterios (gate de DoR) y asigna la refinada', async () => {
    // Sin criterios → el SM espera al PO (no asigna).
    const sinCriterios = api({
      getTask: vi.fn().mockResolvedValue({ state: 'Preparación', title: 'HU', assignee: null, acceptanceCriteria: '' }),
    });
    await createSmAssignHandler({ ...OPTS, api: sinCriterios, poEnabled: true }).handle(evt());
    expect(sinCriterios.patchTask).not.toHaveBeenCalled();

    // Con criterios (el PO ya refinó) → asigna. Dispara vía story.refined.
    const refinada = api({
      getTask: vi.fn().mockResolvedValue({
        state: 'Preparación',
        title: 'HU',
        assignee: null,
        acceptanceCriteria: '- [ ] criterio listo',
      }),
    });
    await createSmAssignHandler({ ...OPTS, api: refinada, poEnabled: true }).handle(
      evt({ type: 'story.refined' as never }),
    );
    expect(refinada.patchTask).toHaveBeenCalledWith('axon', 22, { toState: 'Desarrollo', assignToAgentRole: 'DEV' });
  });

  it('SIN PO, asigna aunque falten criterios (cero regresión)', async () => {
    const a = api({
      getTask: vi.fn().mockResolvedValue({ state: 'Preparación', title: 'HU', assignee: null, acceptanceCriteria: '' }),
    });
    await createSmAssignHandler({ ...OPTS, api: a /* poEnabled: false */ }).handle(evt());
    expect(a.patchTask).toHaveBeenCalledWith('axon', 22, { toState: 'Desarrollo', assignToAgentRole: 'DEV' });
  });

  it('con Diseño activo, DIFIERE una HU de UI sin designSpec y asigna cuando ya está diseñada', async () => {
    // HU de UI refinada pero sin diseño → el SM espera a Aria (no asigna).
    const sinDiseno = api({
      getTask: vi.fn().mockResolvedValue({
        state: 'Preparación',
        title: 'Rediseñar la pantalla de login',
        assignee: null,
        acceptanceCriteria: '- [ ] x',
        designSpec: '',
      }),
    });
    await createSmAssignHandler({ ...OPTS, api: sinDiseno, designEnabled: true }).handle(evt());
    expect(sinDiseno.patchTask).not.toHaveBeenCalled();

    // Ya diseñada (Aria terminó) → asigna. Dispara vía story.designed.
    const disenada = api({
      getTask: vi.fn().mockResolvedValue({
        state: 'Preparación',
        title: 'Rediseñar la pantalla de login',
        assignee: null,
        acceptanceCriteria: '- [ ] x',
        designSpec: '## Diseño (Aria)\nnotas…',
      }),
    });
    await createSmAssignHandler({ ...OPTS, api: disenada, designEnabled: true }).handle(
      evt({ type: 'story.designed' as never }),
    );
    expect(disenada.patchTask).toHaveBeenCalledWith('axon', 22, { toState: 'Desarrollo', assignToAgentRole: 'DEV' });
  });

  it('con Diseño activo, una HU de backend se asigna directo (no espera diseño)', async () => {
    const a = api({
      getTask: vi.fn().mockResolvedValue({
        state: 'Preparación',
        title: 'Agregar índice a la tabla de usuarios',
        assignee: null,
        acceptanceCriteria: '- [ ] x',
        designSpec: '',
      }),
    });
    await createSmAssignHandler({ ...OPTS, api: a, designEnabled: true }).handle(evt());
    expect(a.patchTask).toHaveBeenCalledWith('axon', 22, { toState: 'Desarrollo', assignToAgentRole: 'DEV' });
  });

  it('reclama una HU AUTO-asignada al crear (assignee === reporter) — create_task / quick-add', async () => {
    // create_task (MCP) y el quick-add del tablero asignan la HU al creador;
    // eso NO es un dueño real, así que el SM la levanta igual y se la pasa al Dev.
    const a = api({
      getTask: vi.fn().mockResolvedValue({
        state: 'Preparación',
        title: 'HU nueva',
        assignee: { id: 'manuel' },
        reporter: { id: 'manuel' },
      }),
    });
    await createSmAssignHandler({ ...OPTS, api: a }).handle(evt());
    expect(a.patchTask).toHaveBeenCalledWith('axon', 22, { toState: 'Desarrollo', assignToAgentRole: 'DEV' });
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
