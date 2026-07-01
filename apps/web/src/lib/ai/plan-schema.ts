import { z } from 'zod';

/** Roadmap lanes / task categories the planner assigns. */
export const PLAN_CATEGORIES = [
  'infra',
  'backend',
  'frontend',
  'design',
  'qa',
  'devops',
  'docs',
  'other',
] as const;
export type PlanCategory = (typeof PLAN_CATEGORIES)[number];

export const REPO_KINDS = ['backend', 'frontend', 'infra', 'mobile', 'shared', 'other'] as const;

// AI-assisted effort per seniority (junior / semi-senior / senior).
export const seniorityEstimateSchema = z.object({
  junior: z.string().default(''),
  semiSenior: z.string().default(''),
  senior: z.string().default(''),
});
export type SeniorityEstimate = z.infer<typeof seniorityEstimateSchema>;

// Lenient on enum-ish fields (the model may capitalize/drift); normalized at publish.
export const planTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().default(''),
  acceptanceCriteria: z.string().default(''),
  // Representative range "junior–senior" (derived from estimateBySeniority).
  estimate: z.string().default(''),
  // AI-assisted effort per seniority profile.
  estimateBySeniority: seniorityEstimateSchema.default({ junior: '', semiSenior: '', senior: '' }),
  category: z.string().default('other'),
  recommendedRoles: z.array(z.string()).default([]),
  priority: z.string().default('MEDIUM'),
  kind: z.string().default('TASK'),
  // Repo objetivo (nombre de un suggestedRepo / ProjectRepo) al que pertenece la HU.
  repo: z.string().default(''),
  // Miembro encargado elegido + tiempo recalculado para su seniority (Qwen).
  // Gestionado por la app (el modelo no lo emite).
  assignment: z
    .object({
      memberId: z.string(),
      memberName: z.string(),
      seniority: z.string(), // JUNIOR | SEMI_SENIOR | SENIOR
      estimate: z.string(),
    })
    .nullable()
    .default(null),
});
export type PlanTask = z.infer<typeof planTaskSchema>;

export const planSprintSchema = z.object({
  name: z.string().min(1).max(120),
  goal: z.string().default(''),
  tasks: z.array(planTaskSchema).default([]),
});

export const suggestedRepoSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.string().default('other'),
  stack: z.string().default(''),
  reason: z.string().default(''),
  // Campos gestionados por la app (el modelo no los emite).
  status: z.string().default('NEW'), // NEW | EXISTING
  url: z.string().default(''),
  githubFullName: z.string().default(''),
  defaultBranch: z.string().default('main'),
});

export const generatedPlanSchema = z.object({
  improvedIdea: z.string().default(''),
  sprints: z.array(planSprintSchema).default([]),
  suggestedRepos: z.array(suggestedRepoSchema).default([]),
});
export type GeneratedPlan = z.infer<typeof generatedPlanSchema>;

/** Normalize a free-form category into a known roadmap lane. */
export function normalizeCategory(raw: string | null | undefined): PlanCategory {
  const v = (raw ?? '').toLowerCase().trim();
  if ((PLAN_CATEGORIES as readonly string[]).includes(v)) return v as PlanCategory;
  if (/infra|infrastructure|cloud|terraform|k8s|kubernetes/.test(v)) return 'infra';
  if (/back|api|server|db|database/.test(v)) return 'backend';
  if (/front|ui|web|client/.test(v)) return 'frontend';
  if (/design|ux|ui\/ux/.test(v)) return 'design';
  if (/qa|test|quality/.test(v)) return 'qa';
  if (/devops|ci|cd|pipeline|deploy/.test(v)) return 'devops';
  if (/doc/.test(v)) return 'docs';
  return 'other';
}

