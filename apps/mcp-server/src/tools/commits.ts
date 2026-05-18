import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { ToolRegistry } from '../tool-registry.js';

const commitMessageSchema = z.object({
  projectSlug: z.string(),
  taskNumber: z.number().int().positive(),
  diffSummary: z.string(),
});

const prDescriptionSchema = z.object({
  projectSlug: z.string(),
  taskNumber: z.number().int().positive(),
  diffStats: z.string().optional(),
});

export function registerCommitTools(registry: ToolRegistry, api: ApiClient) {
  registry.register({
    tool: {
      name: 'generate_commit_message',
      description:
        'Genera un mensaje de commit convencional ligado a una tarea (ej. "feat(auth): añadir 2FA — PROJ-12").',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          taskNumber: { type: 'number' },
          diffSummary: { type: 'string', description: 'Resumen breve del cambio.' },
        },
        required: ['projectSlug', 'taskNumber', 'diffSummary'],
      },
    },
    handler: async (args) => {
      const input = commitMessageSchema.parse(args);
      const data = await api.post<{ message: string }>(
        `/projects/${input.projectSlug}/tasks/${input.taskNumber}/ai/commit-message`,
        { diffSummary: input.diffSummary },
      );
      return { content: [{ type: 'text', text: data.message }] };
    },
  });

  registry.register({
    tool: {
      name: 'generate_pr_description',
      description:
        'Genera una descripción de PR (sumario + test plan) usando el contexto de la tarea como insumo.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          taskNumber: { type: 'number' },
          diffStats: { type: 'string' },
        },
        required: ['projectSlug', 'taskNumber'],
      },
    },
    handler: async (args) => {
      const input = prDescriptionSchema.parse(args);
      const data = await api.post<{ description: string }>(
        `/projects/${input.projectSlug}/tasks/${input.taskNumber}/ai/pr-description`,
        { diffStats: input.diffStats },
      );
      return { content: [{ type: 'text', text: data.description }] };
    },
  });
}
