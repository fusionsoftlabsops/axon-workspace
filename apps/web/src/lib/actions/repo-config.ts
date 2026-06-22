'use server';

import { revalidatePath } from 'next/cache';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { assertProjectMember } from '@/lib/auth/membership';
import { isPathWithinRoot } from '@/lib/repo/reader';

const schema = z.object({
  repoPath: z.string().max(500).optional().nullable(),
  repoUrl: z.string().url().max(500).optional().nullable(),
  repoDefaultBranch: z.string().max(80).optional().nullable(),
});

export type RepoConfigInput = z.infer<typeof schema>;

/**
 * Configura el repositorio asociado a un proyecto. Valida que el repoPath
 * exista, sea absoluto y sea un directorio. Solo OWNER/ADMIN.
 */
export async function setProjectRepoConfigAction(
  projectSlug: string,
  input: RepoConfigInput,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'No autenticado' };

  const ctx = await assertProjectMember(projectSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (ctx.role !== 'OWNER' && ctx.role !== 'ADMIN') {
    return { ok: false, error: 'Solo OWNER/ADMIN pueden cambiar la config del repo' };
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };

  const repoPath = parsed.data.repoPath?.trim() || null;
  if (repoPath) {
    if (!path.isAbsolute(repoPath)) {
      return { ok: false, error: 'repoPath debe ser absoluto' };
    }
    // Confinar a REPOS_ROOT si está configurado: impide apuntar a rutas
    // sensibles del server (/etc, ~/.ssh, .env de otros servicios, etc.).
    const reposRoot = env().REPOS_ROOT;
    if (reposRoot && !isPathWithinRoot(reposRoot, repoPath)) {
      return { ok: false, error: `repoPath debe estar dentro de ${reposRoot}` };
    }
    const stat = await fs.stat(repoPath).catch(() => null);
    if (!stat) return { ok: false, error: `la ruta no existe: ${repoPath}` };
    if (!stat.isDirectory()) return { ok: false, error: 'la ruta no es un directorio' };
  }

  await prisma.project.update({
    where: { id: ctx.projectId },
    data: {
      repoPath,
      repoUrl: parsed.data.repoUrl?.trim() || null,
      repoDefaultBranch: parsed.data.repoDefaultBranch?.trim() || 'main',
    },
  });

  revalidatePath(`/projects/${projectSlug}/settings`);
  return { ok: true };
}
