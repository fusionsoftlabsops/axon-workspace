/**
 * Tools de INTEGRACIÓN DE CONSOLA (modo híbrido): permiten que un dev humano
 * trabaje HUs desde su consola (Claude Code + este MCP) como ejecutor de
 * desarrollo, en lugar del agente Kai:
 *  - Leer/escribir el chat del equipo (detectar rechazos de QA, avisar avances).
 *  - Ver la cola de desarrollo (HUs en curso listas para la consola).
 *  - Generar el plan de implementación grounded (el mismo que usa Kai).
 */
import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { ToolRegistry } from '../tool-registry.js';

const chatListSchema = z.object({
  projectSlug: z.string(),
  limit: z.number().int().min(1).max(200).default(30),
});
const chatPostSchema = z.object({
  projectSlug: z.string(),
  body: z.string().min(1).max(4000),
  storyNumber: z.number().int().positive().optional(),
});
const queueSchema = z.object({
  projectSlug: z.string(),
});
const implPlanSchema = z.object({
  projectSlug: z.string(),
  taskNumber: z.number().int().positive(),
});

function asText(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  };
}

export function registerTeamTools(registry: ToolRegistry, api: ApiClient): void {
  registry.register({
    tool: {
      name: 'get_team_chat',
      description:
        'Lee los últimos mensajes del chat del equipo (el standup permanente donde los agentes narran su trabajo). ' +
        'Usalo para detectar rechazos de QA (🤖 QA rechazó la HU #N), handoffs y estados en vivo.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          limit: { type: 'number', description: 'Cantidad de mensajes (default 30, máx 200).' },
        },
        required: ['projectSlug'],
      },
    },
    handler: async (args) => {
      const input = chatListSchema.parse(args);
      return asText(await api.get(`/projects/${input.projectSlug}/team-chat?limit=${input.limit}`));
    },
  });

  registry.register({
    tool: {
      name: 'post_team_chat',
      description:
        'Publica un mensaje en el chat del equipo (como el llamador del token). Usalo para avisar que tomás una HU ' +
        'desde tu consola, reportar avance o coordinar con los agentes.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          body: { type: 'string' },
          storyNumber: { type: 'number', description: 'HU relacionada (opcional).' },
        },
        required: ['projectSlug', 'body'],
      },
    },
    handler: async (args) => {
      const input = chatPostSchema.parse(args);
      return asText(
        await api.post(`/projects/${input.projectSlug}/team-chat`, {
          body: input.body,
          ...(input.storyNumber ? { storyNumber: input.storyNumber } : {}),
        }),
      );
    },
  });

  registry.register({
    tool: {
      name: 'list_dev_queue',
      description:
        'Cola de desarrollo: HUs actualmente en estados EN CURSO (ej. Desarrollo) con su asignado. En modo ' +
        'CONSOLE/HYBRID, acá aparecen las HUs que el SM dejó listas para trabajar desde tu consola.',
      inputSchema: {
        type: 'object',
        properties: { projectSlug: { type: 'string' } },
        required: ['projectSlug'],
      },
    },
    handler: async (args) => {
      const input = queueSchema.parse(args);
      const res = (await api.get(`/projects/${input.projectSlug}/tasks`)) as {
        tasks?: Array<{ number: number; title: string; state: string; stateCategory: string; assignee: { name: string } | null }>;
      };
      const queue = (res.tasks ?? []).filter((t) => t.stateCategory === 'IN_PROGRESS');
      return asText({ queue, count: queue.length });
    },
  });

  registry.register({
    tool: {
      name: 'generate_impl_plan',
      description:
        'Genera (IA server-side) el plan de implementación de una HU, grounded en el árbol real del repo — el mismo ' +
        'contexto técnico que usa el agente Dev. Queda persistido en la HU y se devuelve el markdown.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          taskNumber: { type: 'number' },
        },
        required: ['projectSlug', 'taskNumber'],
      },
    },
    handler: async (args) => {
      const input = implPlanSchema.parse(args);
      return asText(
        await api.post(`/projects/${input.projectSlug}/tasks/${input.taskNumber}/impl-plan`, { lang: 'es' }),
      );
    },
  });
}
