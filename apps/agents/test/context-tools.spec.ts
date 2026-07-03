import { describe, it, expect, vi } from 'vitest';
import { contextTools } from '../src/tools/context.js';
import type { AxonApi } from '../src/api/client.js';

function api(over: Partial<Record<string, unknown>> = {}): AxonApi {
  return {
    recallBrain: vi.fn().mockResolvedValue({ memories: [{ title: 'gotcha X' }] }),
    codeContext: vi.fn().mockResolvedValue({ status: 'READY', summary: 'mapa', godNodes: [] }),
    getTask: vi.fn().mockResolvedValue({ number: 7, title: 'HU 7', state: 'Desarrollo' }),
    ...over,
  } as unknown as AxonApi;
}

describe('contextTools', () => {
  it('expone las 3 tools de contexto con JSON Schema', () => {
    const tools = contextTools(api(), 'axon');
    expect(tools.map((t) => t.name)).toEqual(['recall_brain', 'code_graph', 'get_story']);
    for (const t of tools) expect(t.inputSchema).toHaveProperty('type', 'object');
  });

  it('recall_brain pasa query/limit y devuelve JSON string', async () => {
    const a = api();
    const [recall] = contextTools(a, 'axon');
    const out = await recall!.execute({ query: 'redis', limit: 5 });
    expect(a.recallBrain).toHaveBeenCalledWith('axon', 'redis', 5);
    expect(JSON.parse(out)).toMatchObject({ memories: [{ title: 'gotcha X' }] });
  });

  it('recall_brain sin input usa defaults', async () => {
    const a = api();
    const [recall] = contextTools(a, 'axon');
    await recall!.execute(undefined);
    expect(a.recallBrain).toHaveBeenCalledWith('axon', undefined, 10);
  });

  it('code_graph devuelve el resumen del análisis', async () => {
    const a = api();
    const tools = contextTools(a, 'axon');
    const out = await tools[1]!.execute({});
    expect(JSON.parse(out).summary).toBe('mapa');
  });

  it('get_story valida el número y lee la HU', async () => {
    const a = api();
    const tools = contextTools(a, 'axon');
    await expect(tools[2]!.execute({})).rejects.toThrow('entero positivo');
    await expect(tools[2]!.execute({ number: -1 })).rejects.toThrow('entero positivo');
    const out = await tools[2]!.execute({ number: 7 });
    expect(a.getTask).toHaveBeenCalledWith('axon', 7);
    expect(JSON.parse(out).title).toBe('HU 7');
  });

  it('los errores de API suben como excepción (el runtime los vuelve ERROR)', async () => {
    const a = api({ codeContext: vi.fn().mockRejectedValue(new Error('503')) });
    const tools = contextTools(a, 'axon');
    await expect(tools[1]!.execute({})).rejects.toThrow('503');
  });
});
