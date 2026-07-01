'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import type { ActionResult } from './projects';

export type SkillCategory = 'TESTING' | 'QUALITY' | 'WORKFLOW' | 'ARCHITECTURE' | 'GIT' | 'OTHER';
export type SkillKind = 'COMMAND' | 'GUIDELINE';
export type SkillStatus = 'PENDING' | 'APPROVED' | 'DEPRECATED';

export interface SkillView {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: SkillCategory;
  kind: SkillKind;
  body: string;
  official: boolean;
  status: SkillStatus;
  version: number;
  tags: string[];
  authorName: string | null;
  updatedAt: string;
}

const CATEGORIES: SkillCategory[] = ['TESTING', 'QUALITY', 'WORKFLOW', 'ARCHITECTURE', 'GIT', 'OTHER'];
const KINDS: SkillKind[] = ['COMMAND', 'GUIDELINE'];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function requireUser() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false as const, error: 'No autenticado' };
  return { ok: true as const, userId, isMaster: Boolean(session!.user.isMasterUser) };
}

function toView(s: {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  kind: string;
  body: string;
  official: boolean;
  status: string;
  version: number;
  tags: string[];
  updatedAt: Date;
}, authorName: string | null): SkillView {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    description: s.description,
    category: s.category as SkillCategory,
    kind: s.kind as SkillKind,
    body: s.body,
    official: s.official,
    status: s.status as SkillStatus,
    version: s.version,
    tags: s.tags,
    authorName,
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** All skills for the registry view (approved + community/pending), newest first. */
export async function loadSkills(): Promise<SkillView[]> {
  const rows = await prisma.skill.findMany({ orderBy: [{ official: 'desc' }, { updatedAt: 'desc' }] });
  const authorIds = [...new Set(rows.map((r) => r.authorId).filter((x): x is string => !!x))];
  const authors = authorIds.length
    ? await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(authors.map((a) => [a.id, a.name]));
  return rows.map((r) => toView(r, r.authorId ? (nameById.get(r.authorId) ?? null) : null));
}

/** Contribute a new skill (any member) → enters PENDING for review. */
export async function createSkillAction(input: {
  slug: string;
  name: string;
  description: string;
  category: SkillCategory;
  kind: SkillKind;
  body: string;
  tags?: string[];
}): Promise<ActionResult<SkillView>> {
  const ctx = await requireUser();
  if (!ctx.ok) return ctx;

  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return { ok: false, error: 'El slug debe ser kebab-case (a-z, 0-9, guiones)' };
  if (!input.name.trim() || !input.description.trim() || !input.body.trim()) {
    return { ok: false, error: 'Nombre, descripción y contenido son obligatorios' };
  }
  if (!CATEGORIES.includes(input.category) || !KINDS.includes(input.kind)) {
    return { ok: false, error: 'Categoría o tipo inválido' };
  }

  const exists = await prisma.skill.findUnique({ where: { slug }, select: { id: true } });
  if (exists) return { ok: false, error: `Ya existe un skill con el slug "${slug}"` };

  const created = await prisma.skill.create({
    data: {
      slug,
      name: input.name.trim().slice(0, 120),
      description: input.description.trim().slice(0, 500),
      category: input.category,
      kind: input.kind,
      body: input.body.slice(0, 40_000),
      tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 12),
      official: false,
      status: 'PENDING',
      authorId: ctx.userId,
    },
  });
  await audit({ actorId: ctx.userId, action: 'skill.contribute', resourceType: 'skill', resourceId: created.id, payload: { slug } });
  revalidatePath('/skills');
  return { ok: true, data: toView(created, null) };
}

/** Review a contributed skill (master only): approve/deprecate + official toggle. */
export async function reviewSkillAction(
  id: string,
  patch: { status?: SkillStatus; official?: boolean },
): Promise<ActionResult<SkillView>> {
  const ctx = await requireUser();
  if (!ctx.ok) return ctx;
  if (!ctx.isMaster) return { ok: false, error: 'Solo un administrador puede revisar skills' };
  if (patch.status && !['PENDING', 'APPROVED', 'DEPRECATED'].includes(patch.status)) {
    return { ok: false, error: 'Estado inválido' };
  }

  const updated = await prisma.skill.update({
    where: { id },
    data: {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.official !== undefined ? { official: patch.official } : {}),
    },
  });
  await audit({ actorId: ctx.userId, action: 'skill.review', resourceType: 'skill', resourceId: id, payload: patch });
  revalidatePath('/skills');
  return { ok: true, data: toView(updated, null) };
}

/** Edit a skill's content (master only); bumps version. */
export async function updateSkillAction(
  id: string,
  patch: { name?: string; description?: string; category?: SkillCategory; kind?: SkillKind; body?: string; tags?: string[] },
): Promise<ActionResult<SkillView>> {
  const ctx = await requireUser();
  if (!ctx.ok) return ctx;
  if (!ctx.isMaster) return { ok: false, error: 'Solo un administrador puede editar skills' };

  const updated = await prisma.skill.update({
    where: { id },
    data: {
      ...(patch.name ? { name: patch.name.trim().slice(0, 120) } : {}),
      ...(patch.description ? { description: patch.description.trim().slice(0, 500) } : {}),
      ...(patch.category ? { category: patch.category } : {}),
      ...(patch.kind ? { kind: patch.kind } : {}),
      ...(patch.body ? { body: patch.body.slice(0, 40_000) } : {}),
      ...(patch.tags ? { tags: patch.tags.map((t) => t.trim()).filter(Boolean).slice(0, 12) } : {}),
      version: { increment: 1 },
    },
  });
  await audit({ actorId: ctx.userId, action: 'skill.update', resourceType: 'skill', resourceId: id });
  revalidatePath('/skills');
  return { ok: true, data: toView(updated, null) };
}

/** Delete a skill (master only). */
export async function deleteSkillAction(id: string): Promise<ActionResult> {
  const ctx = await requireUser();
  if (!ctx.ok) return ctx;
  if (!ctx.isMaster) return { ok: false, error: 'Solo un administrador puede eliminar skills' };
  await prisma.skill.delete({ where: { id } });
  await audit({ actorId: ctx.userId, action: 'skill.delete', resourceType: 'skill', resourceId: id });
  revalidatePath('/skills');
  return { ok: true };
}
