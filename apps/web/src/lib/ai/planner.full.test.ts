import { describe, it, expect, vi, beforeEach } from 'vitest';

const anthropicCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = { create: anthropicCreate };
    constructor(_opts: unknown) {}
  },
}));

const aiInteractionCreate = vi.fn();
vi.mock('@/lib/db', () => ({ prisma: { aiInteraction: { create: (...a: unknown[]) => aiInteractionCreate(...a) } } }));

vi.mock('@prisma/client', () => ({
  Prisma: { Decimal: class Decimal { constructor(public value: unknown) {} toString() { return String(this.value); } } },
}));

let envConfig: Record<string, unknown>;
vi.mock('@/lib/env', () => ({ env: () => envConfig }));

const infraChat = vi.fn();
vi.mock('./infra-llm', () => ({ infraChat: (...a: unknown[]) => infraChat(...a) }));

const BASE_ENV = {
  ANTHROPIC_API_KEY: 'sk-ant-test',
  AI_MODEL_FAST: 'claude-haiku-4-5-20251001',
  AI_MODEL_BALANCED: 'claude-sonnet-4-6',
  AI_MODEL_DEEP: 'claude-opus-4-8',
};

import {
  planChatReply,
  generatePlan,
  refinePlanTask,
  generateImplementationPlan,
  reestimatePlan,
  estimateTaskForSeniority,
  refineStoryForReadiness,
  generateDesignSpec,
  genSystem,
} from './planner';
import type { PlanTask } from './plan-schema';

const PROJECT = { name: 'Axon', description: 'Una app' };
const USAGE = { input_tokens: 1000, output_tokens: 500 };

function textReply(text: string) {
  return { content: text ? [{ type: 'text', text }] : [{ type: 'tool_use', name: 'x', input: {} }], usage: USAGE };
}
function toolReply(name: string, input: unknown) {
  return { content: [{ type: 'text', text: 'preamble' }, { type: 'tool_use', name, input }], usage: USAGE };
}

const SAMPLE_TASK: PlanTask = {
  title: 'Login',
  description: 'desc',
  acceptanceCriteria: '- [ ] a',
  estimate: '3h–1d',
  estimateBySeniority: { junior: '1d', semiSenior: '6h', senior: '3h' },
  category: 'backend',
  recommendedRoles: ['be'],
  priority: 'HIGH',
  kind: 'STORY',
  repo: 'api',
  assignment: null,
};

beforeEach(() => {
  envConfig = { ...BASE_ENV };
  anthropicCreate.mockReset();
  aiInteractionCreate.mockReset();
  aiInteractionCreate.mockResolvedValue({});
  infraChat.mockReset();
});

describe('planChatReply', () => {
  it('greets on the opening turn and records cost on the balanced model', async () => {
    anthropicCreate.mockResolvedValue(textReply('¡Hola! ¿Cuál es el objetivo?'));
    const out = await planChatReply(PROJECT, [], 'es', '', 'u1', 'p1');
    expect(out).toContain('Hola');
    const arg = anthropicCreate.mock.calls[0]![0];
    expect(arg.model).toBe('claude-sonnet-4-6');
    expect(arg.messages[0].content).toContain('Inicia la planeación');
    expect(arg.messages[0].content).toContain('Proyecto: "Axon"');
    const rec = aiInteractionCreate.mock.calls[0]![0].data;
    expect(rec.purpose).toBe('plan.chat');
    // sonnet 1000*3/1e6 + 500*15/1e6 = 0.0105
    expect(String(rec.estimatedCostUsd)).toBe('0.010500');
  });

  it('includes the attachment manifest and prior messages on later turns', async () => {
    anthropicCreate.mockResolvedValue(textReply('respuesta'));
    await planChatReply(PROJECT, [{ role: 'user', content: 'hola' }], 'es', 'IMG: foo.png', 'u', 'p');
    const arg = anthropicCreate.mock.calls[0]![0];
    expect(arg.messages[0].content).toContain('Contexto adjunto:');
    expect(arg.messages[0].content).not.toContain('Inicia la planeación');
    expect(arg.messages[1]).toEqual({ role: 'user', content: 'hola' });
  });

  it('falls back to a prompt when the model returns no text (es / en)', async () => {
    anthropicCreate.mockResolvedValue(textReply(''));
    expect(await planChatReply(PROJECT, [], 'es', '', 'u', 'p')).toBe('¿Podrías contarme un poco más?');
    anthropicCreate.mockResolvedValue(textReply(''));
    expect(await planChatReply(PROJECT, [], 'en', '', 'u', 'p')).toBe('Could you tell me a bit more?');
  });

  it('uses {in:0,out:0} pricing for an unpriced model and swallows record failures', async () => {
    envConfig.AI_MODEL_BALANCED = 'unpriced';
    aiInteractionCreate.mockRejectedValueOnce(new Error('db down'));
    anthropicCreate.mockResolvedValue(textReply('ok'));
    const out = await planChatReply({ name: 'P', description: null }, [], 'es', '', 'u', 'p');
    expect(out).toBe('ok');
    expect(String(aiInteractionCreate.mock.calls[0]![0].data.estimatedCostUsd)).toBe('0.000000');
  });
});

