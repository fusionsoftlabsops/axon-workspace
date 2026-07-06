import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventRouter } from '../src/router.js';
import { createRuntimeRegistry } from '../src/runtime/registry.js';
import { loadConfig } from '../src/config.js';

const BASE_ENV = {
  AGENTS_ENABLED: 'true',
  AGENT_RUNTIME_TOKEN: 'ad_pk_runtime',
  ANTHROPIC_API_KEY: 'sk-ant',
  FUSION_MODEL_URL: 'http://qwen:8000/v1',
  FUSION_TOKEN: 'fusion-tok',
};

function runtimePayload() {
  return {
    projects: [
      {
        projectId: 'p-axon',
        slug: 'axon',
        agents: [
          { role: 'SM', enabled: true, llmModel: 'claude-sonnet-5', token: 't-sm' },
          { role: 'QA', enabled: true, llmModel: 'claude-opus-4-8', token: 't-qa' },
          { role: 'DEV', enabled: true, llmModel: 'qwen3-coder-next', token: 't-dev' },
          { role: 'PO', enabled: false, llmModel: 'claude-sonnet-5', token: 't-po' }, // apagado → no cuenta
        ],
      },
      {
        projectId: 'p-forge',
        slug: 'forgeia',
        agents: [{ role: 'REVIEWER', enabled: true, llmModel: 'claude-sonnet-5', token: 't-rev' }],
      },
    ],
  };
}

// fetch inyectado en el registry (DIP): sin tocar el global.
const fetchMock = vi.fn();
const fetchFn = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  fetchMock.mockReset();
});

describe('runtime registry (multi-tenant)', () => {
  it('trae los equipos, filtra apagados y publica handlers de todos los proyectos', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => runtimePayload() });
    const router = new EventRouter();
    const reg = createRuntimeRegistry(loadConfig(BASE_ENV), router, { fetchFn });
    const r = await reg.refresh();

    // llama al endpoint con el bearer del runtime
    expect(fetchMock.mock.calls[0]![0]).toContain('/internal/agent-runtime');
    expect((fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }).headers.authorization).toBe(
      'Bearer ad_pk_runtime',
    );
    expect(r.projects).toBe(2);
    // axon: SM(assign+retro+sweep)+QA+DEV(+strong)  ·  forgeia: REVIEWER  → router poblado
    expect(router.size).toBeGreaterThanOrEqual(5);
    // el summary nombra ambos proyectos
    expect(r.summary.join(' ')).toContain('axon:');
    expect(r.summary.join(' ')).toContain('forgeia:');
  });

  it('el refresco reemplaza los handlers (proyecto que desaparece se va)', async () => {
    const router = new EventRouter();
    const reg = createRuntimeRegistry(loadConfig(BASE_ENV), router, { fetchFn });
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => runtimePayload() });
    await reg.refresh();
    const first = router.size;
    // ahora el endpoint devuelve vacío → router queda sin handlers
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    await reg.refresh();
    expect(first).toBeGreaterThan(0);
    expect(router.size).toBe(0);
  });

  it('propaga error si el endpoint falla', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const reg = createRuntimeRegistry(loadConfig(BASE_ENV), new EventRouter(), { fetchFn });
    await expect(reg.refresh()).rejects.toThrow('agent-runtime 401');
  });
});
