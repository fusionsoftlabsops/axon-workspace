'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { assertProjectMember } from '@/lib/auth/membership';
import { generatedPlanSchema } from '@/lib/ai/plan-schema';
import {
  isGithubConfigured,
  createRepo,
  parseRepoFullName,
  getCollaboratorPermission,
} from '@/lib/github/client';
import type { ActionResult } from './projects';

export interface RepoAccessEntry {
  userId: string;
  name: string;
  login: string | null;
  hasAccess: boolean | null; // null = no GitHub handle on file
  permission: string | null;
}
export interface ProjectRepoView {
  id: string;
  name: string;
  kind: string;
  url: string | null;
  githubFullName: string | null;
  defaultBranch: string | null;
  repoPath: string | null;
  access: RepoAccessEntry[] | null;
  accessCheckedAt: string | null;
}
export interface SuggestedRepoView {
  name: string;
  kind: string;
  stack: string;
  reason: string;
}
export interface RepoMember {
  userId: string;
  name: string;
  githubLogin: string | null;
}
export interface ReposSection {
  githubConfigured: boolean;
  suggested: SuggestedRepoView[];
  repos: ProjectRepoView[];
  members: RepoMember[];
}

function repoToView(r: {
  id: string;
  name: string;
  kind: string;
  url: string | null;
  githubFullName: string | null;
  defaultBranch: string | null;
  repoPath: string | null;
  access: unknown;
  accessCheckedAt: Date | null;
}): ProjectRepoView {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    url: r.url,
    githubFullName: r.githubFullName,
    defaultBranch: r.defaultBranch,
    repoPath: r.repoPath,
    access: Array.isArray(r.access) ? (r.access as unknown as RepoAccessEntry[]) : null,
    accessCheckedAt: r.accessCheckedAt?.toISOString() ?? null,
  };
}

async function loadSection(projectId: string): Promise<ReposSection> {
  const [plan, repos, members] = await Promise.all([
    prisma.projectPlan.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: { generated: true },
    }),
    prisma.projectRepo.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
    prisma.projectMember.findMany({
      where: { projectId },
      select: { user: { select: { id: true, name: true, githubLogin: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
  ]);

  const parsed = plan?.generated ? generatedPlanSchema.safeParse(plan.generated) : null;
  const suggested: SuggestedRepoView[] = parsed?.success
    ? parsed.data.suggestedRepos.map((r) => ({ name: r.name, kind: r.kind, stack: r.stack, reason: r.reason }))
    : [];

  return {
    githubConfigured: isGithubConfigured(),
    suggested,
    repos: repos.map(repoToView),
    members: members.map((m) => ({ userId: m.user.id, name: m.user.name, githubLogin: m.user.githubLogin })),
  };
}

async function guard(slug: string) {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return { ok: false as const, error: ctx.error };
  if (ctx.role === 'VIEWER') return { ok: false as const, error: 'Sin permisos' };
  return { ok: true as const, projectId: ctx.projectId };
}

export async function getReposSectionAction(slug: string): Promise<ActionResult<ReposSection>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  return { ok: true, data: await loadSection(ctx.projectId) };
}

export async function createRepoOnGithubAction(
  slug: string,
  input: { name: string; kind?: string; description?: string },
): Promise<ActionResult<ReposSection>> {
  const g = await guard(slug);
  if (!g.ok) return g;
  if (!isGithubConfigured()) return { ok: false, error: 'GitHub no está configurado en esta instancia' };
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Nombre de repo requerido' };

  let created;
  try {
    created = await createRepo(name, { description: input.description, private: true });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error creando el repo' };
  }
  await prisma.projectRepo.upsert({
    where: { projectId_name: { projectId: g.projectId, name } },
    create: {
      projectId: g.projectId,
      name,
      kind: input.kind || 'other',
      url: created.htmlUrl,
      githubFullName: created.fullName,
      defaultBranch: created.defaultBranch,
      private: true,
    },
    update: { url: created.htmlUrl, githubFullName: created.fullName, defaultBranch: created.defaultBranch },
  });
  revalidatePath(`/projects/${slug}/plan`);
  return { ok: true, data: await loadSection(g.projectId) };
}

export async function linkExistingRepoAction(
  slug: string,
  input: { name: string; kind?: string; url: string },
): Promise<ActionResult<ReposSection>> {
  const g = await guard(slug);
  if (!g.ok) return g;
  try {
    const { linkProjectRepo } = await import('@/lib/repo/link');
    await linkProjectRepo(g.projectId, input);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudo vincular el repo' };
  }
  revalidatePath(`/projects/${slug}/plan`);
  return { ok: true, data: await loadSection(g.projectId) };
}

export async function updateProjectRepoAction(
  slug: string,
  repoId: string,
  patch: { name?: string; kind?: string; url?: string; repoPath?: string; defaultBranch?: string },
): Promise<ActionResult<ReposSection>> {
  const g = await guard(slug);
  if (!g.ok) return g;
  const repo = await prisma.projectRepo.findFirst({ where: { id: repoId, projectId: g.projectId } });
  if (!repo) return { ok: false, error: 'Repo no encontrado' };

  const data: Record<string, string | null> = {};
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) return { ok: false, error: 'El nombre no puede estar vacío' };
    data.name = n;
  }
  if (patch.kind !== undefined) data.kind = patch.kind || 'other';
  if (patch.url !== undefined) {
    data.url = patch.url.trim() || null;
    data.githubFullName = patch.url.trim() ? parseRepoFullName(patch.url) : null;
  }
  if (patch.repoPath !== undefined) data.repoPath = patch.repoPath.trim() || null;
  if (patch.defaultBranch !== undefined) data.defaultBranch = patch.defaultBranch.trim() || 'main';

  try {
    await prisma.projectRepo.update({ where: { id: repo.id }, data });
  } catch {
    return { ok: false, error: 'No se pudo actualizar (¿nombre duplicado?)' };
  }
  return { ok: true, data: await loadSection(g.projectId) };
}

