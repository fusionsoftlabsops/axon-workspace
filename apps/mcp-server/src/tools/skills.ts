import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { ToolRegistry } from '../tool-registry.js';

const listSchema = z.object({
  category: z.enum(['TESTING', 'QUALITY', 'WORKFLOW', 'ARCHITECTURE', 'GIT', 'OTHER']).optional(),
});

const submitSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case'),
  name: z.string().min(2).max(120),
  description: z.string().min(2).max(500),
  category: z.enum(['TESTING', 'QUALITY', 'WORKFLOW', 'ARCHITECTURE', 'GIT', 'OTHER']).optional(),
  kind: z.enum(['COMMAND', 'GUIDELINE']).optional(),
  body: z.string().min(1).max(40_000),
  tags: z.array(z.string().min(1).max(40)).max(12).optional(),
});

function asText(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

// Global (not project-scoped) tools for the shared skills package.
export function registerSkillTools(registry: ToolRegistry, api: ApiClient) {
  registry.register({
    tool: {
      name: 'list_skills',
      description:
        'Baja el paquete de skills aprobadas del equipo (comandos y guías de buenas prácticas, ' +
        'ej. cerrar-hu, e2e-tests, unit-coverage-90, pre-push, solid-principles). Úsalo con /skills ' +
        'para sincronizarlas a ~/.qwen. Opcionalmente filtra por categoría.',
      inputSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['TESTING', 'QUALITY', 'WORKFLOW', 'ARCHITECTURE', 'GIT', 'OTHER'],
            description: 'Filtrar por categoría.',
          },
        },
      },
    },
    handler: async (args) => {
      const input = listSchema.parse(args ?? {});
      const qs = new URLSearchParams();
      if (input.category) qs.set('category', input.category);
      const query = qs.toString();
      return asText(await api.get(`/skills${query ? `?${query}` : ''}`));
    },
  });

  registry.register({
    tool: {
      name: 'submit_skill',
      description:
        'Contribuye un skill nuevo al paquete del equipo. Entra como PENDING para revisión antes ' +
        'de volverse parte del paquete. El body es Markdown (la definición del comando/guía).',
      inputSchema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'kebab-case, único (nombre del comando).' },
          name: { type: 'string' },
          description: { type: 'string' },
          category: {
            type: 'string',
            enum: ['TESTING', 'QUALITY', 'WORKFLOW', 'ARCHITECTURE', 'GIT', 'OTHER'],
          },
          kind: { type: 'string', enum: ['COMMAND', 'GUIDELINE'] },
          body: { type: 'string', description: 'Definición en Markdown.' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['slug', 'name', 'description', 'body'],
      },
    },
    handler: async (args) => {
      const input = submitSchema.parse(args);
      return asText(await api.post('/skills', input));
    },
  });
}
