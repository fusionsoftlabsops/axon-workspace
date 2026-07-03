'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { assertProjectMember } from '@/lib/auth/membership';
import {
  decryptLlmCredentialKey,
  touchLlmCredential,
} from '@/lib/llm-credentials/store';
import { getProvider } from '@/lib/ai/providers/registry';
import { searchBrain } from '@/lib/brain/search';
import { repoReaderFor } from '@/lib/repo/reader';
import {
  buildStoryPrompt,
  storyOutputSchema,
  STORY_OUTPUT_JSON_SCHEMA,
  tolerantParse,
  treeOutline,
  type BrainMemoryForPrompt,
  type StoryOutput,
} from '@/lib/ai/story-prompt';
import { env } from '@/lib/env';
import {
  SERVER_CREDENTIAL_ID,
  serverCredentialAvailable,
} from '@/lib/llm-credentials/server-credential';

// ---------- Schemas ----------

const startSchema = z.object({
  rawInput: z.string().min(10).max(4000),
  provider: z.enum(['ANTHROPIC', 'OPENAI', 'GOOGLE', 'MOONSHOT']),
  model: z.string().min(1).max(100),
  credentialId: z.union([z.string().cuid(), z.literal(SERVER_CREDENTIAL_ID)]),
  selectedPaths: z.array(z.string()).max(50).default([]),
  citedMemoryIds: z.array(z.string()).max(20).default([]),
});

export type StartStoryInput = z.infer<typeof startSchema>;

const publishSchema = z.object({
  stateId: z.string().cuid(),
  includeSubtasks: z.array(z.number().int().nonnegative()).default([]),
  finalTitle: z.string().min(1).max(200).optional(),
  finalDescription: z.string().max(20_000).optional(),
});

export type PublishStoryInput = z.infer<typeof publishSchema>;

// ---------- Start ----------

export interface DraftCreatedResult {
  ok: boolean;
  draftId?: string;
  error?: string;
}

/**
 * Crea el StoryDraft (status=GENERATING) y devuelve su id. La generación
 * en sí (con streaming SSE) la dispara el route handler que abre el
 * canal SSE consumiendo `runDraftGeneration`.
 */
export async function startStoryDraftAction(
  projectSlug: string,
  input: StartStoryInput,
  asUserId?: string,
): Promise<DraftCreatedResult> {
  const ctx = await assertProjectMember(projectSlug, asUserId);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos para crear HUs' };

  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };

  if (parsed.data.credentialId === SERVER_CREDENTIAL_ID) {
    // Fallback a la key del servidor (la del chat del Plan). Solo Anthropic:
    // es el unico provider con key de entorno en este deploy.
    if (parsed.data.provider !== 'ANTHROPIC' || !serverCredentialAvailable()) {
      return { ok: false, error: 'Credencial del servidor no disponible' };
    }
  } else {
    const cred = await prisma.llmCredential.findUnique({
      where: { id: parsed.data.credentialId },
      select: { userId: true, projectId: true, provider: true, revokedAt: true },
    });
    if (!cred || cred.userId !== ctx.userId || cred.revokedAt) {
      return { ok: false, error: 'Credencial no válida' };
    }
    if (cred.projectId && cred.projectId !== ctx.projectId) {
      return { ok: false, error: 'Credencial es de otro proyecto' };
    }
    if (cred.provider !== parsed.data.provider) {
      return { ok: false, error: 'Provider no coincide con la credencial' };
    }
  }

  const draft = await prisma.storyDraft.create({
    data: {
      projectId: ctx.projectId,
      authorId: ctx.userId,
      rawInput: parsed.data.rawInput,
      provider: parsed.data.provider,
      model: parsed.data.model,
      selectedPaths: parsed.data.selectedPaths,
      citedMemoryIds: parsed.data.citedMemoryIds,
      status: 'GENERATING',
    },
    select: { id: true },
  });

  await audit({
    actorId: ctx.userId,
    action: 'story.draft.start',
    resourceType: 'story_draft',
    resourceId: draft.id,
    projectId: ctx.projectId,
    payload: {
      provider: parsed.data.provider,
      model: parsed.data.model,
      pathsCount: parsed.data.selectedPaths.length,
      memoriesCount: parsed.data.citedMemoryIds.length,
    },
  });

  // Kick off generation in background. El generador persiste cada sección
  // a DB conforme avanza; el viewer polls / abre SSE para observarlo.
  // Node process es long-lived (self-hosted, no serverless), así que la
  // promesa unawaited sigue corriendo.
  const bgUserId = ctx.userId;
  const bgDraftId = draft.id;
  void (async () => {
    try {
      for await (const _event of runDraftGeneration(bgDraftId, bgUserId)) {
        // runDraftGeneration ya persiste a DB en cada step; nada más que hacer.
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[stories.draft] background generation failed:', err);
    }
  })();

  return { ok: true, draftId: draft.id };
}

