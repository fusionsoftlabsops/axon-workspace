import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { ToolRegistry } from '../tool-registry.js';

const recallSchema = z.object({
  projectSlug: z.string(),
  query: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const pullSchema = z.object({
  projectSlug: z.string(),
});

const citeSchema = z.object({
  projectSlug: z.string(),
  memoryId: z.string(),
  taskNumber: z.number().int().positive(),
  context: z.string().max(500).optional(),
});

const captureSchema = z.object({
  projectSlug: z.string(),
  type: z.enum(['DECISION', 'GOTCHA', 'PATTERN', 'ANTIPATTERN', 'RUNBOOK', 'GLOSSARY', 'NOTE']),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
  tags: z.array(z.string().min(1).max(40)).max(8).optional(),
  sourceTaskNumber: z.number().int().positive().optional(),
  publishImmediately: z.boolean().optional(),
});

const publishSchema = z.object({
  projectSlug: z.string(),
  memoryId: z.string(),
});

const extractSchema = z.object({
  projectSlug: z.string(),
  taskNumber: z.number().int().positive(),
});

function asText(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function registerBrainTools(registry: ToolRegistry, api: ApiClient) {
  registry.register({
    tool: {
      name: 'recall',
      description:
        'Busca memorias relevantes del cerebro del proyecto (full-text). Devuelve memorias compartidas + las propias del usuario. Úsalo antes de empezar una tarea para traer contexto histórico.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          query: { type: 'string', description: 'Términos de búsqueda. Vacío = todas las memorias activas.' },
          limit: { type: 'number', description: 'Máximo 100. Default 20.' },
        },
        required: ['projectSlug'],
      },
    },
    handler: async (args) => {
      const input = recallSchema.parse(args);
      const qs = new URLSearchParams();
      if (input.query) qs.set('q', input.query);
      if (input.limit) qs.set('limit', String(input.limit));
      const query = qs.toString();
      const path = `/projects/${input.projectSlug}/brain/recall${query ? `?${query}` : ''}`;
      return asText(await api.get(path));
    },
  });

  registry.register({
    tool: {
      name: 'pull_project_brain',
      description:
        'Trae las novedades del cerebro principal del proyecto desde tu último pull. Útil al inicio de una sesión de trabajo para sincronizar tu contexto con lo que el equipo ha publicado.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
        },
        required: ['projectSlug'],
      },
    },
    handler: async (args) => {
      const input = pullSchema.parse(args);
      return asText(await api.get(`/projects/${input.projectSlug}/brain/pull`));
    },
  });

  registry.register({
    tool: {
      name: 'cite_memory',
      description:
        'Registra que estás usando una memoria del cerebro para informar tu trabajo en una tarea. Hazlo cuando una memoria realmente influya en una decisión — esto alimenta las métricas de qué conocimiento se usa y cuál no.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          memoryId: { type: 'string', description: 'ID de la memoria (cuid)' },
          taskNumber: { type: 'number', description: 'Número de la tarea donde se usa.' },
          context: { type: 'string', description: 'Breve nota opcional sobre cómo se usó.' },
        },
        required: ['projectSlug', 'memoryId', 'taskNumber'],
      },
    },
    handler: async (args) => {
      const input = citeSchema.parse(args);
      return asText(
        await api.post(`/projects/${input.projectSlug}/brain/memories/${input.memoryId}/cite`, {
          taskNumber: input.taskNumber,
          context: input.context,
        }),
      );
    },
  });

  registry.register({
    tool: {
      name: 'capture_memory',
      description:
        'Captura una memoria a mano en tu cerebro local (o publícala al cerebro principal si publishImmediately=true). Úsalo cuando notes un aprendizaje accionable que vale la pena recordar — decisión técnica, trampa, patrón, anti-patrón, runbook.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          type: {
            type: 'string',
            enum: ['DECISION', 'GOTCHA', 'PATTERN', 'ANTIPATTERN', 'RUNBOOK', 'GLOSSARY', 'NOTE'],
          },
          title: { type: 'string', description: 'Título corto y descriptivo.' },
          body: { type: 'string', description: 'Cuerpo en markdown.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Hasta 8 tags.' },
          sourceTaskNumber: {
            type: 'number',
            description: 'Tarea que originó la memoria (opcional pero recomendado).',
          },
          publishImmediately: {
            type: 'boolean',
            description: 'Si true, sube directo al cerebro principal sin pasar por local.',
          },
        },
        required: ['projectSlug', 'type', 'title', 'body'],
      },
    },
    handler: async (args) => {
      const input = captureSchema.parse(args);
      const created = await api.post<{ id: string }>(
        `/projects/${input.projectSlug}/brain/memories`,
        {
          type: input.type,
          title: input.title,
          body: input.body,
          tags: input.tags ?? [],
          scope: input.publishImmediately ? 'PROJECT' : 'LOCAL',
          sourceTaskNumber: input.sourceTaskNumber,
        },
      );
      return asText(created);
    },
  });

  registry.register({
    tool: {
      name: 'publish_memory',
      description:
        'Promueve una memoria local (LOCAL) al cerebro principal del proyecto (PROJECT), quedando visible para todos los miembros. Auto-acepta sin queue de revisión.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          memoryId: { type: 'string' },
        },
        required: ['projectSlug', 'memoryId'],
      },
    },
    handler: async (args) => {
      const input = publishSchema.parse(args);
      return asText(
        await api.post(`/projects/${input.projectSlug}/brain/memories/${input.memoryId}/publish`, {}),
      );
    },
  });

  registry.register({
    tool: {
      name: 'extract_memories_from_task',
      description:
        'Ejecuta el extractor de IA (Sonnet 4.6) sobre una tarea cerrada y devuelve memorias candidatas persistidas en tu cerebro local. Útil cuando cierras una tarea fuera del board y quieres capturar lo aprendido.',
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
      const input = extractSchema.parse(args);
      return asText(
        await api.post(`/projects/${input.projectSlug}/brain/extract`, {
          taskNumber: input.taskNumber,
        }),
      );
    },
  });
}
