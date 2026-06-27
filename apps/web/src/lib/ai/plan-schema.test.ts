import { describe, it, expect } from 'vitest';
import {
  PLAN_CATEGORIES,
  REPO_KINDS,
  planTaskSchema,
  planSprintSchema,
  suggestedRepoSchema,
  generatedPlanSchema,
  normalizeCategory,
  normalizePriority,
  normalizeKind,
  normalizeEstimates,
  reestimateResultSchema,
  PLAN_TOOL_SCHEMA,
  PLAN_TASK_TOOL_SCHEMA,
  REESTIMATE_TOOL_SCHEMA,
  type GeneratedPlan,
} from './plan-schema';

describe('normalizeCategory', () => {
  it('passes through exact known lanes', () => {
    for (const c of PLAN_CATEGORIES) expect(normalizeCategory(c)).toBe(c);
  });

  it('maps fuzzy synonyms to a known lane', () => {
    expect(normalizeCategory('Infrastructure')).toBe('infra');
    expect(normalizeCategory('kubernetes')).toBe('infra');
    expect(normalizeCategory('REST api')).toBe('backend');
    expect(normalizeCategory('database')).toBe('backend');
    expect(normalizeCategory('frontend ui')).toBe('frontend');
    expect(normalizeCategory('client')).toBe('frontend');
    expect(normalizeCategory('UX design')).toBe('design');
    expect(normalizeCategory('quality assurance')).toBe('qa');
    expect(normalizeCategory('CI pipeline')).toBe('devops');
    expect(normalizeCategory('documentation')).toBe('docs');
  });

  it('falls back to other for null/unknown', () => {
    expect(normalizeCategory(null)).toBe('other');
    expect(normalizeCategory(undefined)).toBe('other');
    expect(normalizeCategory('zzz nonsense')).toBe('other');
  });
});

describe('normalizePriority / normalizeKind', () => {
  it('normalizes priority, defaulting to MEDIUM', () => {
    expect(normalizePriority('high')).toBe('HIGH');
    expect(normalizePriority('  urgent ')).toBe('URGENT');
    expect(normalizePriority('bogus')).toBe('MEDIUM');
    expect(normalizePriority(undefined as unknown as string)).toBe('MEDIUM');
  });

  it('normalizes kind, defaulting to TASK', () => {
    expect(normalizeKind('story')).toBe('STORY');
    expect(normalizeKind('EPIC')).toBe('EPIC');
    expect(normalizeKind('nope')).toBe('TASK');
  });
});

describe('schema defaults', () => {
  it('planTaskSchema fills defaults', () => {
    const t = planTaskSchema.parse({ title: 'X' });
    expect(t.description).toBe('');
    expect(t.priority).toBe('MEDIUM');
    expect(t.kind).toBe('TASK');
    expect(t.assignment).toBeNull();
    expect(t.estimateBySeniority).toEqual({ junior: '', semiSenior: '', senior: '' });
  });

  it('planSprintSchema and suggestedRepoSchema fill defaults', () => {
    const s = planSprintSchema.parse({ name: 'Sprint 1' });
    expect(s.tasks).toEqual([]);
    const r = suggestedRepoSchema.parse({ name: 'web' });
    expect(r.defaultBranch).toBe('main');
    expect(r.status).toBe('NEW');
  });

  it('generatedPlanSchema fills defaults', () => {
    const g = generatedPlanSchema.parse({});
    expect(g.improvedIdea).toBe('');
    expect(g.sprints).toEqual([]);
    expect(g.suggestedRepos).toEqual([]);
  });

  it('reestimateResultSchema parses items and defaults', () => {
    expect(reestimateResultSchema.parse({}).items).toEqual([]);
    const r = reestimateResultSchema.parse({
      items: [{ s: 0, t: 1, estimateBySeniority: { junior: '1d', semiSenior: '6h', senior: '3h' } }],
    });
    expect(r.items[0]!.estimate).toBe('');
    expect(r.items[0]!.estimateBySeniority.junior).toBe('1d');
  });
});

describe('normalizeEstimates', () => {
  function plan(by: { junior: string; semiSenior: string; senior: string }): GeneratedPlan {
    return {
      improvedIdea: '',
      suggestedRepos: [],
      sprints: [
        {
          name: 'S',
          goal: '',
          tasks: [
            {
              title: 'T',
              description: '',
              acceptanceCriteria: '',
              estimate: 'orig',
              estimateBySeniority: by,
              category: 'other',
              recommendedRoles: [],
              priority: 'MEDIUM',
              kind: 'TASK',
              repo: '',
              assignment: null,
            },
          ],
        },
      ],
    };
  }

  it('builds a junior–senior range when both present', () => {
    const g = normalizeEstimates(plan({ junior: '1d', semiSenior: '6h', senior: '3h' }));
    expect(g.sprints[0]!.tasks[0]!.estimate).toBe('1d–3h');
  });

  it('collapses equal junior/senior to a single value', () => {
    const g = normalizeEstimates(plan({ junior: '4h', semiSenior: '4h', senior: '4h' }));
    expect(g.sprints[0]!.tasks[0]!.estimate).toBe('4h');
  });

  it('uses whichever single bound is present', () => {
    expect(normalizeEstimates(plan({ junior: '2d', semiSenior: '', senior: '' })).sprints[0]!.tasks[0]!.estimate).toBe('2d');
    expect(normalizeEstimates(plan({ junior: '', semiSenior: '', senior: '5h' })).sprints[0]!.tasks[0]!.estimate).toBe('5h');
  });

  it('leaves the model estimate when nothing per-seniority', () => {
    const g = normalizeEstimates(plan({ junior: '', semiSenior: '', senior: '' }));
    expect(g.sprints[0]!.tasks[0]!.estimate).toBe('orig');
  });
});

describe('exported JSON schemas / constants', () => {
  it('expose stable shapes', () => {
    expect(REPO_KINDS).toContain('backend');
    expect(PLAN_TOOL_SCHEMA.required).toContain('improvedIdea');
    expect(PLAN_TASK_TOOL_SCHEMA.required).toContain('title');
    expect(REESTIMATE_TOOL_SCHEMA.required).toContain('items');
  });
});
