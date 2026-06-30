/**
 * Machine-readable API discovery document for the `/api/v1` surface.
 *
 * This is a hand-curated OpenAPI 3.1 document (not generated from the route
 * handlers) so that AI agents and the Axon MCP server can DISCOVER the API
 * without reading source. It is served, without auth, from
 * `GET /api/v1/openapi.json`.
 *
 * Kept deliberately additive: it does not import or alter any route handler.
 * The shapes here were transcribed from the actual handlers under
 * `src/app/api/v1/**`. Request bodies and required scopes are accurate;
 * some success response bodies are intentionally described as generic objects.
 *
 * When you add or change a `/api/v1` route, update the matching entry here.
 */
import type { ApiScope } from '@admin/shared/types';

export const OPENAPI_VERSION = '3.1.0';

/** Minimal structural typing — enough to keep this document honest under tsc. */
export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers: Array<{ url: string; description?: string }>;
  tags: Array<{ name: string; description?: string }>;
  paths: Record<string, Record<string, unknown>>;
  components: {
    securitySchemes: Record<string, unknown>;
    parameters: Record<string, unknown>;
    schemas: Record<string, unknown>;
    responses: Record<string, unknown>;
  };
}

const PRIORITY_ENUM = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const MEMORY_TYPE_ENUM = [
  'DECISION',
  'GOTCHA',
  'PATTERN',
  'ANTIPATTERN',
  'RUNBOOK',
  'GLOSSARY',
  'NOTE',
] as const;

type SecurityKind = 'token' | 'session' | 'either';

interface OpOptions {
  summary: string;
  description?: string;
  tags: string[];
  operationId: string;
  /** Required `ad_pk_` scopes for token auth. Empty for session-only routes. */
  scopes?: ApiScope[];
  security: SecurityKind;
  parameters?: unknown[];
  requestBody?: unknown;
  /** Map of status code -> response object. A 200/201 entry is required. */
  responses: Record<string, unknown>;
}

