/**
 * Tools de SUPERVISOR/ORQUESTADOR: permiten que una consola (Claude Code)
 * monitoree el proceso agéntico completo y lo corrija con plena capacidad:
 *  - list_agent_runs: la señal DURA de salud (RUNNING/FAILED/BUDGET_EXCEEDED).
 *  - assign_task: redireccionar una HU al agente/rol correcto (o al owner).
 *  - retrigger_task: re-despertar al agente que corresponde a UNA HU.
 *  - set_agent_enabled: kill-switch por rol (requiere OWNER/ADMIN).
 */
import { z } from 'zod';
import { ROLES } from '../roles.js';
import type { ApiClient } from '../api-client.js';
import type { ToolRegistry } from '../tool-registry.js';


const runsSchema = z.object({
  projectSlug: z.string(),
  limit: z.number().int().min(1).max(100).default(30),
  status: z.enum(['RUNNING', 'SUCCEEDED', 'FAILED', 'BUDGET_EXCEEDED', 'CANCELLED']).optional(),
});
const assignSchema = z
  .object({
    projectSlug: z.string(),
    taskNumber: z.number().int().positive(),
    toRole: z.enum(ROLES).optional(),
    toOwner: z.boolean().optional(),
    toState: z.string().optional(),
  })
  .refine((v) => v.toRole || v.toOwner || v.toState, {
    message: 'indicá toRole, toOwner o toState',
  });
const retriggerSchema = z.object({
  projectSlug: z.string(),
  taskNumber: z.number().int().positive(),
  force: z.boolean().default(false),
});
const enableSchema = z.object({
  projectSlug: z.string(),
  role: z.enum(ROLES),
  enabled: z.boolean(),
});
const listPrsSchema = z.object({
  projectSlug: z.string(),
  state: z.enum(['open', 'closed', 'all']).default('open'),
});
const prDiffSchema = z.object({
  projectSlug: z.string(),
  prNumber: z.number().int().positive(),
  repo: z.string().optional(),
});

function asText(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  };
}

export function registerSupervisorTools(registry: ToolRegistry, api: ApiClient): void {
  registry.register({
    tool: {
      name: 'list_agent_runs',
      description:
        'Corridas de los agentes (la señal dura de salud del equipo): rol, HU, estado (RUNNING = trabajando; ' +
        'FAILED / BUDGET_EXCEEDED = intervenir), tokens, costo y error. Filtrable por status.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          limit: { type: 'number', description: 'Máx 100 (default 30).' },
          status: { type: 'string', description: 'RUNNING | SUCCEEDED | FAILED | BUDGET_EXCEEDED | CANCELLED' },
        },
        required: ['projectSlug'],
      },
    },
    handler: async (args) => {
      const input = runsSchema.parse(args);
      const qs = new URLSearchParams({ limit: String(input.limit) });
      if (input.status) qs.set('status', input.status);
      return asText(await api.get(`/projects/${input.projectSlug}/agent-runs-list?${qs.toString()}`));
    },
  });

  registry.register({
    tool: {
      name: 'assign_task',
      description:
        'Redirecciona una HU: asignala al AGENTE de un rol (toRole), al humano dueño del proyecto (toOwner), ' +
        'y/o movela de estado (toState). El supervisor la usa para corregir el flujo cuando algo quedó mal enrutado.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          taskNumber: { type: 'number' },
          toRole: { type: 'string', description: 'SM|PO|ARCHITECT|DESIGN|DEV|QA|REVIEWER|MARKETING|RELEASE' },
          toOwner: { type: 'boolean', description: 'Asignar al owner del proyecto (modo consola).' },
          toState: { type: 'string', description: 'Nombre del estado destino (opcional).' },
        },
        required: ['projectSlug', 'taskNumber'],
      },
    },
    handler: async (args) => {
      const input = assignSchema.parse(args);
      return asText(
        await api.patch(`/projects/${input.projectSlug}/tasks/${input.taskNumber}`, {
          ...(input.toState ? { toState: input.toState } : {}),
          ...(input.toRole ? { assignToAgentRole: input.toRole } : {}),
          ...(input.toOwner ? { assignToOwner: true } : {}),
        }),
      );
    },
  });

  registry.register({
    tool: {
      name: 'retrigger_task',
      description:
        'Re-despierta al agente que corresponde a UNA HU re-emitiendo su evento según el estado actual ' +
        '(backlog→PO/Diseño/SM · Desarrollo→Dev · Verificación→QA+Reviewer), sin moverla de estado. ' +
        'Si hay una corrida RUNNING devuelve 409 (usá force para disparar igual).',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          taskNumber: { type: 'number' },
          force: { type: 'boolean' },
        },
        required: ['projectSlug', 'taskNumber'],
      },
    },
    handler: async (args) => {
      const input = retriggerSchema.parse(args);
      return asText(
        await api.post(`/projects/${input.projectSlug}/tasks/${input.taskNumber}/retrigger`, {
          force: input.force,
        }),
      );
    },
  });

  registry.register({
    tool: {
      name: 'set_agent_enabled',
      description:
        'Kill-switch: enciende/apaga el agente de un rol (p.ej. frenar un Dev que está rompiendo). ' +
        'Requiere que el token sea de un OWNER/ADMIN del proyecto.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          role: { type: 'string', description: 'SM|PO|ARCHITECT|DESIGN|DEV|QA|REVIEWER|MARKETING|RELEASE' },
          enabled: { type: 'boolean' },
        },
        required: ['projectSlug', 'role', 'enabled'],
      },
    },
    handler: async (args) => {
      const input = enableSchema.parse(args);
      return asText(
        await api.patch(`/projects/${input.projectSlug}/agents`, {
          role: input.role,
          enabled: input.enabled,
        }),
      );
    },
  });

  registry.register({
    tool: {
      name: 'list_prs',
      description:
        'Lista los Pull Requests de los repos GitHub del proyecto — el objeto central de la REVISIÓN de código. ' +
        'Marca las ramas agent/hu-N con su storyNumber para atar cada PR a su HU. state: open|closed|all.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          state: { type: 'string', description: 'open | closed | all (default open)' },
        },
        required: ['projectSlug'],
      },
    },
    handler: async (args) => {
      const input = listPrsSchema.parse(args);
      return asText(await api.get(`/projects/${input.projectSlug}/prs?state=${input.state}`));
    },
  });

  registry.register({
    tool: {
      name: 'get_pr_diff',
      description:
        'Diff completo de un PR (truncado a ~120k) + metadatos (additions/deletions/changedFiles) — para AUDITAR ' +
        'exactamente qué cambió un agente: bugs, malas prácticas, seguridad, tests faltantes, consistencia con la HU.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          prNumber: { type: 'number' },
          repo: { type: 'string', description: 'Nombre del repo si el proyecto tiene varios.' },
        },
        required: ['projectSlug', 'prNumber'],
      },
    },
    handler: async (args) => {
      const input = prDiffSchema.parse(args);
      const qs = input.repo ? `?repo=${encodeURIComponent(input.repo)}` : '';
      return asText(await api.get(`/projects/${input.projectSlug}/prs/${input.prNumber}/diff${qs}`));
    },
  });
}