const VALID_PRIORITY = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const VALID_KIND = ['TASK', 'STORY', 'EPIC', 'BUG', 'SPIKE'];
export function normalizePriority(raw: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' {
  const v = (raw ?? '').toUpperCase().trim();
  return (VALID_PRIORITY.includes(v) ? v : 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
}
export function normalizeKind(raw: string): 'TASK' | 'STORY' | 'EPIC' | 'BUG' | 'SPIKE' {
  const v = (raw ?? '').toUpperCase().trim();
  return (VALID_KIND.includes(v) ? v : 'TASK') as 'TASK' | 'STORY' | 'EPIC' | 'BUG' | 'SPIKE';
}

/** The properties block for a single PlanTask — shared by the full-plan schema
 *  and the single-task refinement schema. */
const PLAN_TASK_PROPERTIES = {
  title: { type: 'string' },
  description: { type: 'string' },
  acceptanceCriteria: { type: 'string', description: 'Markdown checklist or Given/When/Then.' },
  estimate: { type: 'string', description: 'Rango representativo "junior–senior", p. ej. "4h–1d".' },
  estimateBySeniority: {
    type: 'object',
    description: 'Esfuerzo asistido por IA por seniority (incluye revisión, pruebas, integración).',
    properties: {
      junior: { type: 'string', description: 'p. ej. "1d"' },
      semiSenior: { type: 'string', description: 'p. ej. "6h"' },
      senior: { type: 'string', description: 'p. ej. "3h"' },
    },
  },
  category: { type: 'string', enum: PLAN_CATEGORIES as unknown as string[] },
  recommendedRoles: { type: 'array', items: { type: 'string' } },
  priority: { type: 'string', enum: VALID_PRIORITY },
  kind: { type: 'string', enum: VALID_KIND },
  repo: {
    type: 'string',
    description: 'Nombre del repo objetivo (uno de suggestedRepos) al que pertenece esta HU.',
  },
} as const;

const PLAN_TASK_REQUIRED = ['title', 'description', 'acceptanceCriteria', 'estimate', 'category'];

/** JSON Schema for re-analyzing/refining ONE task (forced tool-use). */
export const PLAN_TASK_TOOL_SCHEMA = {
  type: 'object',
  properties: PLAN_TASK_PROPERTIES,
  required: PLAN_TASK_REQUIRED,
} as const;

/** JSON Schema handed to Anthropic tool-use to force structured output. */
export const PLAN_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    improvedIdea: {
      type: 'string',
      description: 'A refined, sharpened restatement of the product idea (2-5 sentences).',
    },
    sprints: {
      type: 'array',
      description: 'Ordered sprints from first to last.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          goal: { type: 'string' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: PLAN_TASK_PROPERTIES,
              required: PLAN_TASK_REQUIRED,
            },
          },
        },
        required: ['name', 'goal', 'tasks'],
      },
    },
    suggestedRepos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: REPO_KINDS as unknown as string[] },
          stack: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['name', 'kind', 'reason'],
      },
    },
  },
  required: ['improvedIdea', 'sprints', 'suggestedRepos'],
} as const;

/** Derive each task's representative `estimate` as the range "junior–senior"
 *  whenever the per-seniority breakdown is present. Mutates and returns `gen`. */
export function normalizeEstimates(gen: GeneratedPlan): GeneratedPlan {
  for (const sprint of gen.sprints) {
    for (const task of sprint.tasks) {
      const e = task.estimateBySeniority;
      const jr = (e?.junior ?? '').trim();
      const sr = (e?.senior ?? '').trim();
      if (jr && sr) task.estimate = jr === sr ? jr : `${jr}–${sr}`;
      else if (jr || sr) task.estimate = jr || sr;
      // else leave whatever estimate the model produced.
    }
  }
  return gen;
}

/** Tool schema for the batch re-estimation pass: returns estimates keyed by
 *  sprint/task index so the model doesn't have to re-emit the whole plan. */
export const REESTIMATE_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          s: { type: 'integer', description: 'índice del sprint' },
          t: { type: 'integer', description: 'índice de la HU dentro del sprint' },
          estimate: { type: 'string', description: 'rango "junior–senior"' },
          estimateBySeniority: {
            type: 'object',
            properties: {
              junior: { type: 'string' },
              semiSenior: { type: 'string' },
              senior: { type: 'string' },
            },
            required: ['junior', 'semiSenior', 'senior'],
          },
        },
        required: ['s', 't', 'estimateBySeniority'],
      },
    },
  },
  required: ['items'],
} as const;

export const reestimateResultSchema = z.object({
  items: z
    .array(
      z.object({
        s: z.number().int(),
        t: z.number().int(),
        estimate: z.string().default(''),
        estimateBySeniority: seniorityEstimateSchema,
      }),
    )
    .default([]),
});
export type ReestimateItem = z.infer<typeof reestimateResultSchema>['items'][number];

// QA test cases generated by AI for a single story (used by the QA view).
export const QA_TESTS_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    tests: {
      type: 'array',
      description: 'Casos de prueba de QA para verificar la HU.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Qué verifica el caso.' },
          steps: { type: 'string', description: 'Pasos para ejecutarlo (numerados si aplica).' },
          expected: { type: 'string', description: 'Resultado esperado.' },
        },
        required: ['title'],
      },
    },
  },
  required: ['tests'],
} as const;

export const qaTestsResultSchema = z.object({
  tests: z
    .array(
      z.object({
        title: z.string().min(1),
        steps: z.string().optional().default(''),
        expected: z.string().optional().default(''),
      }),
    )
    .default([]),
});
export type QaTestCaseAI = z.infer<typeof qaTestsResultSchema>['tests'][number];
