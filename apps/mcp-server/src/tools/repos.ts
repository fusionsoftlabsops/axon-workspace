/**
 * Tools de REPOS: el interventor vincula/lee los repos GitHub de un proyecto,
 * requisito para que el Dev pueda clonar y QA/Reviewer diff-review.
 */
import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { ToolRegistry } from '../tool-registry.js';

const listSchema = z.object({ projectSlug: z.string() });
const linkSchema = z.object({
  projectSlug: z.string(),
  name: z.string().min(1),
  url: z.string().min(1),
  kind: z.string().optional(),
});

function asText(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function registerRepoTools(registry: ToolRegistry, api: ApiClient): void {
  registry.register({
    tool: {
      name: 'list_repos',
      description: 'Lista los repos GitHub vinculados a un proyecto (name, kind, url, githubFullName, defaultBranch).',
      inputSchema: {
        type: 'object',
        properties: { projectSlug: { type: 'string' } },
        required: ['projectSlug'],
      },
    },
    handler: async (args) => {
      const input = listSchema.parse(args);
      return asText(await api.get(`/projects/${input.projectSlug}/repos`));
    },
  });

  registry.register({
    tool: {
      name: 'link_repo',
      description:
        'Vincula un repo GitHub EXISTENTE a un proyecto (name + url [+ kind: backend|frontend|infra|mobile|other]). ' +
        'Requisito para que el Dev clone y QA/Reviewer revisen. Requiere ser miembro no-VIEWER (OWNER/ADMIN/MEMBER).',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          name: { type: 'string', description: 'Identificador lógico dentro del proyecto (ej. idea-forge-backend).' },
          url: { type: 'string', description: 'https://github.com/owner/repo' },
          kind: { type: 'string', description: 'backend | frontend | infra | mobile | other' },
        },
        required: ['projectSlug', 'name', 'url'],
      },
    },
    handler: async (args) => {
      const input = linkSchema.parse(args);
      return asText(
        await api.post(`/projects/${input.projectSlug}/repos`, {
          name: input.name,
          url: input.url,
          ...(input.kind ? { kind: input.kind } : {}),
        }),
      );
    },
  });
}
