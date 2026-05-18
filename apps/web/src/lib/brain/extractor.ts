/**
 * Brain memory extractor: turn a closed task into 0-3 candidate memories.
 *
 * Invokes the AI router with purpose `brain.extract` (model: balanced/Sonnet
 * by default), parses the JSON array response, validates it with Zod, and
 * returns drafts. The caller persists them as BrainMemory rows with
 * scope=LOCAL for the relevant user.
 *
 * On any failure (no API key, model error, malformed JSON) we return an
 * empty array — extraction is a "best effort, never block the close flow"
 * operation.
 */
import { z } from 'zod';
import type { MemoryType } from '@prisma/client';
import { invokeAi } from '@/lib/ai/router';
import { buildTaskDigest } from './digest';

const MEMORY_TYPES = [
  'DECISION',
  'GOTCHA',
  'PATTERN',
  'ANTIPATTERN',
  'RUNBOOK',
  'GLOSSARY',
  'NOTE',
] as const;

const draftSchema = z.object({
  type: z.enum(MEMORY_TYPES),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
  tags: z.array(z.string().min(1).max(40)).max(8).default([]),
});

// Prompt asks for 0-3 memories, but Sonnet occasionally returns 4-5 when the
// task is information-rich. Accept up to 10; beyond that is almost certainly
// noise and we'd rather drop the batch than persist a wall of suggestions.
const responseSchema = z.array(draftSchema).max(10);

export interface MemoryDraft {
  type: MemoryType;
  title: string;
  body: string;
  tags: string[];
}

export interface ExtractionResult {
  drafts: MemoryDraft[];
  model: string;
  estimatedCostUsd: number;
  rawOutput: string;
}

/**
 * Extract memories from a closed task. `actorUserId` is the user who
 * triggered the close (used for AiInteraction attribution + audit downstream).
 */
export async function extractMemoriesFromTask(
  taskId: string,
  actorUserId: string,
): Promise<ExtractionResult> {
  const digest = await buildTaskDigest(taskId);
  if (!digest) {
    return { drafts: [], model: '', estimatedCostUsd: 0, rawOutput: '' };
  }

  let raw = '';
  let model = '';
  let cost = 0;
  try {
    const result = await invokeAi({
      purpose: 'brain.extract',
      context: digest.digest,
      userId: actorUserId,
      taskId,
    });
    raw = result.output;
    model = result.model;
    cost = result.estimatedCostUsd;
  } catch (err) {
    // No API key, model overloaded, etc. — silently degrade.
    return {
      drafts: [],
      model: '',
      estimatedCostUsd: 0,
      rawOutput: `EXTRACTION_FAILED: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { drafts: parseDrafts(raw), model, estimatedCostUsd: cost, rawOutput: raw };
}

/**
 * Defensive JSON parse. The prompt instructs the model to emit a bare JSON
 * array, but real models occasionally wrap it in markdown fences or add a
 * stray prelude. Strip what we can, then validate.
 */
function parseDrafts(raw: string): MemoryDraft[] {
  const cleaned = stripCodeFence(raw).trim();
  if (cleaned === '') return [];
  try {
    const parsed = JSON.parse(cleaned);
    const validated = responseSchema.safeParse(parsed);
    if (!validated.success) return [];
    return validated.data;
  } catch {
    return [];
  }
}

function stripCodeFence(s: string): string {
  const m = s.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/m);
  return m ? m[1]! : s;
}
