import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { ToolRegistry } from '../tool-registry.js';

const draftSchema = z.object({
  projectSlug: z.string(),
  rawInput: z.string().min(10).max(4000),
  provider: z.enum(['ANTHROPIC', 'OPENAI', 'GOOGLE', 'MOONSHOT']),
  model: z.string().min(1).max(100),
  credentialId: z.string(),
  selectedPaths: z.array(z.string()).max(50).optional(),
  citedMemoryIds: z.array(z.string()).max(20).optional(),
  pollIntervalMs: z.number().int().min(500).max(10_000).optional(),
  maxWaitMs: z.number().int().min(5_000).max(120_000).optional(),
});

const publishSchema = z.object({
  projectSlug: z.string(),
  draftId: z.string(),
  stateId: z.string(),
  includeSubtasks: z.array(z.number().int().nonnegative()).optional(),
  finalTitle: z.string().min(1).max(200).optional(),
  finalDescription: z.string().max(20_000).optional(),
});

const repoTreeSchema = z.object({
  projectSlug: z.string(),
  root: z.string().optional(),
  depth: z.number().int().min(1).max(6).optional(),
});

const repoGrepSchema = z.object({
  projectSlug: z.string(),
  pattern: z.string().min(1).max(200),
  scope: z.array(z.string()).max(40).optional(),
});

