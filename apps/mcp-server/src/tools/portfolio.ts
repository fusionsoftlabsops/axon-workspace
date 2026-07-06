/**
 * Tools de CARTERA multi-proyecto para el supervisor de consola:
 *  - list_projects: descubrir todos los proyectos del usuario (arranque del barrido).
 *  - list_project_tasks: el board publicado de un proyecto (HUs), filtrable por estado.
 *  - get_plan: snapshot de la planeación (idea mejorada, repos sugeridos, resumen).
 *  - get_plan_chat: el hilo del chat de planeación.
 *  - post_plan_chat: participar en la planeación (dispara respuesta de agentes).
 */
import { z } from 'zod';
import { ApiError, type ApiClient } from '../api-client.js';
import type { ToolRegistry } from '../tool-registry.js';

const listProjectsSchema = z.object({});
const listTasksSchema = z.object({
  projectSlug: z.string(),
  state: z.string().optional(),
});
const planSchema = z.object({ projectSlug: z.string() });
const planChatGetSchema = z.object({
  projectSlug: z.string(),
  limit: z.number().int().min(1).max(200).default(40),
});
const planChatPostSchema = z.object({
  projectSlug: z.string(),
  message: z.string().min(1).max(4000),
});

function asText(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  };
}

export function registerPortfolioTools(registry: ToolRegistry, api: ApiClient): void {
  registry.register({
    tool: {
      name: 'list_projects',
      description:
        'Lista TODOS los proyectos donde sos miembro, con rollup por proyecto (HUs abiertas, borradores del ' +
        'plan, agentes activos, corridas en vuelo, preset, ejecutor, tu rol). El arranque del barrido de cartera.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    handler: async (args) => {
      listProjectsSchema.parse(args ?? {});
      return asText(await api.get('/projects'));
    },
  });

  registry.register({
    tool: {
      name: 'list_project_tasks',
      description:
        'El board PUBLICADO de un proyecto: todas las HUs (opcionalmente filtradas por nombre de estado). ' +
        'A diferencia de list_my_tasks, no se limita a las asignadas a vos.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          state: { type: 'string', description: 'Nombre exacto del estado (opcional).' },
        },
        required: ['projectSlug'],
      },
    },
    handler: async (args) => {
      const input = listTasksSchema.parse(args);
      const qs = new URLSearchParams({ project: input.projectSlug });
      if (input.state) qs.set('state', input.state);
      return asText(await api.get(`/tasks?${qs.toString()}`));
    },
  });

  registry.register({
    tool: {
      name: 'get_plan',
      description:
        'Snapshot de SOLO LECTURA de la planeación de un proyecto: estado, idea mejorada, repos sugeridos y ' +
        'resumen del plan ya generado (sprints + nº de HUs). NO dispara generación ni modifica nada; si el ' +
        'proyecto todavía no tiene plan, devuelve un resultado vacío. Para el hilo de la discusión usá get_plan_chat.',
      inputSchema: {
        type: 'object',
        properties: { projectSlug: { type: 'string' } },
        required: ['projectSlug'],
      },
    },
    handler: async (args) => {
      const input = planSchema.parse(args);
      // Solo lectura: el endpoint del plan es un GET puro (no genera ni muta).
      // Devolvemos SOLO el snapshot, sin el hilo de chat (para eso está get_plan_chat).
      try {
        const plan = await api.get<Record<string, unknown>>(`/projects/${input.projectSlug}/plan/chat`);
        const { messages: _messages, ...snapshot } = plan;
        return asText(snapshot);
      } catch (err) {
        // Proyecto sin plan aún: resultado vacío/explicativo, JAMÁS generamos uno.
        if (err instanceof ApiError && err.status === 404) {
          return asText({ plan: null, note: 'El proyecto todavía no tiene un plan generado.' });
        }
        throw err;
      }
    },
  });

  registry.register({
    tool: {
      name: 'get_plan_chat',
      description: 'Los últimos mensajes del chat de planeación (la discusión que da forma a las HUs).',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          limit: { type: 'number', description: 'Máx 200 (default 40).' },
        },
        required: ['projectSlug'],
      },
    },
    handler: async (args) => {
      const input = planChatGetSchema.parse(args);
      return asText(await api.get(`/projects/${input.projectSlug}/plan/chat?limit=${input.limit}`));
    },
  });

  registry.register({
    tool: {
      name: 'post_plan_chat',
      description:
        'Participa en el chat de planeación: envía un mensaje que dispara la respuesta del/los agentes (usá ' +
        '@nombre para dirigirte a uno). Consume LLM. Solo en modo INTERVENTOR (no en auditoría de solo lectura).',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          message: { type: 'string', description: '≤4000 chars. Podés @mencionar un agente.' },
        },
        required: ['projectSlug', 'message'],
      },
    },
    handler: async (args) => {
      const input = planChatPostSchema.parse(args);
      return asText(
        await api.post(`/projects/${input.projectSlug}/plan/chat`, { message: input.message }),
      );
    },
  });
}
