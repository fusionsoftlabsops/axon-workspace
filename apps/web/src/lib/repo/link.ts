/**
 * Vinculación de un repo GitHub existente a un proyecto (upsert de ProjectRepo).
 * Núcleo compartido por la server action de la UI (linkExistingRepoAction) y el
 * endpoint con API token (para el supervisor/interventor de consola). Sin auth
 * acá: el caller controla el acceso.
 */
import { prisma } from '@/lib/db';
import { parseRepoFullName } from '@/lib/github/client';

export interface LinkRepoInput {
  name: string;
  url: string;
  kind?: string;
}

export async function linkProjectRepo(projectId: string, input: LinkRepoInput) {
  const name = input.name.trim();
  const url = input.url.trim();
  if (!name) throw new Error('Nombre de repo requerido');
  if (!url) throw new Error('URL requerida');
  const githubFullName = parseRepoFullName(url);

  return prisma.projectRepo.upsert({
    where: { projectId_name: { projectId, name } },
    create: { projectId, name, kind: input.kind || 'other', url, githubFullName },
    update: { url, githubFullName, kind: input.kind || undefined },
    select: { id: true, name: true, kind: true, url: true, githubFullName: true, defaultBranch: true },
  });
}