function asText(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerStoryTools(registry: ToolRegistry, api: ApiClient) {
  registry.register({
    tool: {
      name: 'draft_user_story',
      description:
        'Genera un borrador de Historia de Usuario (HU) partiendo de una necesidad expresada en lenguaje natural + archivos del repo + memorias del cerebro. El server crea el draft en background y este tool poll hasta que llega a READY/ERRORED. Requiere `repoPath` configurado en el proyecto y al menos una credencial LLM. Usa `list_repo_tree` antes para elegir paths relevantes.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          rawInput: { type: 'string', description: 'Necesidad del usuario en lenguaje natural (>=10 chars).' },
          provider: { type: 'string', enum: ['ANTHROPIC', 'OPENAI', 'GOOGLE', 'MOONSHOT'] },
          model: { type: 'string', description: 'ID del modelo. Debe ser uno soportado por el provider.' },
          credentialId: { type: 'string', description: 'ID de la LlmCredential a usar (crear en /settings/llm-credentials).' },
          selectedPaths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Paths del repo a incluir como contexto. Pueden ser archivos o directorios (se expanden).',
          },
          citedMemoryIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'IDs de memorias del cerebro a citar. Si está vacío, auto-recall via searchBrain(rawInput).',
          },
          pollIntervalMs: { type: 'number', description: 'Intervalo de polling, default 2000.' },
          maxWaitMs: { type: 'number', description: 'Timeout total. Default 90s.' },
        },
        required: ['projectSlug', 'rawInput', 'provider', 'model', 'credentialId'],
      },
    },
    handler: async (args) => {
      const input = draftSchema.parse(args);
      // 1. Crear el draft (background generation arranca en el server)
      const start = await api.post<{ ok: boolean; draftId: string }>(
        `/projects/${input.projectSlug}/stories/drafts`,
        {
          rawInput: input.rawInput,
          provider: input.provider,
          model: input.model,
          credentialId: input.credentialId,
          selectedPaths: input.selectedPaths ?? [],
          citedMemoryIds: input.citedMemoryIds ?? [],
        },
      );
      if (!start?.draftId) {
        return asText({ error: 'no draftId returned', raw: start });
      }

      // 2. Polling hasta READY/ERRORED/PUBLISHED o timeout
      const pollInterval = input.pollIntervalMs ?? 2000;
      const maxWait = input.maxWaitMs ?? 90_000;
      const deadline = Date.now() + maxWait;
      let last: Record<string, unknown> | null = null;
      while (Date.now() < deadline) {
        await sleep(pollInterval);
        const d = await api.get<Record<string, unknown>>(
          `/projects/${input.projectSlug}/stories/drafts/${start.draftId}`,
        );
        last = d;
        const status = d.status;
        if (status === 'READY' || status === 'ERRORED' || status === 'PUBLISHED') {
          return asText({ draftId: start.draftId, ...d });
        }
      }
      return asText({
        draftId: start.draftId,
        status: 'TIMEOUT',
        message: `el draft no terminó en ${maxWait}ms; usa get_story_draft con el id para verificar.`,
        partial: last,
      });
    },
  });

  registry.register({
    tool: {
      name: 'get_story_draft',
      description:
        'Devuelve el estado actual de un StoryDraft por id. Útil cuando draft_user_story hizo timeout o quieres recuperar un draft histórico.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          draftId: { type: 'string' },
        },
        required: ['projectSlug', 'draftId'],
      },
    },
    handler: async (args) => {
      const schema = z.object({ projectSlug: z.string(), draftId: z.string() });
      const input = schema.parse(args);
      return asText(
        await api.get(`/projects/${input.projectSlug}/stories/drafts/${input.draftId}`),
      );
    },
  });

  registry.register({
    tool: {
      name: 'list_story_drafts',
      description: 'Lista los borradores de HU del proyecto (los tuyos). Devuelve summary + status + costo.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
        },
        required: ['projectSlug'],
      },
    },
    handler: async (args) => {
      const schema = z.object({ projectSlug: z.string() });
      const input = schema.parse(args);
      return asText(await api.get(`/projects/${input.projectSlug}/stories/drafts`));
    },
  });

  registry.register({
    tool: {
      name: 'publish_story_draft',
      description:
        'Publica un StoryDraft READY como Task con kind=STORY. Opcionalmente crea subtareas hijas a partir del subtaskBreakdown (índices 0-based). Reusa el board del proyecto.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          draftId: { type: 'string' },
          stateId: { type: 'string', description: 'ID del WorkflowState destino (columna del board).' },
          includeSubtasks: {
            type: 'array',
            items: { type: 'number' },
            description: 'Índices de subtaskBreakdown a crear como subtareas hijas.',
          },
          finalTitle: { type: 'string', description: 'Override del título (default = primera línea del summary).' },
          finalDescription: { type: 'string', description: 'Override del cuerpo markdown (default = compilado de secciones).' },
        },
        required: ['projectSlug', 'draftId', 'stateId'],
      },
    },
    handler: async (args) => {
      const input = publishSchema.parse(args);
      return asText(
        await api.post(
          `/projects/${input.projectSlug}/stories/drafts/${input.draftId}/publish`,
          {
            stateId: input.stateId,
            includeSubtasks: input.includeSubtasks ?? [],
            finalTitle: input.finalTitle,
            finalDescription: input.finalDescription,
          },
        ),
      );
    },
  });

  registry.register({
    tool: {
      name: 'list_repo_tree',
      description:
        'Devuelve el árbol del repositorio asociado al proyecto (sandboxed). Útil para que el agente elija qué archivos pasar como contexto al draft_user_story.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          root: { type: 'string', description: "Subdirectorio a partir del cual listar. Default '.'." },
          depth: { type: 'number', description: '1-6. Default 2.' },
        },
        required: ['projectSlug'],
      },
    },
    handler: async (args) => {
      const input = repoTreeSchema.parse(args);
      const qs = new URLSearchParams();
      if (input.root) qs.set('root', input.root);
      if (input.depth) qs.set('depth', String(input.depth));
      const query = qs.toString();
      return asText(
        await api.get(
          `/projects/${input.projectSlug}/repo/tree${query ? `?${query}` : ''}`,
        ),
      );
    },
  });

  registry.register({
    tool: {
      name: 'grep_repo',
      description:
        'Busca un patrón (texto fijo, escapado como regex) en el repositorio del proyecto. Devuelve hasta 100 hits con path+line+text.',
      inputSchema: {
        type: 'object',
        properties: {
          projectSlug: { type: 'string' },
          pattern: { type: 'string' },
          scope: {
            type: 'array',
            items: { type: 'string' },
            description: 'Limitar la búsqueda a estos paths (archivos o directorios).',
          },
        },
        required: ['projectSlug', 'pattern'],
      },
    },
    handler: async (args) => {
      const input = repoGrepSchema.parse(args);
      return asText(
        await api.post(`/projects/${input.projectSlug}/repo/grep`, {
          pattern: input.pattern,
          scope: input.scope ?? [],
        }),
      );
    },
  });
}
