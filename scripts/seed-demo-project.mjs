#!/usr/bin/env node
/**
 * Seed a demo project for end-to-end MCP testing.
 *
 * - Ensures the MCP service user exists (created earlier by
 *   bootstrap-mcp-token.mjs).
 * - Creates a "demo" project owned by the service user (so we can do the
 *   whole flow without the UI). Idempotent: re-running upserts.
 * - Attaches the default workflow (Preparación → Desarrollo → Bloqueada
 *   → Verificación → Terminada).
 * - Creates 3 sample tasks assigned to the service user across different
 *   workflow states.
 *
 * NOTE: this is for demoing the MCP integration only. In real usage you
 * sign up via /signup, create projects from /projects, and invite the
 * service user from /projects/<slug>/settings.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const requireFromWeb = createRequire(path.join(here, '../apps/web/package.json'));
const { PrismaClient } = requireFromWeb('@prisma/client');

const SERVICE_EMAIL = 'mcp-service@admin-data.local';
const PROJECT_SLUG = 'demo';

const WORKFLOW_STATES = [
  { name: 'Preparación', color: '#6b7280', category: 'OPEN' },
  { name: 'Desarrollo', color: '#3b82f6', category: 'IN_PROGRESS' },
  { name: 'Bloqueada', color: '#ef4444', category: 'BLOCKED' },
  { name: 'Verificación', color: '#f59e0b', category: 'REVIEW' },
  { name: 'Terminada', color: '#10b981', category: 'DONE' },
];

const DEMO_TASKS = [
  {
    title: 'Configurar pipeline CI',
    description: 'Setear GitHub Actions con typecheck, test, build.',
    priority: 'HIGH',
    stateName: 'Preparación',
  },
  {
    title: 'Implementar exportación de tareas a CSV',
    description: 'Endpoint REST que descargue todas las tareas del proyecto en CSV.',
    priority: 'MEDIUM',
    stateName: 'Desarrollo',
  },
  {
    title: 'Auditoría de seguridad del vault',
    description: 'Revisar cripto del vault con un externo antes de release.',
    priority: 'URGENT',
    stateName: 'Verificación',
  },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const service = await prisma.user.findUnique({ where: { email: SERVICE_EMAIL } });
    if (!service) {
      throw new Error(
        `Service user ${SERVICE_EMAIL} no existe. Corre primero: node scripts/bootstrap-mcp-token.mjs`,
      );
    }

    const project = await prisma.project.upsert({
      where: { slug: PROJECT_SLUG },
      update: {},
      create: {
        slug: PROJECT_SLUG,
        name: 'Proyecto demo',
        description: 'Proyecto de ejemplo para validar el MCP server end-to-end.',
        ownerId: service.id,
        members: { create: { userId: service.id, role: 'OWNER' } },
        taskCounter: { create: { next: 1 } },
      },
    });
    console.log(`[seed] proyecto: ${project.slug} (id=${project.id})`);

    // Workflow + states (idempotent).
    const workflow = await prisma.workflow.upsert({
      where: { projectId_name: { projectId: project.id, name: 'Default' } },
      update: {},
      create: { projectId: project.id, name: 'Default', isDefault: true },
    });
    for (let i = 0; i < WORKFLOW_STATES.length; i++) {
      const s = WORKFLOW_STATES[i];
      await prisma.workflowState.upsert({
        where: { workflowId_name: { workflowId: workflow.id, name: s.name } },
        update: {},
        create: { workflowId: workflow.id, name: s.name, color: s.color, category: s.category, order: i },
      });
    }
    const states = await prisma.workflowState.findMany({ where: { workflowId: workflow.id } });
    console.log(`[seed] workflow Default con ${states.length} estados`);

    // Tasks. Use a transaction so the counter increments correctly.
    let created = 0;
    let skipped = 0;
    for (const t of DEMO_TASKS) {
      const state = states.find((s) => s.name === t.stateName);
      if (!state) {
        console.warn(`[seed] estado "${t.stateName}" no encontrado, salto la tarea "${t.title}"`);
        continue;
      }

      const exists = await prisma.task.findFirst({
        where: { projectId: project.id, title: t.title },
        select: { id: true, taskNumber: true },
      });
      if (exists) {
        console.log(`[seed]   = #${exists.taskNumber} ${t.title} (ya existe)`);
        skipped++;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const counter = await tx.projectTaskCounter.update({
          where: { projectId: project.id },
          data: { next: { increment: 1 } },
        });
        const taskNumber = counter.next - 1;
        const maxPos = await tx.task.aggregate({
          where: { projectId: project.id, stateId: state.id },
          _max: { positionInState: true },
        });
        const task = await tx.task.create({
          data: {
            projectId: project.id,
            taskNumber,
            stateId: state.id,
            title: t.title,
            description: t.description,
            priority: t.priority,
            reporterId: service.id,
            assigneeId: service.id,
            positionInState: (maxPos._max.positionInState ?? -1) + 1,
          },
        });
        await tx.taskActivity.create({
          data: { taskId: task.id, actorId: service.id, type: 'CREATED' },
        });
        console.log(`[seed]   + #${task.taskNumber} ${task.title} (${t.stateName})`);
        created++;
      });
    }

    console.log(`[seed] listo. tareas: ${created} creadas, ${skipped} ya existían.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('seed-demo failed:', err);
  process.exit(1);
});
