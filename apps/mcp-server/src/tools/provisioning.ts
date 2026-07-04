/**
 * Tools de PROVISIÓN de equipos (para el supervisor/consola). Provisionan la
 * identidad de los agentes (filas + tokens sellados); el worker multi-tenant los
 * toma en su próximo refresco. Requieren token OWNER/ADMIN del proyecto.
 */
import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { ToolRegistry } from '../tool-registry.js';

const ROLES = ['SM', 'PO', 'ARCHITECT', 'DESIGN', 'DEV', 'QA', 'REVIEWER', 'MARKETING', 'RELEASE'] as const;

const defaultTeamSchema = z.object({ projectSlug: z.string() });
const presetSchema = z.object({
  projectSlug: z.string(),
  preset: z.enum(['ECO', 'BALANCED', 'MAX', 'AXON_DEFAULT']).default('AXON_DEFAULT'),
});
const provisionSchema = z.object({
  projectSlug: z.string(),
  role: z.enum(ROLES),
  llmModel: z.string().optional(),
  enable: z.boolean().default(true),
});
const setModelSchema = z.object({
  projectSlug: z.string(),
  role: z.enum(ROLES),
  llmModel: z.string(),
});

function asText(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function registerProvisioningTools(registry: ToolRegistry, api: ApiClient): void {
  registry.register({
    tool: {
      name: 'provision_default_team',
      description:
        'Provisiona el equipo por defecto estilo-axon (los 9 roles habilitados: Sonnet 5 + Dev en Qwen) para un ' +
        'proyecto. Idempotente. Requiere ser OWNER/ADMIN. Los agentes corren en el worker multi-tenant tras su refresco.',
      inputSchema: {
        type: 'object',
        properties: { projectSlug: { type: 'string' } },
        required: ['projectSlug'],
      },
    },
    handler: async (args) => {
      const input = defaultTeamSchema.parse(args);
      return asText(await api.post(`/projects/${input.projectSlug}/agents/preset`, { preset: 'AXON_DEFAULT' }));
    },
  });

  registry.register({
    tool: {
      name: 'apply_team_preset',
      description:
        'Aplica un preset de equipo a un proyecto: ECO | BALANCED | MAX | AXON_DEFAULT. Provisiona los roles del ' +
        'preset y ajusta modelos/presupuestos. Requiere OWNER/ADMIN.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          preset: { type: 'string', description: 'ECO | BALANCED | MAX | AXON_DEFAULT (default)' },
        },
        required: ['projectSlug'],
      },
    },
    handler: async (args) => {
      const input = presetSchema.parse(args);
      return asText(await api.post(`/projects/${input.projectSlug}/agents/preset`, { preset: input.preset }));
    },
  });

  registry.register({
    tool: {
      name: 'provision_agent',
      description: 'Provisiona el agente de UN rol (opcionalmente con modelo y activándolo). Requiere OWNER/ADMIN.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          role: { type: 'string', description: 'SM|PO|ARCHITECT|DESIGN|DEV|QA|REVIEWER|MARKETING|RELEASE' },
          llmModel: { type: 'string', description: 'default claude-sonnet-5' },
          enable: { type: 'boolean', description: 'activarlo de una (default true)' },
        },
        required: ['projectSlug', 'role'],
      },
    },
    handler: async (args) => {
      const input = provisionSchema.parse(args);
      return asText(
        await api.post(`/projects/${input.projectSlug}/agents`, {
          role: input.role,
          ...(input.llmModel ? { llmModel: input.llmModel } : {}),
          enable: input.enable,
        }),
      );
    },
  });

  registry.register({
    tool: {
      name: 'set_agent_model',
      description: 'Cambia el modelo LLM de un agente ya provisionado (ej. subir el QA a opus). Requiere OWNER/ADMIN.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          role: { type: 'string', description: 'SM|PO|ARCHITECT|DESIGN|DEV|QA|REVIEWER|MARKETING|RELEASE' },
          llmModel: { type: 'string' },
        },
        required: ['projectSlug', 'role', 'llmModel'],
      },
    },
    handler: async (args) => {
      const input = setModelSchema.parse(args);
      return asText(
        await api.patch(`/projects/${input.projectSlug}/agents`, { role: input.role, llmModel: input.llmModel }),
      );
    },
  });
}