// ---------- Streaming generator (lo usa la route handler SSE) ----------

export type StorySectionKey =
  | 'summary'
  | 'acceptanceCriteria'
  | 'technicalContext'
  | 'subtaskBreakdown'
  | 'filesToTouch'
  | 'risks';

export type StreamEvent =
  | { type: 'section'; section: StorySectionKey; value: unknown }
  | { type: 'usage'; value: { inputTokens: number; outputTokens: number } }
  | { type: 'done'; value: { draftId: string; inputTokens: number; outputTokens: number; costUsd: number } }
  | { type: 'error'; message: string };

/**
 * Generador asíncrono que ejecuta el stream del LLM y emite eventos
 * estructurados. La route handler los serializa como SSE.
 */
export async function* runDraftGeneration(
  draftId: string,
  userId: string,
): AsyncGenerator<StreamEvent, void, void> {
  const draft = await prisma.storyDraft.findUnique({
    where: { id: draftId },
    include: {
      project: { select: { id: true, slug: true, name: true, repoPath: true } },
    },
  });
  if (!draft || draft.authorId !== userId) {
    yield { type: 'error', message: 'Draft no encontrado o sin permisos' };
    return;
  }
  if (draft.status !== 'GENERATING') {
    yield { type: 'error', message: `Draft en estado ${draft.status}; nada que generar` };
    return;
  }

  const started = Date.now();
  try {
    // ---- Credencial ----
    const credRow = await prisma.llmCredential.findFirst({
      where: {
        userId,
        provider: draft.provider,
        revokedAt: null,
        OR: [{ projectId: draft.projectId }, { projectId: null }],
      },
      orderBy: { lastUsedAt: 'desc' },
    });
    let apiKey: string;
    if (credRow) {
      apiKey = decryptLlmCredentialKey(credRow);
    } else if (draft.provider === 'ANTHROPIC' && serverCredentialAvailable()) {
      // Sin credencial personal: cae a la key del servidor (la del planner).
      apiKey = env().ANTHROPIC_API_KEY as string;
    } else {
      throw new Error('No hay credencial LLM válida para este provider');
    }

    // ---- Memorias del cerebro ----
    let memories: BrainMemoryForPrompt[] = [];
    if (draft.citedMemoryIds.length > 0) {
      const rows = await prisma.brainMemory.findMany({
        where: { id: { in: draft.citedMemoryIds }, projectId: draft.projectId },
        select: { id: true, type: true, title: true, body: true, tags: true },
      });
      memories = rows.map((r) => ({
        id: r.id,
        type: String(r.type),
        title: r.title,
        body: r.body,
        tags: r.tags,
      }));
    } else {
      const hits = await searchBrain({
        projectId: draft.projectId,
        requesterUserId: userId,
        includeAllLocals: false,
        query: draft.rawInput,
        limit: 5,
        filters: { status: ['ACTIVE'] },
      });
      memories = hits
        .filter((h) => (h.rank ?? 0) > 0.2)
        .map((h) => ({
          id: h.id,
          type: String(h.type),
          title: h.title,
          body: h.body,
          tags: h.tags,
        }));
    }

    // ---- Repo ----
    const reader = await repoReaderFor({ repoPath: draft.project.repoPath });
    let repoFiles: Awaited<ReturnType<NonNullable<typeof reader>['readFiles']>>['files'] = [];
    let treeText = 'Repositorio no configurado para este proyecto.';
    if (reader) {
      const tree = await reader.tree({ maxDepth: 3 });
      treeText = treeOutline(tree);
      if (draft.selectedPaths.length > 0) {
        const r = await reader.readFiles(draft.selectedPaths, { maxBytesTotal: 120_000 });
        repoFiles = r.files;
        await audit({
          actorId: userId,
          action: 'repo.read',
          resourceType: 'project',
          resourceId: draft.projectId,
          projectId: draft.projectId,
          payload: { files: r.files.length, truncated: r.truncated },
        });
      }
    }

    // ---- Build prompt ----
    const messages = buildStoryPrompt({
      rawInput: draft.rawInput,
      memories,
      repoTreeOutline: treeText,
      repoFiles,
      projectName: draft.project.name,
    });

    // ---- Stream con retry ante fallos transientes ----
    // La variabilidad inherente del LLM (corte de stream, glitch de schema)
    // se compensa con 1 retry. Errores estructurales (auth, credencial)
    // siguen fallando en el primer intento porque rompen antes del stream.
    const provider = getProvider(draft.provider);
    const MAX_ATTEMPTS = 2;
    let validated: z.SafeParseSuccess<StoryOutput> | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let lastFailureReason = 'sin detalles';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        const jitterMs = 200 + Math.floor(Math.random() * 800);
        // eslint-disable-next-line no-console
        console.warn('[stories.draft] retry', { draftId, attempt, jitterMs, lastFailureReason });
        await new Promise((r) => setTimeout(r, jitterMs));
      }

      let acc = '';
      const lastEmitted: Partial<Record<StorySectionKey, string>> = {};
      // Reset por intento — la UI verá el segundo intento sobrescribir el primero.
      inputTokens = 0;
      outputTokens = 0;

      try {
        for await (const chunk of provider.chatStream(
          {
            messages,
            model: draft.model,
            jsonMode: {
              schema: STORY_OUTPUT_JSON_SCHEMA as unknown as object,
              name: 'StoryOutput',
            },
            maxOutputTokens: 4000,
            temperature: 0.4,
          },
          apiKey,
        )) {
          if (chunk.delta) {
            acc += chunk.delta;
            const partial = tolerantParse(acc);
            if (partial) {
              for (const key of [
                'summary',
                'acceptanceCriteria',
                'technicalContext',
                'risks',
              ] as const) {
                const value = partial[key];
                if (typeof value === 'string' && value !== lastEmitted[key]) {
                  lastEmitted[key] = value;
                  yield { type: 'section', section: key, value };
                }
              }
              for (const key of ['subtaskBreakdown', 'filesToTouch'] as const) {
                const arr = partial[key];
                if (Array.isArray(arr)) {
                  const serial = JSON.stringify(arr);
                  if (serial !== lastEmitted[key]) {
                    lastEmitted[key] = serial;
                    yield { type: 'section', section: key, value: arr };
                  }
                }
              }
            }
          }
          if (chunk.usage) {
            inputTokens = chunk.usage.inputTokens;
            outputTokens = chunk.usage.outputTokens;
            yield { type: 'usage', value: { inputTokens, outputTokens } };
          }
        }
      } catch (streamErr) {
        lastFailureReason = streamErr instanceof Error ? streamErr.message : String(streamErr);
        continue;
      }

      const finalParsed = tolerantParse(acc);
      const result = storyOutputSchema.safeParse(finalParsed);
      if (result.success) {
        validated = result;
        break;
      }

      const accPreview = acc.length > 600 ? `${acc.slice(0, 600)}…[+${acc.length - 600}ch]` : acc;
      lastFailureReason = result.error.issues[0]?.message ?? 'validation';
      // eslint-disable-next-line no-console
      console.warn('[stories.draft] attempt failed validation', {
        draftId,
        attempt,
        accLength: acc.length,
        parsedKind: finalParsed === null ? 'null' : typeof finalParsed,
        zodIssue: lastFailureReason,
        accPreview,
      });
    }

    if (!validated) {
      throw new Error(
        `Output del LLM inválido tras ${MAX_ATTEMPTS} intentos: ${lastFailureReason}`,
      );
    }
    const cost = provider.estimateCost(draft.model, inputTokens, outputTokens);
    const durationMs = Date.now() - started;

    await prisma.storyDraft.update({
      where: { id: draft.id },
      data: {
        summary: validated.data.summary,
        acceptanceCriteria: validated.data.acceptanceCriteria,
        technicalContext: validated.data.technicalContext,
        subtaskBreakdown: validated.data.subtaskBreakdown as unknown as Prisma.InputJsonValue,
        filesToTouch: validated.data.filesToTouch as unknown as Prisma.InputJsonValue,
        risks: validated.data.risks,
        inputTokens,
        outputTokens,
        estimatedCostUsd: new Prisma.Decimal(cost.toFixed(6)),
        durationMs,
        status: 'READY',
      },
    });

    await prisma.aiInteraction.create({
      data: {
        userId,
        projectId: draft.projectId,
        model: draft.model,
        purpose: 'story.generate',
        inputTokens,
        outputTokens,
        estimatedCostUsd: new Prisma.Decimal(cost.toFixed(6)),
      },
    });

    // Con la credencial del servidor no hay fila que 'tocar'.
    if (credRow) touchLlmCredential(credRow.id);

    if (memories.length > 0) {
      await prisma.brainMemory.updateMany({
        where: { id: { in: memories.map((m) => m.id) } },
        data: { citationCount: { increment: 1 }, lastCitedAt: new Date() },
      });
    }

    await audit({
      actorId: userId,
      action: 'story.draft.complete',
      resourceType: 'story_draft',
      resourceId: draft.id,
      projectId: draft.projectId,
      payload: { inputTokens, outputTokens, estimatedCostUsd: cost, durationMs },
    });

    // revalidatePath puede throw si se invoca fuera del request scope esperado
    // por Next 15; no debe romper el flujo final.
    try {
      revalidatePath(`/projects/${draft.project.slug}/stories/drafts/${draft.id}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[stories.draft] revalidatePath skipped:', err);
    }
    yield {
      type: 'done',
      value: { draftId: draft.id, inputTokens, outputTokens, costUsd: cost },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.storyDraft
      .update({
        where: { id: draftId },
        data: { status: 'ERRORED', errorMessage: message.slice(0, 500) },
      })
      .catch(() => {});
    await audit({
      actorId: userId,
      action: 'story.draft.error',
      resourceType: 'story_draft',
      resourceId: draftId,
      projectId: draft.projectId,
      payload: { message: message.slice(0, 500) },
    });
    yield { type: 'error', message };
  }
}

// ---------- Publicar como Task ----------

export async function publishStoryDraftAsTaskAction(
  draftId: string,
  input: PublishStoryInput,
  asUserId?: string,
): Promise<
  | { ok: true; taskId: string; taskNumber: number }
  | { ok: false; error: string }
> {
  // `asUserId` llega de rutas API autenticadas por token (sin sesión).
  let userId = asUserId;
  if (!userId) {
    const session = await auth();
    userId = session?.user?.id;
  }
  if (!userId) return { ok: false, error: 'No autenticado' };

  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };

  const draft = await prisma.storyDraft.findUnique({
    where: { id: draftId },
    include: {
      project: {
        select: {
          id: true,
          slug: true,
          members: { where: { userId }, select: { role: true } },
          workflows: {
            where: { isDefault: true },
            include: { states: true },
          },
        },
      },
    },
  });
  if (!draft) return { ok: false, error: 'Draft no encontrado' };
  if (draft.project.members.length === 0) return { ok: false, error: 'Sin acceso al proyecto' };
  if (draft.status !== 'READY') return { ok: false, error: 'El draft no está listo' };
  const role = draft.project.members[0]!.role;
  if (role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const stateExists = draft.project.workflows[0]?.states.find(
    (s) => s.id === parsed.data.stateId,
  );
  if (!stateExists) return { ok: false, error: 'Estado destino no encontrado' };

  const subtasks = Array.isArray(draft.subtaskBreakdown)
    ? (draft.subtaskBreakdown as Array<{
        title: string;
        description?: string;
        priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
      }>)
    : [];
  const selectedSubtasks = parsed.data.includeSubtasks
    .map((idx) => subtasks[idx])
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  const finalDescription =
    parsed.data.finalDescription ?? buildPublishedDescription(draft);

  const parent = await prisma.$transaction(async (tx) => {
    const counter = await tx.projectTaskCounter.upsert({
      where: { projectId: draft.projectId },
      update: { next: { increment: 1 + selectedSubtasks.length } },
      create: { projectId: draft.projectId, next: 2 + selectedSubtasks.length },
    });
    const parentNumber = counter.next - (1 + selectedSubtasks.length);

    const parentTask = await tx.task.create({
      data: {
        projectId: draft.projectId,
        taskNumber: parentNumber,
        stateId: parsed.data.stateId,
        title:
          parsed.data.finalTitle ??
          (draft.summary?.split('\n')[0]?.slice(0, 200) ?? 'HU sin título'),
        description: finalDescription,
        priority: 'MEDIUM',
        reporterId: userId,
        assigneeId: userId,
        kind: 'STORY',
      },
    });

    await tx.taskActivity.create({
      data: {
        taskId: parentTask.id,
        actorId: userId,
        type: 'CREATED',
        payload: { fromStoryDraft: draft.id },
      },
    });

    for (let i = 0; i < selectedSubtasks.length; i++) {
      const sub = selectedSubtasks[i]!;
      const subNumber = parentNumber + 1 + i;
      const subTask = await tx.task.create({
        data: {
          projectId: draft.projectId,
          taskNumber: subNumber,
          parentTaskId: parentTask.id,
          stateId: parsed.data.stateId,
          title: sub.title.slice(0, 200),
          description: sub.description ?? null,
          priority: (sub.priority ?? 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
          reporterId: userId,
          assigneeId: userId,
        },
      });
      await tx.taskActivity.create({
        data: {
          taskId: subTask.id,
          actorId: userId,
          type: 'CREATED',
          payload: { fromStoryDraft: draft.id, parentStoryTaskId: parentTask.id },
        },
      });
    }

    await tx.storyDraft.update({
      where: { id: draft.id },
      data: { taskId: parentTask.id, status: 'PUBLISHED' },
    });

    return parentTask;
  });

  await audit({
    actorId: userId,
    action: 'story.publish',
    resourceType: 'task',
    resourceId: parent.id,
    projectId: draft.projectId,
    payload: { draftId: draft.id, subtasksCreated: selectedSubtasks.length },
  });

  revalidatePath(`/projects/${draft.project.slug}/board`);
  return { ok: true, taskId: parent.id, taskNumber: parent.taskNumber };
}

function buildPublishedDescription(draft: {
  summary: string | null;
  acceptanceCriteria: string | null;
  technicalContext: string | null;
  filesToTouch: Prisma.JsonValue | null;
  risks: string | null;
  citedMemoryIds: string[];
}): string {
  const sections: string[] = [];
  if (draft.summary) sections.push(`## Resumen\n${draft.summary}`);
  if (draft.technicalContext) sections.push(`## Contexto técnico\n${draft.technicalContext}`);
  if (draft.acceptanceCriteria) sections.push(`## Criterios de aceptación\n${draft.acceptanceCriteria}`);
  if (Array.isArray(draft.filesToTouch) && draft.filesToTouch.length > 0) {
    const files = (draft.filesToTouch as Array<{ path: string; reason: string }>)
      .map((f) => `- \`${f.path}\` — ${f.reason}`)
      .join('\n');
    sections.push(`## Archivos a tocar\n${files}`);
  }
  if (draft.risks) sections.push(`## Riesgos\n${draft.risks}`);
  if (draft.citedMemoryIds.length > 0) {
    sections.push(
      `## Memorias citadas\n${draft.citedMemoryIds.map((id) => `- M-${id}`).join('\n')}`,
    );
  }
  return sections.join('\n\n');
}

// ---------- Regenerate ----------

const regenerateSchema = z.object({
  draftId: z.string().cuid(),
  newProvider: z.enum(['ANTHROPIC', 'OPENAI', 'GOOGLE', 'MOONSHOT']).optional(),
  newModel: z.string().min(1).max(100).optional(),
  newCredentialId: z.string().cuid().optional(),
});

export type RegenerateInput = z.infer<typeof regenerateSchema>;

export async function regenerateDraftAction(
  input: RegenerateInput,
): Promise<DraftCreatedResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'No autenticado' };

  const parsed = regenerateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };

  const parent = await prisma.storyDraft.findUnique({
    where: { id: parsed.data.draftId },
    include: { project: { select: { slug: true } } },
  });
  if (!parent || parent.authorId !== userId) {
    return { ok: false, error: 'Draft no encontrado' };
  }
  if (parent.status === 'GENERATING') {
    return { ok: false, error: 'Espera a que termine la generación actual' };
  }

  const newDraft = await prisma.storyDraft.create({
    data: {
      projectId: parent.projectId,
      authorId: userId,
      parentDraftId: parent.id,
      rawInput: parent.rawInput,
      provider: parsed.data.newProvider ?? parent.provider,
      model: parsed.data.newModel ?? parent.model,
      selectedPaths: parent.selectedPaths,
      citedMemoryIds: parent.citedMemoryIds,
      status: 'GENERATING',
    },
    select: { id: true },
  });

  await audit({
    actorId: userId,
    action: 'story.draft.start',
    resourceType: 'story_draft',
    resourceId: newDraft.id,
    projectId: parent.projectId,
    payload: { regeneratedFrom: parent.id },
  });

  return { ok: true, draftId: newDraft.id };
}