const COMMON_ERRORS: Record<string, unknown> = {
  '400': { $ref: '#/components/responses/BadRequest' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
  '404': { $ref: '#/components/responses/NotFound' },
};

function securityFor(kind: SecurityKind): unknown[] {
  // For http-bearer / apiKey schemes OpenAPI requires an empty scope array;
  // the human-meaningful scopes live in `x-required-scopes` on the operation.
  switch (kind) {
    case 'token':
      return [{ bearerAuth: [] }];
    case 'session':
      return [{ sessionAuth: [] }];
    case 'either':
      return [{ bearerAuth: [] }, { sessionAuth: [] }];
  }
}

function op(o: OpOptions): Record<string, unknown> {
  const operation: Record<string, unknown> = {
    summary: o.summary,
    operationId: o.operationId,
    tags: o.tags,
    security: securityFor(o.security),
    responses: { ...o.responses, ...COMMON_ERRORS },
  };
  if (o.description) operation.description = o.description;
  if (o.scopes && o.scopes.length > 0) operation['x-required-scopes'] = o.scopes;
  if (o.parameters) operation.parameters = o.parameters;
  if (o.requestBody) operation.requestBody = o.requestBody;
  return operation;
}

function jsonBody(schemaRef: string, required = true): Record<string, unknown> {
  return {
    required,
    content: { 'application/json': { schema: { $ref: schemaRef } } },
  };
}

/** A generic JSON success response — bodies are intentionally loose objects. */
function ok(description: string): Record<string, unknown> {
  return {
    description,
    content: {
      'application/json': {
        schema: { type: 'object', additionalProperties: true },
      },
    },
  };
}

function query(
  name: string,
  description: string,
  schema: unknown,
  required = false,
): Record<string, unknown> {
  return { name, in: 'query', required, description, schema };
}

/**
 * Build the OpenAPI document. `baseUrl` defaults to a relative `/` so the
 * spec works regardless of the host it is served from.
 */
export function buildOpenApiDocument(baseUrl = '/'): OpenApiDocument {
  const slugParam = { $ref: '#/components/parameters/projectSlug' };
  const taskNumberParam = { $ref: '#/components/parameters/taskNumber' };
  const memoryIdParam = { $ref: '#/components/parameters/memoryId' };
  const fileIdParam = { $ref: '#/components/parameters/fileId' };
  const draftIdParam = { $ref: '#/components/parameters/draftId' };

  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: 'Axon API',
      version: 'v1',
      description:
        'Programmatic API for Axon, consumed by the Axon MCP server and other ' +
        'agents. Most resource endpoints authenticate with a personal access ' +
        'token (`Authorization: Bearer ad_pk_...`) carrying scopes; a handful of ' +
        'browser-facing endpoints (files, planning) authenticate with the web ' +
        'session cookie instead. Repo endpoints accept either. This discovery ' +
        'document itself is public.',
    },
    servers: [{ url: baseUrl, description: 'Axon deployment root' }],
    tags: [
      { name: 'discovery', description: 'API discovery / metadata' },
      { name: 'tasks', description: 'Tasks, subtasks and comments' },
      { name: 'brain', description: 'Project brain: memories, recall, extraction, sync' },
      { name: 'files', description: 'Project file store and generated context' },
      { name: 'planning', description: 'AI planning snapshots and attachments' },
      { name: 'repo', description: 'Sandboxed read-only access to the project repository' },
      { name: 'stories', description: 'AI story drafts and publishing' },
      { name: 'bugs', description: 'Bug reporting' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'ad_pk_<token>',
          description:
            'Personal access token issued by Axon, sent as ' +
            '`Authorization: Bearer ad_pk_...`. Tokens carry a set of scopes ' +
            '(see each operation\'s `x-required-scopes`) and may be restricted ' +
            'to specific project slugs.',
        },
        sessionAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'authjs.session-token',
          description:
            'Auth.js (NextAuth) browser session cookie. Used by the in-app UI; ' +
            'a valid session is treated as holding every scope it requests.',
        },
      },
      parameters: {
        projectSlug: {
          name: 'slug',
          in: 'path',
          required: true,
          description: 'Project slug.',
          schema: { type: 'string' },
        },
        taskNumber: {
          name: 'taskNumber',
          in: 'path',
          required: true,
          description: 'Per-project task number (>= 1).',
          schema: { type: 'integer', minimum: 1 },
        },
        memoryId: {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Brain memory id.',
          schema: { type: 'string' },
        },
        fileId: {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Project file id.',
          schema: { type: 'string', format: 'uuid' },
        },
        draftId: {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Story draft id.',
          schema: { type: 'string', format: 'cuid' },
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            issues: {
              type: 'array',
              description: 'Zod validation issues, present on some 400 responses.',
              items: { type: 'object', additionalProperties: true },
            },
          },
          required: ['error'],
        },
        TaskCreate: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string', maxLength: 20000 },
            priority: { type: 'string', enum: PRIORITY_ENUM, default: 'MEDIUM' },
            parentTaskNumber: { type: 'integer', minimum: 1 },
            stateName: {
              type: 'string',
              description: 'Target workflow state name; defaults to the first state.',
            },
          },
        },
        TaskPatch: {
          type: 'object',
          description: 'At least one field is required.',
          minProperties: 1,
          properties: {
            toState: { type: 'string', description: 'Move the task to this workflow state.' },
            title: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string', maxLength: 20000 },
            priority: { type: 'string', enum: PRIORITY_ENUM },
          },
        },
        CommentCreate: {
          type: 'object',
          required: ['body'],
          properties: { body: { type: 'string', minLength: 1, maxLength: 20000 } },
        },
        MemoryCreate: {
          type: 'object',
          required: ['type', 'title', 'body'],
          properties: {
            type: { type: 'string', enum: MEMORY_TYPE_ENUM },
            title: { type: 'string', minLength: 1, maxLength: 200 },
            body: { type: 'string', minLength: 1, maxLength: 20000 },
            tags: {
              type: 'array',
              maxItems: 8,
              items: { type: 'string', minLength: 1, maxLength: 40 },
              default: [],
            },
            scope: { type: 'string', enum: ['LOCAL', 'PROJECT'], default: 'LOCAL' },
            sourceTaskNumber: { type: 'integer', minimum: 1 },
          },
        },
        MemoryPatch: {
          type: 'object',
          description: 'At least one field is required.',
          minProperties: 1,
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            body: { type: 'string', minLength: 1, maxLength: 20000 },
            type: { type: 'string', enum: MEMORY_TYPE_ENUM },
            tags: {
              type: 'array',
              maxItems: 8,
              items: { type: 'string', minLength: 1, maxLength: 40 },
            },
            status: { type: 'string', enum: ['ACTIVE', 'DEPRECATED'] },
          },
        },
        MemoryCite: {
          type: 'object',
          required: ['taskNumber'],
          properties: {
            taskNumber: { type: 'integer', minimum: 1 },
            context: { type: 'string', maxLength: 500 },
          },
        },
        BrainExtract: {
          type: 'object',
          required: ['taskNumber'],
          properties: { taskNumber: { type: 'integer', minimum: 1 } },
        },
        RepoGrep: {
          type: 'object',
          required: ['pattern'],
          properties: {
            pattern: {
              type: 'string',
              minLength: 1,
              maxLength: 200,
              description: 'Fixed-string (escaped) search pattern.',
            },
            scope: {
              type: 'array',
              maxItems: 40,
              items: { type: 'string' },
              description: 'Optional path globs to restrict the search.',
            },
          },
        },
        StoryDraftCreate: {
          type: 'object',
          required: ['rawInput', 'provider', 'model', 'credentialId'],
          properties: {
            rawInput: { type: 'string', minLength: 10, maxLength: 4000 },
            provider: {
              type: 'string',
              enum: ['ANTHROPIC', 'OPENAI', 'GOOGLE', 'MOONSHOT'],
            },
            model: { type: 'string', minLength: 1, maxLength: 100 },
            credentialId: { type: 'string', format: 'cuid' },
            selectedPaths: {
              type: 'array',
              maxItems: 50,
              items: { type: 'string' },
            },
            citedMemoryIds: {
              type: 'array',
              maxItems: 20,
              items: { type: 'string' },
            },
          },
        },
        StoryDraftPublish: {
          type: 'object',
          required: ['stateId'],
          properties: {
            stateId: { type: 'string', format: 'cuid' },
            includeSubtasks: {
              type: 'array',
              items: { type: 'integer', minimum: 0 },
              default: [],
            },
            finalTitle: { type: 'string', minLength: 1, maxLength: 200 },
            finalDescription: { type: 'string', maxLength: 20000 },
          },
        },
        BugReport: {
          type: 'object',
          required: ['title', 'description'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string', minLength: 1, maxLength: 20000 },
            reproSteps: { type: 'string', maxLength: 20000 },
            stackTrace: { type: 'string', maxLength: 50000 },
            priority: { type: 'string', enum: PRIORITY_ENUM, default: 'HIGH' },
          },
        },
        AiCommitMessage: {
          type: 'object',
          required: ['diffSummary'],
          properties: { diffSummary: { type: 'string', minLength: 1, maxLength: 20000 } },
        },
        AiPrDescription: {
          type: 'object',
          properties: { diffStats: { type: 'string', maxLength: 20000 } },
        },
      },
      responses: {
        BadRequest: {
          description: 'Invalid request body or parameters.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Unauthorized: {
          description: 'Missing, malformed, expired or revoked credentials.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Forbidden: {
          description: 'Authenticated but lacking the required scope, project access, or role.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        NotFound: {
          description: 'Resource not found or not visible to the caller.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
    paths: {
      '/api/v1/openapi.json': {
        get: op({
          summary: 'OpenAPI discovery document',
          description: 'Returns this OpenAPI 3.1 document. Public — no auth required.',
          tags: ['discovery'],
          operationId: 'getOpenApi',
          security: 'token', // listed for shape; the route does not enforce it
          responses: { '200': ok('The OpenAPI document.') },
        }),
      },
      '/api/v1/tasks': {
        get: op({
          summary: 'List tasks across projects',
          description:
            'List tasks visible to the token, optionally filtered. Capped at 200 ' +
            'results, ordered by most recently updated.',
          tags: ['tasks'],
          operationId: 'listTasks',
          security: 'token',
          scopes: ['tasks:read'],
          parameters: [
            query('project', 'Restrict to a single project slug.', { type: 'string' }),
            query('assignedToMe', 'Only tasks assigned to the token owner.', {
              type: 'string',
              enum: ['true', 'false'],
            }),
            query('state', 'Filter by workflow state name.', { type: 'string' }),
          ],
          responses: { '200': ok('A list of tasks.') },
        }),
      },
      '/api/v1/projects/{slug}/tasks': {
        get: op({
          summary: 'List a project\'s tasks',
          tags: ['tasks'],
          operationId: 'listProjectTasks',
          security: 'token',
          scopes: ['tasks:read'],
          parameters: [slugParam],
          responses: { '200': ok('Tasks for the project, ordered by task number desc.') },
        }),
        post: op({
          summary: 'Create a task',
          tags: ['tasks'],
          operationId: 'createTask',
          security: 'token',
          scopes: ['tasks:write'],
          parameters: [slugParam],
          requestBody: jsonBody('#/components/schemas/TaskCreate'),
          responses: { '201': ok('The created task.') },
        }),
      },
      '/api/v1/projects/{slug}/tasks/{taskNumber}': {
        get: op({
          summary: 'Get a task',
          description: 'Returns the task with its subtasks and comments.',
          tags: ['tasks'],
          operationId: 'getTask',
          security: 'token',
          scopes: ['tasks:read'],
          parameters: [slugParam, taskNumberParam],
          responses: { '200': ok('The task detail.') },
        }),
        patch: op({
          summary: 'Update a task',
          description:
            'Update title, description, priority and/or move state. Moving into a ' +
            'DONE state triggers brain extraction.',
          tags: ['tasks'],
          operationId: 'updateTask',
          security: 'token',
          scopes: ['tasks:write'],
          parameters: [slugParam, taskNumberParam],
          requestBody: jsonBody('#/components/schemas/TaskPatch'),
          responses: { '200': ok('Acknowledgement `{ ok: true }`.') },
        }),
      },
      '/api/v1/projects/{slug}/tasks/{taskNumber}/comments': {
        post: op({
          summary: 'Add a comment to a task',
          tags: ['tasks'],
          operationId: 'createTaskComment',
          security: 'token',
          scopes: ['comments:write'],
          parameters: [slugParam, taskNumberParam],
          requestBody: jsonBody('#/components/schemas/CommentCreate'),
          responses: { '201': ok('The created comment id and timestamp.') },
        }),
      },
      '/api/v1/projects/{slug}/tasks/{taskNumber}/ai/commit-message': {
        post: op({
          summary: 'Generate a commit message for a task',
          tags: ['tasks'],
          operationId: 'aiCommitMessage',
          security: 'token',
          scopes: ['tasks:read'],
          parameters: [slugParam, taskNumberParam],
          requestBody: jsonBody('#/components/schemas/AiCommitMessage'),
          responses: { '200': ok('The generated commit message.') },
        }),
      },
      '/api/v1/projects/{slug}/tasks/{taskNumber}/ai/pr-description': {
        post: op({
          summary: 'Generate a PR description for a task',
          tags: ['tasks'],
          operationId: 'aiPrDescription',
          security: 'token',
          scopes: ['tasks:read'],
          parameters: [slugParam, taskNumberParam],
          requestBody: jsonBody('#/components/schemas/AiPrDescription', false),
          responses: { '200': ok('The generated PR description.') },
        }),
      },
      '/api/v1/projects/{slug}/brain/memories': {
        get: op({
          summary: 'List brain memories',
          tags: ['brain'],
          operationId: 'listMemories',
          security: 'token',
          scopes: ['brain:read'],
          parameters: [
            slugParam,
            query('scope', 'Filter by memory scope.', {
              type: 'string',
              enum: ['LOCAL', 'PROJECT'],
            }),
          ],
          responses: { '200': ok('Visible memories (capped at 200).') },
        }),
        post: op({
          summary: 'Create a brain memory',
          tags: ['brain'],
          operationId: 'createMemory',
          security: 'token',
          scopes: ['brain:write'],
          parameters: [slugParam],
          requestBody: jsonBody('#/components/schemas/MemoryCreate'),
          responses: { '201': ok('The created memory id.') },
        }),
      },
      '/api/v1/projects/{slug}/brain/memories/{id}': {
        get: op({
          summary: 'Get a brain memory',
          tags: ['brain'],
          operationId: 'getMemory',
          security: 'token',
          scopes: ['brain:read'],
          parameters: [slugParam, memoryIdParam],
          responses: { '200': ok('The memory detail with citations.') },
        }),
        patch: op({
          summary: 'Update a brain memory',
          tags: ['brain'],
          operationId: 'updateMemory',
          security: 'token',
          scopes: ['brain:write'],
          parameters: [slugParam, memoryIdParam],
          requestBody: jsonBody('#/components/schemas/MemoryPatch'),
          responses: { '200': ok('Acknowledgement `{ ok: true }`.') },
        }),
      },
      '/api/v1/projects/{slug}/brain/memories/{id}/cite': {
        post: op({
          summary: 'Cite a memory from a task',
          tags: ['brain'],
          operationId: 'citeMemory',
          security: 'token',
          scopes: ['brain:write'],
          parameters: [slugParam, memoryIdParam],
          requestBody: jsonBody('#/components/schemas/MemoryCite'),
          responses: { '201': ok('Acknowledgement with the new citation id.') },
        }),
      },
      '/api/v1/projects/{slug}/brain/memories/{id}/publish': {
        post: op({
          summary: 'Publish a LOCAL memory to the project brain',
          tags: ['brain'],
          operationId: 'publishMemory',
          security: 'token',
          scopes: ['brain:write'],
          parameters: [slugParam, memoryIdParam],
          responses: { '200': ok('Acknowledgement `{ ok: true }`.') },
        }),
      },
      '/api/v1/projects/{slug}/brain/recall': {
        get: op({
          summary: 'Full-text recall over the project brain',
          tags: ['brain'],
          operationId: 'recallMemories',
          security: 'token',
          scopes: ['brain:read'],
          parameters: [
            slugParam,
            query('q', 'Search query (optional; omitted lists recent).', { type: 'string' }),
            query('limit', 'Max results (1-100, default 20).', {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 20,
            }),
          ],
          responses: { '200': ok('Ranked memory matches.') },
        }),
      },
      '/api/v1/projects/{slug}/brain/extract': {
        post: op({
          summary: 'Run the AI extractor on a task',
          description: 'Extracts LOCAL memories from a (typically closed) task.',
          tags: ['brain'],
          operationId: 'extractMemories',
          security: 'token',
          scopes: ['brain:write'],
          parameters: [slugParam],
          requestBody: jsonBody('#/components/schemas/BrainExtract'),
          responses: { '200': ok('The persisted memory ids.') },
        }),
      },
      '/api/v1/projects/{slug}/brain/pull': {
        get: op({
          summary: 'Incremental pull of the shared project brain',
          description: 'Returns memories changed since the caller\'s last pull and advances the cursor.',
          tags: ['brain'],
          operationId: 'pullBrain',
          security: 'token',
          scopes: ['brain:read'],
          parameters: [slugParam],
          responses: { '200': ok('Changed memories and the new sync cursor.') },
        }),
      },
      '/api/v1/projects/{slug}/files': {
        post: op({
          summary: 'Upload files to the project store',
          description:
            'multipart/form-data with one or more `file` parts. Session auth only ' +
            '(used by the web UI). VIEWER members cannot upload.',
          tags: ['files'],
          operationId: 'uploadFiles',
          security: 'session',
          parameters: [slugParam],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    file: {
                      type: 'array',
                      items: { type: 'string', format: 'binary' },
                    },
                  },
                  required: ['file'],
                },
              },
            },
          },
          responses: { '201': ok('Ids of the stored files.') },
        }),
      },
      '/api/v1/projects/{slug}/files/{id}': {
        get: op({
          summary: 'Download a file\'s bytes',
          description: 'Streams the file inline; `?download=1` forces an attachment. Session auth.',
          tags: ['files'],
          operationId: 'getFile',
          security: 'session',
          parameters: [
            slugParam,
            fileIdParam,
            query('download', 'Set to "1" to force a download.', {
              type: 'string',
              enum: ['1'],
            }),
          ],
          responses: {
            '200': {
              description: 'The raw file bytes.',
              content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
            },
          },
        }),
        delete: op({
          summary: 'Delete a file',
          description: 'Allowed for the uploader or any OWNER/ADMIN. Session auth.',
          tags: ['files'],
          operationId: 'deleteFile',
          security: 'session',
          parameters: [slugParam, fileIdParam],
          responses: { '200': ok('Acknowledgement `{ ok: true }`.') },
        }),
      },
      '/api/v1/projects/{slug}/files/{id}/context': {
        get: op({
          summary: 'Download a file\'s generated context (Markdown)',
          description: 'Returns the AI-cleaned Markdown artifact once READY. Session auth.',
          tags: ['files'],
          operationId: 'getFileContext',
          security: 'session',
          parameters: [slugParam, fileIdParam],
          responses: {
            '200': {
              description: 'The context Markdown.',
              content: { 'text/markdown': { schema: { type: 'string' } } },
            },
          },
        }),
      },
      '/api/v1/projects/{slug}/plan': {
        get: op({
          summary: 'Get the project\'s active AI plan snapshot',
          description: 'For polling during plan generation. Session auth.',
          tags: ['planning'],
          operationId: 'getPlan',
          security: 'session',
          parameters: [slugParam],
          responses: { '200': ok('The latest plan, or `{ plan: null }`.') },
        }),
      },
      '/api/v1/projects/{slug}/plan/attachments': {
        post: op({
          summary: 'Attach context files to the AI plan',
          description:
            'multipart/form-data with one or more `file` parts (images / PDF / ' +
            'text). Session auth. VIEWER members cannot attach.',
          tags: ['planning'],
          operationId: 'addPlanAttachments',
          security: 'session',
          parameters: [slugParam],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    file: {
                      type: 'array',
                      items: { type: 'string', format: 'binary' },
                    },
                  },
                  required: ['file'],
                },
              },
            },
          },
          responses: { '201': ok('Ids of the stored attachments.') },
        }),
      },
      '/api/v1/projects/{slug}/repo/tree': {
        get: op({
          summary: 'List the project repository tree',
          description: 'Sandboxed, read-only. Accepts a session cookie or a bearer token.',
          tags: ['repo'],
          operationId: 'repoTree',
          security: 'either',
          scopes: ['repo:read'],
          parameters: [
            slugParam,
            query('root', 'Subtree root (default ".").', { type: 'string' }),
            query('depth', 'Max depth 1-6 (default 2).', {
              type: 'integer',
              minimum: 1,
              maximum: 6,
              default: 2,
            }),
          ],
          responses: { '200': ok('The repository tree.') },
        }),
      },
      '/api/v1/projects/{slug}/repo/grep': {
        post: op({
          summary: 'Search the project repository',
          description: 'Fixed-string search. Accepts a session cookie or a bearer token.',
          tags: ['repo'],
          operationId: 'repoGrep',
          security: 'either',
          scopes: ['repo:read'],
          parameters: [slugParam],
          requestBody: jsonBody('#/components/schemas/RepoGrep'),
          responses: { '200': ok('Matching hits.') },
        }),
      },
      '/api/v1/projects/{slug}/repo/preview': {
        get: op({
          summary: 'Preview a file from the project repository',
          description: 'Optionally sliced by line range. Accepts a session cookie or a bearer token.',
          tags: ['repo'],
          operationId: 'repoPreview',
          security: 'either',
          scopes: ['repo:read'],
          parameters: [
            slugParam,
            query('path', 'Repo-relative file path.', { type: 'string' }, true),
            query('start', 'First line (1-based).', { type: 'integer', minimum: 1 }),
            query('end', 'Last line (1-based).', { type: 'integer', minimum: 1 }),
          ],
          responses: { '200': ok('The file content (possibly sliced).') },
        }),
      },
      '/api/v1/projects/{slug}/stories/drafts': {
        get: op({
          summary: 'List the caller\'s story drafts',
          tags: ['stories'],
          operationId: 'listStoryDrafts',
          security: 'either',
          scopes: ['stories:read'],
          parameters: [slugParam],
          responses: { '200': ok('The caller\'s drafts (capped at 100).') },
        }),
        post: op({
          summary: 'Start an AI story draft',
          description:
            'Creates the draft (status GENERATING) and runs generation in the ' +
            'background; poll the draft GET for progress.',
          tags: ['stories'],
          operationId: 'createStoryDraft',
          security: 'either',
          scopes: ['stories:write'],
          parameters: [slugParam],
          requestBody: jsonBody('#/components/schemas/StoryDraftCreate'),
          responses: { '201': ok('The new draft id.') },
        }),
      },
      '/api/v1/projects/{slug}/stories/drafts/{id}': {
        get: op({
          summary: 'Get a story draft',
          tags: ['stories'],
          operationId: 'getStoryDraft',
          security: 'either',
          scopes: ['stories:read'],
          parameters: [slugParam, draftIdParam],
          responses: { '200': ok('The draft with all generated sections.') },
        }),
      },
      '/api/v1/projects/{slug}/stories/drafts/{id}/publish': {
        post: op({
          summary: 'Publish a story draft as a task',
          description: 'Creates a STORY task plus the selected subtasks.',
          tags: ['stories'],
          operationId: 'publishStoryDraft',
          security: 'either',
          scopes: ['stories:write'],
          parameters: [slugParam, draftIdParam],
          requestBody: jsonBody('#/components/schemas/StoryDraftPublish'),
          responses: { '200': ok('The created task id and number.') },
        }),
      },
      '/api/v1/projects/{slug}/bugs': {
        post: op({
          summary: 'Report a bug',
          description: 'Creates a bug task in the project\'s first workflow state.',
          tags: ['bugs'],
          operationId: 'reportBug',
          security: 'token',
          scopes: ['bugs:write'],
          parameters: [slugParam],
          requestBody: jsonBody('#/components/schemas/BugReport'),
          responses: { '201': ok('The created bug task.') },
        }),
      },
    },
  };
}
