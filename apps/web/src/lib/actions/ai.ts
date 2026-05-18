'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
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
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'No autenticado' };

  const parsed = aiInvokeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };

  const project = await prisma.project.findUnique({
    where: { slug: projectSlug },
    select: { id: true, members: { where: { userId }, select: { role: true } } },
  });
  if (!project || project.members.length === 0) {
    return { ok: false, error: 'Sin acceso al proyecto' };
  }

  try {
    const result = await invokeAi({
      purpose: parsed.data.purpose,
      context: parsed.data.context,
      userId,
      projectId: project.id,
    });

    await audit({
      actorId: userId,
      action: 'ai.invoke',
      resourceType: 'ai',
      resourceId: parsed.data.purpose,
      projectId: project.id,
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