describe('generatePlan', () => {
  const PLAN_INPUT = {
    improvedIdea: 'idea',
    sprints: [{ name: 'S1', goal: 'g', tasks: [SAMPLE_TASK] }],
    suggestedRepos: [{ name: 'api', kind: 'backend', stack: 'node', reason: 'r' }],
  };

  it('returns the parsed plan from the EmitPlan tool call (with images + docs)', async () => {
    anthropicCreate.mockResolvedValue(toolReply('EmitPlan', PLAN_INPUT));
    const plan = await generatePlan(
      PROJECT,
      [{ role: 'user', content: 'ctx' }],
      'es',
      [{ mediaType: 'image/png', base64: 'AAA' }],
      [{ label: 'doc.pdf', text: 'contenido' }],
      'u',
      'p',
      'Tamaño: 10 nodos.',
    );
    expect(plan.improvedIdea).toBe('idea');
    expect(plan.suggestedRepos[0]!.name).toBe('api');
    const arg = anthropicCreate.mock.calls[0]![0];
    expect(arg.model).toBe('claude-opus-4-8');
    expect(arg.tool_choice).toEqual({ type: 'tool', name: 'EmitPlan' });
    expect(arg.system).toContain('MAPA DEL CÓDIGO'); // brownfield code context
    // final user block contains the doc context + an image block
    const lastMsg = arg.messages.at(-1).content;
    expect(lastMsg.some((b: { type: string }) => b.type === 'image')).toBe(true);
    expect(lastMsg[0].text).toContain('doc.pdf');
  });

  it('omits the doc context when there are no docs/images', async () => {
    anthropicCreate.mockResolvedValue(toolReply('EmitPlan', PLAN_INPUT));
    await generatePlan(PROJECT, [], 'en', [], [], 'u', 'p');
    const lastMsg = anthropicCreate.mock.calls[0]![0].messages.at(-1).content;
    expect(lastMsg[0].text).not.toContain('Documentos/enlaces');
  });

  it('throws when no EmitPlan tool block is returned', async () => {
    anthropicCreate.mockResolvedValue(textReply('just text'));
    await expect(generatePlan(PROJECT, [], 'es', [], [], 'u', 'p')).rejects.toThrow('no devolvió un plan');
  });

  it('throws when the response was truncated by max_tokens (instead of saving an empty plan)', async () => {
    anthropicCreate.mockResolvedValue({ ...toolReply('EmitPlan', PLAN_INPUT), stop_reason: 'max_tokens' });
    await expect(generatePlan(PROJECT, [], 'es', [], [], 'u', 'p')).rejects.toThrow('truncado');
  });

  it('throws when the emitted plan has zero tasks across all sprints', async () => {
    anthropicCreate.mockResolvedValue(
      toolReply('EmitPlan', { ...PLAN_INPUT, sprints: [{ name: 'S1', goal: 'g', tasks: [] }] }),
    );
    await expect(generatePlan(PROJECT, [], 'es', [], [], 'u', 'p')).rejects.toThrow('sin tareas');
  });
});

describe('refinePlanTask', () => {
  it('returns the refined task (with focus note + sprint siblings)', async () => {
    anthropicCreate.mockResolvedValue(toolReply('EmitTask', SAMPLE_TASK));
    const t = await refinePlanTask(
      PROJECT,
      'idea afinada',
      { name: 'S1', goal: 'meta', siblingTitles: ['Otra HU'] },
      SAMPLE_TASK,
      'enfócate en seguridad',
      'es',
      'u',
      'p',
    );
    expect(t.title).toBe('Login');
    const arg = anthropicCreate.mock.calls[0]![0];
    expect(arg.tool_choice.name).toBe('EmitTask');
    const ctx = arg.messages[0].content;
    expect(ctx).toContain('Idea afinada: idea afinada');
    expect(ctx).toContain('Otras HUs del sprint');
    expect(ctx).toContain('Instrucción de enfoque');
  });

  it('uses the default refinement instruction when no focus note', async () => {
    anthropicCreate.mockResolvedValue(toolReply('EmitTask', SAMPLE_TASK));
    await refinePlanTask(PROJECT, '', { name: 'S', goal: '', siblingTitles: [] }, SAMPLE_TASK, '  ', 'es', 'u', 'p');
    expect(anthropicCreate.mock.calls[0]![0].messages[0].content).toContain('Sin instrucción específica');
  });

  it('throws when no EmitTask block is returned', async () => {
    anthropicCreate.mockResolvedValue(textReply('nope'));
    await expect(
      refinePlanTask(PROJECT, '', { name: 'S', goal: '', siblingTitles: [] }, SAMPLE_TASK, '', 'es', 'u', 'p'),
    ).rejects.toThrow('no devolvió la HU refinada');
  });
});

