import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createArchitectHandler } from '../src/roles/architect.js';
import type { AxonApi } from '../src/api/client.js';
import type { DomainEventV1 } from '../src/events.js';

const COMPLEX_CRITERIA = ['a', 'b', 'c', 'd', 'e'].map((x) => `- [ ] ${x}`).join('\n');

function api(over: Partial<Record<string, unknown>> = {}): AxonApi {
  return {
    getMe: vi.fn().mockResolvedValue({ enabled: true, role: 'ARCHITECT' }),
    getTask: vi.fn().mockResolvedValue({
      state: 'Preparación',
      title: 'HU compleja',
      acceptanceCriteria: COMPLEX_CRITERIA,
      priority: 'HIGH',
      techDesign: '',
    }),
    techDesign: vi.fn().mockResolvedValue({ ok: true, design: '## Arquitectura...' }),
    comment: vi.fn().mockResolvedValue({ id: 'c1' }),
    postTeamChat: vi.fn().mockResolvedValue({ message: { id: 'tc' } }),
    ...over,
  } as unknown as AxonApi;
}

function evt(over: Partial<DomainEventV1> = {}): DomainEventV1 {
  return { v: 1, type: 'story.refined', projectId: 'p1', storyId: 't1', storyNumber: 50, actorId: 'po', ts: 'now', ...over };
}
const OPTS = { projectId: 'p1', projectSlug: 'axon' };

beforeEach(() => vi.restoreAllMocks());

describe('createArchitectHandler', () => {
  it('matches story.refined/created del proyecto', () => {
    const h = createArchitectHandler({ ...OPTS, api: api() });
    expect(h.matches(evt())).toBe(true);
    expect(h.matches(evt({ type: 'story.created' }))).toBe(true);
    expect(h.matches(evt({ type: 'story.state_changed' }))).toBe(false);
    expect(h.matches(evt({ projectId: 'otro' }))).toBe(false);
  });

  it('genera el diseño técnico de una HU compleja refinada', async () => {
    const a = api();
    await createArchitectHandler({ ...OPTS, api: a }).handle(evt());
    expect(a.techDesign).toHaveBeenCalledWith('axon', 50);
    expect((a.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2]).toContain('diseño técnico');
  });

  it('NO actúa en una HU NO compleja', async () => {
    const a = api({ getTask: vi.fn().mockResolvedValue({ state: 'Preparación', title: 'HU simple', acceptanceCriteria: '- [ ] uno', priority: 'LOW', techDesign: '' }) });
    await createArchitectHandler({ ...OPTS, api: a }).handle(evt());
    expect(a.techDesign).not.toHaveBeenCalled();
  });

  it('espera al PO si no hay criterios, y no re-diseña si ya hay techDesign', async () => {
    const sinCrit = api({ getTask: vi.fn().mockResolvedValue({ state: 'Preparación', acceptanceCriteria: '', priority: 'URGENT', techDesign: '' }) });
    await createArchitectHandler({ ...OPTS, api: sinCrit }).handle(evt());
    expect(sinCrit.techDesign).not.toHaveBeenCalled();

    const yaTiene = api({ getTask: vi.fn().mockResolvedValue({ state: 'Preparación', acceptanceCriteria: COMPLEX_CRITERIA, priority: 'HIGH', techDesign: '## ya' }) });
    await createArchitectHandler({ ...OPTS, api: yaTiene }).handle(evt());
    expect(yaTiene.techDesign).not.toHaveBeenCalled();
  });

  it('deshabilitado → no actúa', async () => {
    const a = api({ getMe: vi.fn().mockResolvedValue({ enabled: false }) });
    await createArchitectHandler({ ...OPTS, api: a }).handle(evt());
    expect(a.getTask).not.toHaveBeenCalled();
  });
});
