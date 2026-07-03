/**
 * Herramientas de CONTEXTO (solo lectura) compartidas por los 3 roles: cerebro
 * del proyecto (memorias del equipo) y grafo de código (CodeAnalysis). Los
 * errores suben como excepción y el runtime los devuelve al modelo como
 * tool_result "ERROR: ..." — el agente decide cómo seguir.
 */
import type { AxonApi } from '../api/client.js';
import type { ToolDef } from '../runtime/types.js';

export function contextTools(api: AxonApi, projectSlug: string): ToolDef[] {
  return [
    {
      name: 'recall_brain',
      description:
        'Busca en el cerebro del proyecto (decisiones, gotchas, patrones y runbooks del equipo). ' +
        'Usalo antes de decidir algo que otro pudo haber resuelto ya.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Texto a buscar (vacío = últimas memorias)' },
          limit: { type: 'number', description: 'Máximo de memorias (default 10)' },
        },
      },
      async execute(input: unknown): Promise<string> {
        const { query, limit } = (input ?? {}) as { query?: string; limit?: number };
        const res = await api.recallBrain(projectSlug, query, limit ?? 10);
        return JSON.stringify(res);
      },
    },
    {
      name: 'code_graph',
      description:
        'Resumen del grafo de código real del proyecto (módulos, conceptos centrales, tamaño). ' +
        'Usalo para anclar decisiones técnicas en el código existente.',
      inputSchema: { type: 'object', properties: {} },
      async execute(): Promise<string> {
        const res = await api.codeContext(projectSlug);
        return JSON.stringify(res);
      },
    },
    {
      name: 'get_story',
      description: 'Lee una HU del tablero (título, descripción, estado, comentarios, subtareas).',
      inputSchema: {
        type: 'object',
        required: ['number'],
        properties: { number: { type: 'number', description: 'Número de la HU (ej. 7)' } },
      },
      async execute(input: unknown): Promise<string> {
        const { number } = (input ?? {}) as { number?: number };
        if (!number || !Number.isInteger(number) || number < 1) {
          throw new Error('number debe ser un entero positivo');
        }
        const res = await api.getTask(projectSlug, number);
        return JSON.stringify(res);
      },
    },
  ];
}