describe('generateImplementationPlan', () => {
  it('returns the markdown plan grounded in repo files', async () => {
    anthropicCreate.mockResolvedValue(textReply('# Plan\n...'));
    const md = await generateImplementationPlan(
      PROJECT,
      SAMPLE_TASK,
      { name: 'S1', goal: 'meta' },
      'idea',
      'tree outline',
      [{ path: 'a.ts', content: 'x', language: 'ts', truncated: true }],
      'es',
      'u',
      'p',
    );
    expect(md).toContain('# Plan');
    const user = anthropicCreate.mock.calls[0]![0].messages[0].content;
    expect(user).toContain('Idea afinada del proyecto: idea');
    expect(user).toContain('### `a.ts` (truncado)');
  });

  it('handles no repo files / no improved idea and throws on empty output', async () => {
    anthropicCreate.mockResolvedValue(textReply('plan'));
    await generateImplementationPlan(PROJECT, SAMPLE_TASK, { name: 'S', goal: '' }, '', 'tree', [], 'en', 'u', 'p');
    const user = anthropicCreate.mock.calls[0]![0].messages[0].content;
    expect(user).toContain('(sin archivos del repositorio incluidos)');

    anthropicCreate.mockResolvedValue(textReply(''));
    await expect(
      generateImplementationPlan(PROJECT, SAMPLE_TASK, { name: 'S', goal: '' }, '', 'tree', [], 'es', 'u', 'p'),
    ).rejects.toThrow('no devolvió el plan de implementación');
  });
});

describe('refineStoryForReadiness (Product Owner)', () => {
  const STORY = { title: 'HU X', description: '', acceptanceCriteria: '', priority: 'LOW' };

  it('devuelve descripción + criterios + prioridad desde EmitRefinement', async () => {
    anthropicCreate.mockResolvedValue(
      toolReply('EmitRefinement', { description: 'clara', acceptanceCriteria: '- [ ] c', priority: 'HIGH' }),
    );
    const out = await refineStoryForReadiness(STORY, PROJECT, 'es', 'u', 'p');
    expect(out).toEqual({ description: 'clara', acceptanceCriteria: '- [ ] c', priority: 'HIGH' });
    const arg = anthropicCreate.mock.calls[0]![0];
    expect(arg.tool_choice).toMatchObject({ name: 'EmitRefinement' });
    expect(arg.messages[0].content).toContain('HU X');
  });

  it('cae a MEDIUM ante una prioridad inválida y conserva la descripción original si falta', async () => {
    anthropicCreate.mockResolvedValue(
      toolReply('EmitRefinement', { acceptanceCriteria: '- [ ] c', priority: 'BOGUS' }),
    );
    const out = await refineStoryForReadiness({ ...STORY, description: 'vieja' }, PROJECT, 'es', 'u', 'p');
    expect(out.priority).toBe('MEDIUM');
    expect(out.description).toBe('vieja');
  });

  it('lanza si el modelo no emite la herramienta', async () => {
    anthropicCreate.mockResolvedValue(textReply('nope'));
    await expect(refineStoryForReadiness(STORY, PROJECT, 'es', 'u', 'p')).rejects.toThrow('no devolvió el refinamiento');
  });
});

