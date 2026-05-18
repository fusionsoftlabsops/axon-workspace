/**
 * Record a citation: a task referenced a brain memory. Used by Claude Code
 * via the MCP `cite_memory` tool to mark which memories actually informed
 * its work, so we can later distinguish living knowledge from dead notes.
 *
 * Side effects in the same transaction:
 *   - insert MemoryCitation row
 *   - increment BrainMemory.citationCount
 *   - bump BrainMemory.lastCitedAt to now
 *   - log a MEMORY_CITED entry in the task activity feed
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export interface CiteInput {
  memoryId: string;
  taskId: string;
  userId: string;
  context?: string;
}

export async function citeMemory(input: CiteInput): Promise<
  | { ok: true; citationId: string }
  | { ok: false; error: string }
> {
  try {
    const citationId = await prisma.$transaction(async (tx) => {
      const memory = await tx.brainMemory.findUnique({
        where: { id: input.memoryId },
        select: { id: true, projectId: true },
      });
      if (!memory) throw new Error('memory not found');

      const task = await tx.task.findUnique({
        where: { id: input.taskId },
        select: { id: true, projectId: true },
      });
      if (!task) throw new Error('task not found');
      if (task.projectId !== memory.projectId) {
        throw new Error('memory and task belong to different projects');
      }

      const citation = await tx.memoryCitation.create({
        data: {
          memoryId: memory.id,
          citedInTaskId: task.id,
          citedByUserId: input.userId,
          context: input.context,
        },
      });

      await tx.brainMemory.update({
        where: { id: memory.id },
        data: {
          citationCount: { increment: 1 },
          lastCitedAt: new Date(),
        },
      });

      await tx.taskActivity.create({
        data: {
          taskId: task.id,
          actorId: input.userId,
          type: 'MEMORY_CITED',
          payload: { memoryId: memory.id, context: input.context ?? null },
        },
      });

      return citation.id;
    });

    return { ok: true, citationId };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return { ok: false, error: 'referencia inválida (memoria o tarea no existe)' };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'no se pudo registrar la citation',
    };
  }
}
