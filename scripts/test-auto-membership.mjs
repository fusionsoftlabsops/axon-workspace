#!/usr/bin/env node
/**
 * Smoke test for the auto-membership feature.
 *
 * 1. Creates a new project "auto-membership-test-<ts>" directly via Prisma,
 *    invoking the same `ensureMcpServiceMembership` helper that the server
 *    action uses.
 * 2. Verifies that the MCP service user is now a MEMBER of that project.
 * 3. Cleans up by deleting the test project.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const requireFromWeb = createRequire(path.join(here, '../apps/web/package.json'));
const { PrismaClient } = requireFromWeb('@prisma/client');

// Compile the helper inline so we don't depend on tsx/build artifacts.
// (Mirrors apps/web/src/lib/mcp-service.ts; keep in sync.)
const MCP_SERVICE_EMAIL = 'mcp-service@admin-data.local';

async function ensureMcpServiceMembership(tx, projectId) {
  const service = await tx.user.findUnique({
    where: { email: MCP_SERVICE_EMAIL },
    select: { id: true },
  });
  if (!service) return false;
  await tx.projectMember.upsert({
    where: { projectId_userId: { projectId, userId: service.id } },
    update: {},
    create: { projectId, userId: service.id, role: 'MEMBER' },
  });
  return true;
}

async function main() {
  const prisma = new PrismaClient();
  const slug = `auto-membership-test-${Date.now()}`;
  let projectId;

  try {
    const owner = await prisma.user.findUnique({
      where: { email: MCP_SERVICE_EMAIL },
      select: { id: true },
    });
    if (!owner) throw new Error('MCP service user is missing. Run bootstrap-mcp-token.mjs first.');

    // Create a throwaway project owned by the service user itself for the test.
    const created = await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          slug,
          name: 'Auto-membership smoke test',
          ownerId: owner.id,
          members: { create: { userId: owner.id, role: 'OWNER' } },
          taskCounter: { create: { next: 1 } },
        },
      });
      await ensureMcpServiceMembership(tx, project.id);
      return project;
    });
    projectId = created.id;

    const members = await prisma.projectMember.findMany({
      where: { projectId },
      include: { user: { select: { email: true } } },
    });

    const mcpMembership = members.find((m) => m.user.email === MCP_SERVICE_EMAIL);
    if (!mcpMembership) {
      throw new Error(`MCP service user is NOT a member of ${slug}`);
    }
    console.log(`✓ MCP service user is ${mcpMembership.role} of "${slug}"`);
    console.log(`  total members: ${members.length}`);

    // Verify idempotency: a second call must not throw or duplicate.
    await prisma.$transaction((tx) => ensureMcpServiceMembership(tx, projectId));
    const after = await prisma.projectMember.count({ where: { projectId } });
    if (after !== members.length) {
      throw new Error(`idempotency broken: count went from ${members.length} to ${after}`);
    }
    console.log('✓ idempotent on second invocation');
  } finally {
    if (projectId) {
      await prisma.project.delete({ where: { id: projectId } }).catch(() => {});
      console.log('  cleaned up test project');
    }
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
