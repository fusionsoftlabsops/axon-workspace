'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/auth';
import { audit } from '@/lib/audit';
import {
  createLlmCredential,
  listLlmCredentialsForUser,
  revokeLlmCredential,
} from '@/lib/llm-credentials/store';

const createSchema = z.object({
  provider: z.enum(['ANTHROPIC', 'OPENAI', 'GOOGLE', 'MOONSHOT']),
  label: z.string().min(1).max(80),
  plainKey: z.string().min(8).max(500),
  modelDefault: z.string().max(100).optional(),
  projectId: z.string().cuid().optional(),
});

export type CreateLlmCredInput = z.infer<typeof createSchema>;

export async function createLlmCredentialAction(
  input: CreateLlmCredInput,
): Promise<{ ok: true; id: string; keyPrefix: string } | { ok: false; error: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'No autenticado' };

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };

  try {
    const cred = await createLlmCredential({
      userId,
      provider: parsed.data.provider,
      label: parsed.data.label,
      plainKey: parsed.data.plainKey,
      modelDefault: parsed.data.modelDefault ?? null,
      projectId: parsed.data.projectId ?? null,
    });
    await audit({
      actorId: userId,
      action: 'llm_credential.create',
      resourceType: 'llm_credential',
      resourceId: cred.id,
      projectId: parsed.data.projectId,
      payload: { provider: parsed.data.provider, label: parsed.data.label },
    });
    revalidatePath('/settings/llm-credentials');
    return { ok: true, id: cred.id, keyPrefix: cred.keyPrefix };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'no se pudo guardar la credencial',
    };
  }
}

export async function revokeLlmCredentialAction(
  credentialId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'No autenticado' };

  const r = await revokeLlmCredential(userId, credentialId);
  if (!r.ok) return { ok: false, error: 'no encontrada o sin permisos' };

  await audit({
    actorId: userId,
    action: 'llm_credential.revoke',
    resourceType: 'llm_credential',
    resourceId: credentialId,
  });
  revalidatePath('/settings/llm-credentials');
  return { ok: true };
}

export async function listMyLlmCredentialsAction() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return [];
  return listLlmCredentialsForUser(userId);
}
