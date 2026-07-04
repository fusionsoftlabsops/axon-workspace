import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxonApi, AxonApiError } from '../src/api/client.js';

const fetchMock = vi.fn();
const realFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

const api = new AxonApi('http://axon-web:3000/api/v1/', 'ad_pk_dev');

describe('AxonApi', () => {
  it('manda el Bearer del rol y parsea JSON (getMe)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'ag1', role: 'DEV', enabled: true, tokenBudget: 200000 }));
    const me = await api.getMe('axon');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://axon-web:3000/api/v1/projects/axon/agents/me');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ad_pk_dev');
    expect(me.role).toBe('DEV');
  });

  it('openRun/finishRun con bodies correctos', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'r1', tokenBudget: 5000 }, 201));
    await api.openRun('axon', { storyId: 't1' });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({ storyId: 't1' });

    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await api.finishRun('axon', 'r1', { status: 'SUCCEEDED', promptTokens: 1, completionTokens: 2 });
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toContain('/agent-runs/r1');
    expect(init.method).toBe('PATCH');
  });

  it('operaciones de tablero: getTask/patchTask/comment/qaDecision', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await api.patchTask('axon', 7, { toState: 'Desarrollo' });
    await api.comment('axon', 7, 'hola');
    await api.qaDecision('axon', 7, { decision: 'reject', comment: 'falta X' });
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls[0]).toContain('/tasks/7');
    expect(urls[1]).toContain('/tasks/7/comments');
    expect(urls[2]).toContain('/tasks/7/qa-decision');
  });

  it('getTask/submitQaReview apuntan a las rutas correctas', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await api.getTask('axon', 9);
    await api.submitQaReview('axon', 9, { criteria: [] });
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls[0]).toContain('/tasks/9');
    expect(urls[1]).toContain('/tasks/9/qa-review');
    expect(fetchMock.mock.calls[0]![1].method).toBe('GET');
  });

  it('recallBrain codifica la query y codeContext lee el resumen', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ memories: [] }));
    await api.recallBrain('axon', 'redis pub/sub', 5);
    expect(fetchMock.mock.calls[0]![0]).toContain('/brain/recall?q=redis%20pub%2Fsub&limit=5');
    await api.recallBrain('axon');
    expect(fetchMock.mock.calls[1]![0]).toContain('/brain/recall?limit=10');
    await api.codeContext('axon');
    expect(fetchMock.mock.calls[2]![0]).toContain('/context/code');
  });

  it('generateImplPlan pega al endpoint impl-plan de la HU', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, implPlan: '# Plan' }, 201));
    const res = await api.generateImplPlan('axon', 24);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/projects/axon/tasks/24/impl-plan');
    expect(init.method).toBe('POST');
    expect(res.implPlan).toBe('# Plan');
  });

  it('refineTask pega al endpoint refine de la HU', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, refinement: { description: 'd', acceptanceCriteria: '- [ ] c', priority: 'MEDIUM' } }, 201));
    const res = await api.refineTask('axon', 30);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/projects/axon/tasks/30/refine');
    expect(init.method).toBe('POST');
    expect(res.refinement.acceptanceCriteria).toBe('- [ ] c');
  });

  it('postTeamChat manda al hilo del equipo con kind/storyNumber opcionales', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: { id: 'm1' } }, 201));
    await api.postTeamChat('axon', { body: 'Tomo la HU #24', kind: 'HANDOFF', storyNumber: 24 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/projects/axon/team-chat');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ body: 'Tomo la HU #24', kind: 'HANDOFF', storyNumber: 24 });
  });

  it('errores non-2xx suben como AxonApiError con el mensaje del server', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'agent is disabled for this project' }, 403));
    await expect(api.openRun('axon')).rejects.toThrowError(AxonApiError);
    await expect(api.openRun('axon')).rejects.toThrow('agent is disabled');
  });

  it('tolera respuestas no-JSON en error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, text: async () => 'Bad Gateway' });
    await expect(api.getMe('axon')).rejects.toThrow('HTTP 502');
  });
});
