/**
 * Debug script: invoke the extractor directly and print the RAW model output
 * (which the production path silently discards if it doesn't validate).
 *
 * Usage: ANTHROPIC_API_KEY=sk-ant-... node scripts/debug-extract.mjs <projectSlug> <taskNumber>
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));

// Hydrate env from apps/web/.env
const envPath = path.join(here, '../apps/web/.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const requireFromWeb = createRequire(path.join(here, '../apps/web/package.json'));
const { PrismaClient } = requireFromWeb('@prisma/client');
const Anthropic = requireFromWeb('@anthropic-ai/sdk').default;

const SYSTEM_PROMPT = `Eres un capturador de conocimiento técnico de un proyecto de software. Leerás los datos de una tarea cerrada (descripción, comentarios, actividad) y producirás un array JSON con 0 a 3 memorias del shape: [{"type":"DECISION|GOTCHA|PATTERN|ANTIPATTERN|RUNBOOK|GLOSSARY|NOTE","title":"...","body":"markdown con el aprendizaje accionable","tags":["..."]}]. Reglas: (1) cada memoria DEBE ser accionable y NO obvia — algo que un dev futuro agradecería saber sin tener que leer la tarea entera. (2) NO captures cosas evidentes ("se creó un PR", "se cerró la tarea"). (3) NO inventes detalles que no estén en el input. (4) Si no hay nada que valga la pena, responde con []. (5) Emite SOLO el JSON, sin prefacio, sin code fence, sin texto explicativo. En español.`;

const [, , projectSlug, taskNumberRaw] = process.argv;
if (!projectSlug || !taskNumberRaw) {
  console.error('Usage: node scripts/debug-extract.mjs <projectSlug> <taskNumber>');
  process.exit(1);
}
const taskNumber = parseInt(taskNumberRaw, 10);

const prisma = new PrismaClient();
try {
  const project = await prisma.project.findUnique({ where: { slug: projectSlug }, select: { id: true } });
  if (!project) throw new Error('project not found');
  const task = await prisma.task.findUnique({
    where: { projectId_taskNumber: { projectId: project.id, taskNumber } },
    include: {
      state: { select: { name: true, category: true } },
      assignee: { select: { name: true } },
      reporter: { select: { name: true } },
      comments: { orderBy: { createdAt: 'asc' }, include: { author: { select: { name: true } } } },
      activity: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { name: true } } } },
    },
  });
  if (!task) throw new Error('task not found');

  // Build digest inline (mirrors lib/brain/digest.ts).
  const lines = [];
  lines.push(`# Tarea ${projectSlug}#${task.taskNumber}: ${task.title}`);
  lines.push('');
  lines.push(`- Estado: ${task.state.name} (${task.state.category}) · Prioridad: ${task.priority}`);
  lines.push(`- Asignado a: ${task.assignee?.name ?? '—'} · Reportado por: ${task.reporter.name}`);
  lines.push('');
  if (task.description?.trim()) {
    lines.push('## Descripción');
    lines.push(task.description.trim());
    lines.push('');
  }
  if (task.comments.length > 0) {
    lines.push('## Comentarios');
    for (const c of task.comments) {
      lines.push(`### ${c.author.name} · ${c.createdAt.toISOString()}`);
      lines.push(c.body.trim());
      lines.push('');
    }
  }
  if (task.activity.length > 0) {
    lines.push('## Actividad');
    for (const a of task.activity) {
      lines.push(`- ${a.createdAt.toISOString()} · ${a.actor.name} · ${a.type}${a.payload ? ' ' + JSON.stringify(a.payload) : ''}`);
    }
  }
  const digest = lines.join('\n');

  console.error('--- DIGEST (', digest.length, 'chars) ---');
  console.error(digest.slice(0, 1000) + (digest.length > 1000 ? '\n…' : ''));
  console.error('--- /DIGEST ---\n');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: process.env.AI_MODEL_BALANCED || 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: digest }],
  });
  const out = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

  console.error('--- RAW OUTPUT (', out.length, 'chars) ---');
  console.log(out);
  console.error('--- /RAW ---');
  console.error(`tokens: in=${resp.usage.input_tokens} out=${resp.usage.output_tokens}`);
} finally {
  await prisma.$disconnect();
}