describe('generateDesignSpec (Aria)', () => {
  const STORY = { title: 'Pantalla de login', description: 'clara', acceptanceCriteria: '- [ ] c' };

  it('devuelve notas + mockupPrompt desde EmitDesign', async () => {
    anthropicCreate.mockResolvedValue(
      toolReply('EmitDesign', { notes: '## Layout\n...', mockupPrompt: 'a clean login screen' }),
    );
    const out = await generateDesignSpec(STORY, PROJECT, 'es', 'u', 'p');
    expect(out).toEqual({ notes: '## Layout\n...', mockupPrompt: 'a clean login screen' });
    const arg = anthropicCreate.mock.calls[0]![0];
    expect(arg.tool_choice).toMatchObject({ name: 'EmitDesign' });
    expect(arg.messages[0].content).toContain('Pantalla de login');
  });

  it('sintetiza el mockupPrompt si el modelo lo omite (no falla el spec)', async () => {
    anthropicCreate.mockResolvedValue(toolReply('EmitDesign', { notes: '## Layout' }));
    const out = await generateDesignSpec(STORY, PROJECT, 'es', 'u', 'p');
    expect(out.notes).toBe('## Layout');
    expect(out.mockupPrompt).toContain('Pantalla de login'); // derivado del título
  });

  it('lanza si faltan las notas o no hay herramienta', async () => {
    anthropicCreate.mockResolvedValue(toolReply('EmitDesign', { mockupPrompt: 'x' }));
    await expect(generateDesignSpec(STORY, PROJECT, 'es', 'u', 'p')).rejects.toThrow('incompleto');
    anthropicCreate.mockResolvedValue(textReply('nope'));
    await expect(generateDesignSpec(STORY, PROJECT, 'es', 'u', 'p')).rejects.toThrow('no devolvió el spec de diseño');
  });
});

describe('reestimatePlan', () => {
  it('short-circuits to [] with no items', async () => {
    expect(await reestimatePlan({ projectName: 'P', description: null, improvedIdea: '', stack: '' }, [], 'es', 'u', 'p')).toEqual([]);
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it('returns parsed estimates from EmitEstimates (with stack + idea)', async () => {
    anthropicCreate.mockResolvedValue(
      toolReply('EmitEstimates', { items: [{ s: 0, t: 0, estimate: '3h–1d', estimateBySeniority: { junior: '1d', semiSenior: '6h', senior: '3h' } }] }),
    );
    const items = await reestimatePlan(
      { projectName: 'P', description: 'd', improvedIdea: 'idea', stack: 'node' },
      [{ s: 0, t: 0, title: 'T', description: 'x'.repeat(400), category: 'backend', repo: 'api' }],
      'es',
      'u',
      'p',
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.estimate).toBe('3h–1d');
    const user = anthropicCreate.mock.calls[0]![0].messages[0].content;
    expect(user).toContain('Idea afinada: idea');
    expect(user).toContain('Stack / repos: node');
  });

  it('throws when no EmitEstimates block is returned', async () => {
    anthropicCreate.mockResolvedValue(textReply('nope'));
    await expect(
      reestimatePlan({ projectName: 'P', description: null, improvedIdea: '', stack: '' }, [{ s: 0, t: 0, title: 'T', description: 'd', category: 'c', repo: '' }], 'es', 'u', 'p'),
    ).rejects.toThrow('no devolvió las estimaciones');
  });
});

describe('estimateTaskForSeniority', () => {
  const task = { title: 'T', description: 'd', category: 'backend', repo: 'api' };
  const ctx = { stack: 'node', improvedIdea: 'idea' };

  it('extracts a short duration from the model line (junior)', async () => {
    infraChat.mockResolvedValue('Estimación: 4h aproximadamente\notra línea');
    expect(await estimateTaskForSeniority(task, ctx, 'JUNIOR', 'es')).toBe('4h');
    const sys = infraChat.mock.calls[0]![0];
    expect(sys).toContain('junior');
  });

  it('labels senior and semi-senior correctly', async () => {
    infraChat.mockResolvedValue('2d');
    await estimateTaskForSeniority(task, ctx, 'SENIOR', 'en');
    expect(infraChat.mock.calls[0]![0]).toContain('senior');
    infraChat.mockResolvedValue('1d');
    await estimateTaskForSeniority(task, ctx, 'SEMI_SENIOR', 'es');
    expect(infraChat.mock.calls[1]![0]).toContain('semi-senior');
  });

  it('falls back to the trimmed first line when no duration pattern matches', async () => {
    infraChat.mockResolvedValue('no idea at all about this very long line that exceeds the cap easily');
    const out = await estimateTaskForSeniority({ title: 'T', description: 'd', category: 'c', repo: '' }, { stack: '', improvedIdea: '' }, 'JUNIOR', 'es');
    expect(out.length).toBeLessThanOrEqual(16);
  });
});

describe('genSystem (delivery prompt)', () => {
  it('lists the EmitPlan contract fields', () => {
    const s = genSystem('es');
    expect(s).toContain('EmitPlan');
    expect(s).toContain('suggestedRepos');
  });
});

describe('client guard', () => {
  it('throws without an API key (fresh module)', async () => {
    vi.resetModules();
    envConfig = { ...BASE_ENV, ANTHROPIC_API_KEY: undefined };
    const mod = await import('./planner');
    await expect(mod.planChatReply(PROJECT, [], 'es', '', 'u', 'p')).rejects.toThrow('ANTHROPIC_API_KEY is not set');
  });
});
