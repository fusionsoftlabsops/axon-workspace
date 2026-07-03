import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSmRetroHandler, RETRO_TAG } from '../src/roles/sm-retro.js';
import type { AxonApi } from '../src/api/client.js';
import type { DomainEventV1 } from '../src/events.js';
import type { LlmProvider } from '../src/runtime/types.js';

function provider(text: string): LlmProvider {
  return {
    complete: vi.fn().mockResolvedValue({
      content: text,
      toolCalls: [],
      usage: { promptTokens: 50, completionTokens: 30 },
      stopReason: 'stop',
    }),
  };
}

function api(over: Partial<Record<string, unknown>> = {}): AxonApi {
  return {
    getMe: vi.fn().mockResolvedValue({ enabled: true }),
    getTask: vi.fn().mockResolvedValue({ title: 'HU', comments: [] }),
    openRun: vi.fn().mockResolvedValue({ id: 'r1', tokenBudget: 10000 }),
    finishRun: vi.fn().mockResolvedValue({ ok: true }),
    captureMemory: vi.fn().mockResolvedValue({ id: 'm1' }),
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
    storyId: 't1',
    storyNumber: 5,
    toState: { id: 's-done', name: 'Terminada', category: 'DONE' },
    actorId: 'u-qa',
    ts: 'now',
    ...over,
  };
}

const P = provider('{"title": "Retro HU 5", "body": "- Se entregó X\\n- Aprendimos Y"}');
const OPTS = { projectId: 'p1', projectSlug: 'axon' };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('createSmRetroHandler', () => {
  it('matches solo transiciones a DONE de su proyecto y con provider', () => {
    const h = createSmRetroHandler({ ...OPTS, api: api(), provider: P });
    expect(h.matches(evt())).toBe(true);
    expect(h.matches(evt({ toState: { id: 'x', category: 'REVIEW' } }))).toBe(false);
    expect(h.matches(evt({ projectId: 'otro' }))).toBe(false);
    expect(h.matches(evt({ type: 'story.created' }))).toBe(false);
    const sinLlm = createSmRetroHandler({ ...OPTS, api: api() });
    expect(sinLlm.matches(evt())).toBe(false);
  });

  it('publica la retro como memoria PROJECT con tag y sourceTaskNumber', async () => {
    const a = api();
    await createSmRetroHandler({ ...OPTS, api: a, provider: P }).handle(evt());
    expect(a.captureMemory).toHaveBeenCalledWith('axon', {
      type: 'NOTE',
      title: 'Retro HU 5',
      body: '- Se entregó X\n- Aprendimos Y',
      tags: [RETRO_TAG],
      scope: 'PROJECT',
      sourceTaskNumber: 5,
    });
  });

  it('tolera JSON envuelto en prosa y cae al texto completo si no hay JSON', async () => {
    const a1 = api();
    await createSmRetroHandler({
      ...OPTS,
      api: a1,
      provider: provider('Acá va: {"title":"T","body":"B"} listo'),
    }).handle(evt());
    expect((a1.captureMemory as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({ title: 'T', body: 'B' });

    const a2 = api();
    await createSmRetroHandler({ ...OPTS, api: a2, provider: provider('retro en prosa sin json') }).handle(evt());
    expect((a2.captureMemory as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({
      title: 'Retro HU #5',
      body: 'retro en prosa sin json',
    });
  });

  it('no publica cuando el SM está deshabilitado o la corrida no fue SUCCEEDED', async () => {
    const off = api({ getMe: vi.fn().mockResolvedValue({ enabled: false }) });
    await createSmRetroHandler({ ...OPTS, api: off, provider: P }).handle(evt());
    expect(off.captureMemory).not.toHaveBeenCalled();

    const a = api({ openRun: vi.fn().mockResolvedValue({ id: 'r', tokenBudget: 10 }) }); // presupuesto ínfimo
    await createSmRetroHandler({ ...OPTS, api: a, provider: P }).handle(evt());
    expect(a.captureMemory).not.toHaveBeenCalled(); // BUDGET_EXCEEDED
  });
});
