import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMarketingHandler } from '../src/roles/marketing.js';
import type { AxonApi } from '../src/api/client.js';
import type { DomainEventV1 } from '../src/events.js';

function api(over: Partial<Record<string, unknown>> = {}): AxonApi {
  return {
    getMe: vi.fn().mockResolvedValue({ enabled: true, role: 'MARKETING' }),
    getTask: vi.fn().mockResolvedValue({
      state: 'Preparación',
      title: 'Landing de lanzamiento del producto',
      acceptanceCriteria: '- [ ] copy',
      marketingKit: '',
    }),
    marketingKit: vi.fn().mockResolvedValue({ ok: true, marketing: { kit: 'copy', assetFileId: 'f1' } }),
    comment: vi.fn().mockResolvedValue({ id: 'c1' }),
    postTeamChat: vi.fn().mockResolvedValue({ message: { id: 'tc' } }),
    ...over,
  } as unknown as AxonApi;
}
function evt(over: Partial<DomainEventV1> = {}): DomainEventV1 {
  return { v: 1, type: 'story.refined', projectId: 'p1', storyId: 't1', storyNumber: 60, actorId: 'po', ts: 'now', ...over };
}
const OPTS = { projectId: 'p1', projectSlug: 'axon' };

beforeEach(() => vi.restoreAllMocks());

describe('createMarketingHandler', () => {
  it('matches story.refined/created del proyecto', () => {
    const h = createMarketingHandler({ ...OPTS, api: api() });
    expect(h.matches(evt())).toBe(true);
    expect(h.matches(evt({ type: 'story.created' }))).toBe(true);
    expect(h.matches(evt({ type: 'story.state_changed' }))).toBe(false);
  });

  it('genera el kit para una HU de marketing refinada', async () => {
    const a = api();
    await createMarketingHandler({ ...OPTS, api: a }).handle(evt());
    expect(a.marketingKit).toHaveBeenCalledWith('axon', 60);
    expect((a.comment as ReturnType<typeof vi.fn>).mock.calls[0]![2]).toContain('kit de marketing');
  });

  it('NO actúa en una HU que no es de marketing', async () => {
    const a = api({ getTask: vi.fn().mockResolvedValue({ state: 'Preparación', title: 'Agregar índice a la tabla', acceptanceCriteria: '- [ ] x', marketingKit: '' }) });
    await createMarketingHandler({ ...OPTS, api: a }).handle(evt());
    expect(a.marketingKit).not.toHaveBeenCalled();
  });

  it('no re-genera si ya hay kit; espera al PO si no hay criterios; disabled → nada', async () => {
    const yaTiene = api({ getTask: vi.fn().mockResolvedValue({ state: 'Preparación', title: 'Landing', acceptanceCriteria: '- [ ] x', marketingKit: '## ya' }) });
    await createMarketingHandler({ ...OPTS, api: yaTiene }).handle(evt());
    expect(yaTiene.marketingKit).not.toHaveBeenCalled();

    const sinCrit = api({ getTask: vi.fn().mockResolvedValue({ state: 'Preparación', title: 'Landing SEO', acceptanceCriteria: '', marketingKit: '' }) });
    await createMarketingHandler({ ...OPTS, api: sinCrit }).handle(evt());
    expect(sinCrit.marketingKit).not.toHaveBeenCalled();

    const off = api({ getMe: vi.fn().mockResolvedValue({ enabled: false }) });
    await createMarketingHandler({ ...OPTS, api: off }).handle(evt());
    expect(off.getTask).not.toHaveBeenCalled();
  });
});
