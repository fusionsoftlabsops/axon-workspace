import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { ToolRegistry } from '../tool-registry.js';

const reportBugSchema = z.object({
  projectSlug: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(20_000),
  reproSteps: z.string().optional(),
  stackTrace: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('HIGH'),
});

export function registerBugTools(registry: ToolRegistry, api: ApiClient) {
  registry.register({
    tool: {
      name: 'report_bug',
      description:
        'Crea un bug ticket en el proyecto con título, descripción y opcionalmente pasos de reproducción y stack trace. Útil cuando Claude Code encuentra un bug durante el desarrollo.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          reproSteps: { type: 'string' },
          stackTrace: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        },
        required: ['projectSlug', 'title', 'description'],
      },
    },
    handler: async (args) => {
      const input = reportBugSchema.parse(args);
      const data = await api.post<unknown>(`/projects/${input.projectSlug}/bugs`, input);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  });
}