export async function removeProjectRepoAction(slug: string, repoId: string): Promise<ActionResult<ReposSection>> {
  const g = await guard(slug);
  if (!g.ok) return g;
  const repo = await prisma.projectRepo.findFirst({ where: { id: repoId, projectId: g.projectId } });
  if (!repo) return { ok: false, error: 'Repo no encontrado' };
  await prisma.projectRepo.delete({ where: { id: repo.id } });
  return { ok: true, data: await loadSection(g.projectId) };
}

export async function verifyRepoAccessAction(slug: string, repoId: string): Promise<ActionResult<ReposSection>> {
  const g = await guard(slug);
  if (!g.ok) return g;
  if (!isGithubConfigured()) return { ok: false, error: 'GitHub no está configurado en esta instancia' };
  const repo = await prisma.projectRepo.findFirst({ where: { id: repoId, projectId: g.projectId } });
  if (!repo) return { ok: false, error: 'Repo no encontrado' };
  const fullName = repo.githubFullName || (repo.url ? parseRepoFullName(repo.url) : null);
  if (!fullName) return { ok: false, error: 'El repo no tiene una URL de GitHub válida' };

  const members = await prisma.projectMember.findMany({
    where: { projectId: g.projectId },
    select: { user: { select: { id: true, name: true, githubLogin: true } } },
    orderBy: { joinedAt: 'asc' },
  });

  const access: RepoAccessEntry[] = [];
  for (const m of members) {
    const login = m.user.githubLogin;
    if (!login) {
      access.push({ userId: m.user.id, name: m.user.name, login: null, hasAccess: null, permission: null });
      continue;
    }
    try {
      const perm = await getCollaboratorPermission(fullName, login);
      access.push({ userId: m.user.id, name: m.user.name, login, hasAccess: perm !== 'none', permission: perm });
    } catch {
      access.push({ userId: m.user.id, name: m.user.name, login, hasAccess: null, permission: null });
    }
  }

  await prisma.projectRepo.update({
    where: { id: repo.id },
    data: { access: access as unknown as object, accessCheckedAt: new Date() },
  });
  return { ok: true, data: await loadSection(g.projectId) };
}
