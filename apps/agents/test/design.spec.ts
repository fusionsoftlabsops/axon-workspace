import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDesignHandler } from '../src/roles/design.js';
import type { AxonApi } from '../src/api/client.js';
import type { DomainEventV1 } from '../src/events.js';

function api(over: Partial<Record<string, unknown>> = {}): AxonApi {
  return {
    getMe: vi.fn().mockResolvedValue({ enabled: true, role: 'DESIGN' }),
    getTask: vi.fn().mockResolvedValue({
      state: 'Preparación',
      title: 'Rediseñar la pantalla de login',
      acceptanceCriteria: '- [ ] criterio',
      designSpec: '',
    }),
    designTask: vi.fn().mockResolvedValue({ ok: true, design: { notes: 'n', mockupFileId: 'f1' } }),
    comment: vi.fn().mockResolvedValue({ id: 'c1' }),
    postTeamChat: vi.fn().mockResolvedValue({ message: { id: 'tc' } }),
    ...over,
  } as unknown as AxonApi;
}

function evt(over: Partial<DomainEventV1> = {}): DomainEventV1 {
  return { v: 1, type: 'story.refined', projectId: 'p1', storyId: 't1', storyNumber: 40, actorId: 'po', ts: 'now', ...over };
}

const OPTS = { projectId: 'p1', projectSlug: 'axon' };

beforeEach(() => vi.restoreAllMocks());

describe('createDesignHandler.matches', () => {
  it('acepta story.refined/created y state_changed→TODO del proyecto', () => {
    const h = createDesignHandler({ ...OPTS, api: api() });
    expect(h.matches(evt())).toBe(true);
    expect(h.matches(evt({ type: 'story.created' }))).toBe(true);
    expect(h.matches(evt({ type: 'story.state_changed', toState: { id: 's', category: 'TODO' } }))).toBe(true);
    expect(h.matches(evt({ type: 'story.state_changed', toState: { id: 's', category: 'DONE' } }))).toBe(false);
    expect(h.matches(evt({ projectId: 'otro' }))).toBe(false);
  });
});

describe('createDesignHandler.handle', () => {
  it('diseña una HU de UI refinada sin diseño (IA + comentario + narración)', async () => {
    const a = api();
    await createDesignHandler({ ...OPTS, api: a }).handle(evt());
    expect(a.designTask).toHaveBeenCalledWith('axon', 40);
    expect((a.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2]).toContain('spec de diseño');
    const narrated = (a.postTeamChat as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1] as { kind: string };
    expect(narrated).toMatchObject({ kind: 'HANDOFF', storyNumber: 40 });
  });

  it('NO diseña una HU de backend (heurística looksLikeUi)', async () => {
    const a = api({
      getTask: vi.fn().mockResolvedValue({ state: 'Preparación', title: 'Agregar índice a la tabla', acceptanceCriteria: '- [ ] x', designSpec: '' }),
    });
    await createDesignHandler({ ...OPTS, api: a }).handle(evt());
    expect(a.designTask).not.toHaveBeenCalled();
  });

  it('espera al PO si aún no hay criterios (DoR)', async () => {
    const a = api({
      getTask: vi.fn().mockResolvedValue({ state: 'Preparación', title: 'Pantalla de login', acceptanceCriteria: '', designSpec: '' }),
    });
    await createDesignHandler({ ...OPTS, api: a }).handle(evt());
    expect(a.designTask).not.toHaveBeenCalled();
  });

  it('NO re-diseña una HU que ya tiene designSpec', async () => {
    const a = api({
      getTask: vi.fn().mockResolvedValue({ state: 'Preparación', title: 'Pantalla', acceptanceCriteria: '- [ ] x', designSpec: '## Diseño ya hecho' }),
    });
    await createDesignHandler({ ...OPTS, api: a }).handle(evt());
    expect(a.designTask).not.toHaveBeenCalled();
  });

  it('no actúa si el agente está deshabilitado', async () => {
    const a = api({ getMe: vi.fn().mockResolvedValue({ enabled: false }) });
    await createDesignHandler({ ...OPTS, api: a }).handle(evt());
    expect(a.getTask).not.toHaveBeenCalled();
  });
});
