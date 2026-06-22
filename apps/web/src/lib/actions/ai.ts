'use server';

import { audit } from '@/lib/audit';
import { assertProjectMember } from '@/lib/auth/membership';
import { invokeAi } from '@/lib/ai/router';
import { aiInvokeSchema, type AiInvokeInput } from '@admin/shared/schemas';

export interface AiResult {
  ok: true;
  output: string;
  model: string;
  estimatedCostUsd: number;
}

export async function invokeAiAction(
  projectSlug: string,
  input: AiInvokeInput,
): Promise<AiResult | { ok: false; error: string }> {
  const parsed = aiInvokeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };

  const ctx = await assertProjectMember(projectSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  try {
    const result = await invokeAi({
      purpose: parsed.data.purpose,
      context: parsed.data.context,
      userId: ctx.userId,
      projectId: ctx.projectId,
    });

    await audit({
      actorId: ctx.userId,
      action: 'ai.invoke',
      resourceType: 'ai',
      resourceId: parsed.data.purpose,
      projectId: ctx.projectId,
      payload: { model: result.model, cost: result.estimatedCostUsd },
    });

    return {
      ok: true,
      output: result.output,
      model: result.model,
      estimatedCostUsd: result.estimatedCostUsd,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error de IA';
    return { ok: false, error: message };
  }
}
