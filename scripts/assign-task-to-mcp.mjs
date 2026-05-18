/**
 * Helper for demo: create + assign a task to the MCP service user so that
 * `list_my_tasks` (which filters by assignedToMe through the token owner)
 * returns something for the MCP token.
 *
 * In real usage you'd issue a personal API token from /settings/tokens (so
 * Claude Code acts on YOUR behalf), but for the bootstrap-service token
 * flow we need the task to belong to mcp-service@admin-data.local.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const requireFromWeb = createRequire(path.join(here, '../apps/web/package.json'));
const { PrismaClient } = requireFromWeb('@prisma/client');

const prisma = new PrismaClient();
try {
  const service = await prisma.user.findUnique({
    where: { email: 'mcp-service@admin-data.local' },
    select: { id: true },
  });
  if (!service) throw new Error('MCP service user missing');

  const project = await prisma.project.findUnique({
    where: { slug: 'mi-cliente-principal' },
    include: { workflows: { include: { states: true } } },
  });
  if (!project) throw new Error('mi-cliente-principal not found');

  const desarrollo = project.workflows[0].states.find((s) => s.name === 'Desarrollo');

  const created = await prisma.$transaction(async (tx) => {
    const counter = await tx.projectTaskCounter.update({
      where: { projectId: project.id },
      data: { next: { increment: 1 } },
    });
    const taskNumber = counter.next - 1;
    return tx.task.create({
      data: {
        projectId: project.id,
        taskNumber,
        stateId: desarrollo.id,
        title: 'Refactor del módulo de pagos',
        description: 'Migrar a la nueva API de Stripe.',
        priority: 'HIGH',
        reporterId: service.id,
        assigneeId: service.id,
      },
    });
  });
  console.log(`Created task #${created.taskNumber}: ${created.title} (assignee=MCP service)`);
} finally {
  await prisma.$disconnect();
}
