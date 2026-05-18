import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { ToolRegistry } from '../tool-registry.js';

const listSchema = z.object({
  projectSlug: z.string().optional(),
  state: z.string().optional(),
});
const getSchema = z.object({
  projectSlug: z.string(),
  taskNumber: z.number().int().positive(),
});
const updateStatusSchema = z.object({
  projectSlug: z.string(),
  taskNumber: z.number().int().positive(),
  toState: z.string(),
});
const createSchema = z.object({
  projectSlug: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  parentTaskNumber: z.number().int().positive().optional(),
});
const addCommentSchema = z.object({
  projectSlug: z.string(),
  taskNumber: z.number().int().positive(),
  body: z.string().min(1).max(20_000),
});

function asText(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  };
}

export function registerTaskTools(registry: ToolRegistry, api: ApiClient) {
  registry.register({
    tool: {
      name: 'list_my_tasks',
      description:
        'Lista las tareas asignadas al usuario actual. Útil al iniciar una sesión de trabajo.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: {
            type: 'string',
            description: 'Slug del proyecto. Si se omite, todos los proyectos.',
          },
          state: { type: 'string', description: 'Filtrar por nombre de estado.' },
        },
      },
    },
    handler: async (args) => {
      const input = listSchema.parse(args ?? {});
      const qs = new URLSearchParams({ assignedToMe: 'true' });
      if (input.projectSlug) qs.set('project', input.projectSlug);
      if (input.state) qs.set('state', input.state);
      return asText(await api.get(`/tasks?${qs.toString()}`));
    },
  });

  registry.register({
    tool: {
      name: 'get_task',
      description:
        'Lee los detalles de una tarea (descripción, subtareas, comentarios) antes de empezar a trabajar.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          taskNumber: { type: 'number', description: 'Número de tarea (ej. 42 para PROJ-42).' },
        },
        required: ['projectSlug', 'taskNumber'],
      },
    },
    handler: async (args) => {
      const input = getSchema.parse(args);
      return asText(await api.get(`/projects/${input.projectSlug}/tasks/${input.taskNumber}`));
    },
  });

  registry.register({
    tool: {
      name: 'update_task_status',
      description: 'Mueve una tarea a otro estado del workflow (ej. "Preparación" → "Desarrollo").',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          taskNumber: { type: 'number' },
          toState: { type: 'string', description: 'Nombre del estado destino.' },
        },
        required: ['projectSlug', 'taskNumber', 'toState'],
      },
    },
    handler: async (args) => {
      const input = updateStatusSchema.parse(args);
      return asText(
        await api.patch(`/projects/${input.projectSlug}/tasks/${input.taskNumber}`, {
          toState: input.toState,
        }),
      );
    },
  });

  registry.register({
    tool: {
      name: 'create_task',
      description:
        'Crea una nueva tarea o subtarea. Útil para desglosar trabajo descubierto durante el desarrollo.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          parentTaskNumber: { type: 'number' },
        },
        required: ['projectSlug', 'title'],
      },
    },
    handler: async (args) => {
      const input = createSchema.parse(args);
      return asText(await api.post(`/projects/${input.projectSlug}/tasks`, input));
    },
  });

  registry.register({
    tool: {
      name: 'add_comment',
      description: 'Agrega un comentario a una tarea (notas de progreso, decisiones, contexto).',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          taskNumber: { type: 'number' },
          body: { type: 'string' },
        },
        required: ['projectSlug', 'taskNumber', 'body'],
      },
    },
    handler: async (args) => {
      const input = addCommentSchema.parse(args);
      return asText(
        await api.post(`/projects/${input.projectSlug}/tasks/${input.taskNumber}/comments`, {
          body: input.body,
        }),
      );
    },
  });
}
