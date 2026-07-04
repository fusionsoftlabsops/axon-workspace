/**
 * Plan de implementación POR HU DEL TABLERO (Task), no por tarea del plan.
 *
 * El agente Dev, al tomar una HU, genera este contexto técnico (grounded en el
 * repo cuando hay un path local legible; si no, desde la HU sola) con el MISMO
 * generador Claude que el botón «Plan de implementación» de la página /plan, y
 * lo persiste en Task.implPlan para (a) usarlo como contexto al implementar y
 * (b) hacerlo visible en el detalle de la HU. Reutiliza `generateImplementationPlan`.
 */
import type { Task } from '@prisma/client';
import { prisma } from '@/lib/db';
import { generateImplementationPlan, type ImplRepoFile } from '@/lib/ai/planner';
import type { PlanTask } from '@/lib/ai/plan-schema';
import { repoReaderFor, type TreeNode } from '@/lib/repo/reader';
import { githubGrounding, repoSlug } from '@/lib/repo/github';
import { env } from '@/lib/env';
import type { Lang } from '@/lib/ai/planner';

function outlineTree(nodes: TreeNode[], depth = 0, acc: string[] = []): string[] {
  for (const n of nodes) {
    acc.push(`${'  '.repeat(depth)}${n.name}${n.children ? '/' : ''}`);
    if (n.children?.length) outlineTree(n.children, depth + 1, acc);
  }
  return acc;
}

function flattenFiles(nodes: TreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (!n.children) acc.push(n.path);
    else flattenFiles(n.children, acc);
  }
  return acc;
}

function keywordsFrom(task: PlanTask): string[] {
  const text = `${task.title} ${task.description} ${task.acceptanceCriteria}`.toLowerCase();
  const words = text.match(/[a-záéíóúñ0-9_]{4,}/gi) ?? [];
  const stop = new Set(['para', 'como', 'este', 'esta', 'debe', 'sobre', 'that', 'this', 'with', 'from', 'when', 'user', 'historia', 'usuario']);
  return [...new Set(words.filter((w) => !stop.has(w)))].slice(0, 12);
}

/** Construye un PlanTask (la forma que consume el generador) desde una HU real. */
export function planTaskFromTask(task: Task): PlanTask {
  const seniority = (task.estimateBySeniority as PlanTask['estimateBySeniority'] | null) ?? {
    junior: '',
    semiSenior: '',
    senior: '',
  };
  return {
    title: task.title,
    description: task.description ?? '',
    acceptanceCriteria: task.acceptanceCriteria ?? '',
    estimate: task.estimate ?? '',
    estimateBySeniority: seniority,
    category: task.category ?? 'other',
    recommendedRoles: task.recommendedRoles ?? [],
    priority: task.priority,
    kind: task.kind,
    repo: '',
    assignment: null,
  };
}

/** Lee el repo (si hay path local) y produce outline + archivos relevantes. */
async function groundInRepo(planTask: PlanTask, repoPath: string | null): Promise<{ outline: string; files: ImplRepoFile[] }> {
  if (!repoPath) return { outline: '', files: [] };
  const reader = await repoReaderFor({ repoPath }).catch(() => null);
  if (!reader) return { outline: '', files: [] };

  let tree: TreeNode[] = [];
  try {
    tree = await reader.tree({ maxDepth: 3 });
  } catch {
    return { outline: '', files: [] };
  }
  const outline = outlineTree(tree).slice(0, 400).join('\n');
  const allFiles = flattenFiles(tree);

  const kws = keywordsFrom(planTask);
  const candidates = new Set<string>();
  for (const kw of kws.slice(0, 6)) {
    if (candidates.size >= 30) break;
    try {
      for (const h of await reader.grep(kw)) {
        candidates.add(h.path);
        if (candidates.size >= 30) break;
      }
    } catch {
      /* skip */
    }
  }
  for (const p of allFiles) {
    if (candidates.size >= 30) break;
    if (kws.some((k) => p.toLowerCase().includes(k))) candidates.add(p);
  }
  if (candidates.size < 5) for (const p of allFiles.slice(0, 20)) candidates.add(p);

  let files: ImplRepoFile[] = [];
  try {
    const read = await reader.readFiles([...candidates].slice(0, 25), {
      maxFiles: 25,
      maxBytesTotal: 140_000,
      maxPerFile: 20_000,
    });
    files = read.files.map((f) => ({ path: f.path, content: f.content, language: f.language, truncated: f.truncated }));
  } catch {
    /* outline-only */
  }
  return { outline, files };
}

/**
 * Genera el plan de implementación de una HU del tablero y lo persiste en
 * Task.implPlan (+ implPlanAt). Devuelve el markdown. Best-effort en el
 * grounding: sin repo local igual produce un plan desde la HU.
 */
export async function generateTaskImplPlan(opts: {
  projectId: string;
  taskId: string;
  userId: string;
  lang: Lang;
}): Promise<string> {
  const task = await prisma.task.findUnique({
    where: { id: opts.taskId },
    include: { sprint: { select: { name: true, goal: true } } },
  });
  if (!task) throw new Error('HU no encontrada');

  const project = await prisma.project.findUnique({
    where: { id: opts.projectId },
    select: { name: true, description: true, repoPath: true },
  });

  // Repo objetivo: el de la categoría de la HU, si hay uno con path local; si no,
  // el legacy del proyecto. En proyectos GitHub sin path local → plan sin código.
  const repos = await prisma.projectRepo.findMany({ where: { projectId: opts.projectId } });
  const byCategory = task.category
    ? repos.find((r) => r.kind.toLowerCase() === task.category!.toLowerCase())
    : undefined;
  const repoPath = byCategory?.repoPath ?? project?.repoPath ?? null;

  const planTask = planTaskFromTask(task);
  let { outline, files } = await groundInRepo(planTask, repoPath);

  // Sin repo local (caso normal en producción: el repo vive en GitHub y solo el
  // worker lo clona) → grounding vía la API de GitHub. Así el impl-plan lleva el
  // árbol real + archivos candidatos, y el Dev no quema presupuesto explorando.
  if (!outline) {
    const ghRepo = byCategory ?? repos.find((r) => r.url || r.githubFullName);
    const slug = ghRepo ? repoSlug(ghRepo) : null;
    const token = env().GITHUB_TOKEN;
    if (slug && token) {
      const g = await githubGrounding({
        fullName: slug,
        branch: ghRepo!.defaultBranch ?? 'main',
        token,
        keywords: keywordsFrom(planTask),
      }).catch(() => ({ outline: '', files: [] as ImplRepoFile[] }));
      outline = g.outline;
      files = g.files;
    }
  }

  const markdown = await generateImplementationPlan(
    { name: project?.name ?? '', description: project?.description ?? null },
    planTask,
    { name: task.sprint?.name ?? 'Backlog', goal: task.sprint?.goal ?? '' },
    '',
    outline,
    files,
    opts.lang,
    opts.userId,
    opts.projectId,
    'agent', // plan para el Dev autónomo: solo el cambio técnico, sin guía MCP
  );

  await prisma.task.update({
    where: { id: opts.taskId },
    data: { implPlan: markdown, implPlanAt: new Date() },
  });
  return markdown;
}
