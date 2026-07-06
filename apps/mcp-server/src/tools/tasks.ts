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
const setContentSchema = z
  .object({
    projectSlug: z.string(),
    taskNumber: z.number().int().positive(),
    description: z.string().optional(),
    acceptanceCriteria: z.string().optional(),
    techDesign: z.string().optional(),
    designSpec: z.string().optional(),
    marketingKit: z.string().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  })
  .refine(
    (v) =>
      v.description !== undefined ||
      v.acceptanceCriteria !== undefined ||
      v.techDesign !== undefined ||
      v.designSpec !== undefined ||
      v.marketingKit !== undefined ||
      v.priority !== undefined,
    { message: 'indicá al menos un campo a persistir' },
  );
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
const qaTestCaseSchema = z.object({
  title: z.string().min(1).max(500),
  steps: z.string().max(4000).optional(),
  expected: z.string().max(2000).optional(),
});
const submitQaReviewSchema = z.object({
  projectSlug: z.string(),
  taskNumber: z.number().int().positive(),
  criteria: z.array(z.object({ text: z.string().min(1).max(1000), met: z.boolean() })).max(50).optional(),
  suggestedTests: z.array(z.union([z.string().min(1).max(2000), qaTestCaseSchema])).max(50).optional(),
  executedTasks: z.array(z.string().min(1).max(1000)).max(100).optional(),
  notes: z.string().max(8000).optional(),
  moveToVerification: z.boolean().optional(),
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
      name: 'set_story_content',
      description:
        'Persiste artefactos generativos de una HU SIN llamar IA del servidor — para el runtime LOCAL, ' +
        'donde las personas corren en tu Claude Code: PO → description + acceptanceCriteria (+priority); ' +
        'Arquitecto → techDesign; Diseño → designSpec; Marketing → marketingKit. Pasá solo los campos del rol.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          taskNumber: { type: 'number' },
          description: { type: 'string', description: 'PO: descripción refinada.' },
          acceptanceCriteria: { type: 'string', description: 'PO: criterios (checklist markdown o Dado/Cuando/Entonces).' },
          techDesign: { type: 'string', description: 'Arquitecto (Dax): diseño técnico.' },
          designSpec: { type: 'string', description: 'Diseño (Aria): spec de UI/UX.' },
          marketingKit: { type: 'string', description: 'Marketing (Sol): kit go-to-market.' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        },
        required: ['projectSlug', 'taskNumber'],
      },
    },
    handler: async (args) => {
      const input = setContentSchema.parse(args);
      const { projectSlug, taskNumber, ...fields } = input;
      return asText(await api.patch(`/projects/${projectSlug}/tasks/${taskNumber}`, fields));
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

  registry.register({
    tool: {
      name: 'submit_qa_review',
      description:
        'Cierra una HU y la entrega a QA: registra el checklist de criterios de aceptación (cumplidos/no), ' +
        'las pruebas de QA sugeridas, el listado de tareas ejecutadas y notas de contexto; publica un ' +
        'comentario con el resumen y mueve la HU al estado de Verificación. Úsalo al terminar el desarrollo.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          taskNumber: { type: 'number' },
          criteria: {
            type: 'array',
            description: 'Checklist de criterios de aceptación evaluados.',
            items: {
              type: 'object',
              properties: { text: { type: 'string' }, met: { type: 'boolean' } },
              required: ['text', 'met'],
            },
          },
          suggestedTests: {
            type: 'array',
            description: 'Pruebas de QA sugeridas (texto simple o {title, steps, expected}).',
            items: {
              oneOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    steps: { type: 'string' },
                    expected: { type: 'string' },
                  },
                  required: ['title'],
                },
              ],
            },
          },
          executedTasks: {
            type: 'array',
            description: 'Listado de tareas/pasos ejecutados durante el desarrollo.',
            items: { type: 'string' },
          },
          notes: { type: 'string', description: 'Contexto adicional para QA.' },
          moveToVerification: {
            type: 'boolean',
            description: 'Mover la HU a Verificación (por defecto true).',
          },
        },
        required: ['projectSlug', 'taskNumber'],
      },
    },
    handler: async (args) => {
      const input = submitQaReviewSchema.parse(args);
      const { projectSlug, taskNumber, ...payload } = input;
      return asText(await api.post(`/projects/${projectSlug}/tasks/${taskNumber}/qa-review`, payload));
    },
  });
}
