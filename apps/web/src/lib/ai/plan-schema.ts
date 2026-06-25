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

// Lenient on enum-ish fields (the model may capitalize/drift); normalized at publish.
export const planTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().default(''),
  acceptanceCriteria: z.string().default(''),
  estimate: z.string().default(''),
  category: z.string().default('other'),
  recommendedRoles: z.array(z.string()).default([]),
  priority: z.string().default('MEDIUM'),
  kind: z.string().default('TASK'),
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
  estimate: { type: 'string', description: 'e.g. "2d", "5 pts".' },
  category: { type: 'string', enum: PLAN_CATEGORIES as unknown as string[] },
  recommendedRoles: { type: 'array', items: { type: 'string' } },
  priority: { type: 'string', enum: VALID_PRIORITY },
  kind: { type: 'string', enum: VALID_KIND },
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
