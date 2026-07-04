#!/usr/bin/env node
/**
 * Sincroniza el acceso del usuario de servicio del MCP (mcp-service) para que el
 * supervisor de consola alcance TODA la cartera:
 *   1) lo agrega como MEMBER de cada proyecto donde falte (cubre proyectos
 *      creados después del bootstrap original);
 *   2) asegura que sus tokens ad_pk_ incluyan el scope `projects:read` (lo pide
 *      list_projects / get_plan / get_team_chat).
 *
 * Idempotente — se puede re-correr sin efectos duplicados. Correrlo tras crear
 * proyectos nuevos:
 *   node scripts/sync-mcp-membership.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const requireFromWeb = createRequire(path.join(here, '../apps/web/package.json'));
const { PrismaClient } = requireFromWeb('@prisma/client');

const EMAIL = 'mcp-service@admin-data.local';

async function main() {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
    if (!user) {
      console.error(`No existe el usuario de servicio ${EMAIL}. Corré bootstrap-mcp-token.mjs primero.`);
      process.exit(1);
    }

    const projects = await prisma.project.findMany({ select: { id: true, slug: true } });
    let added = 0;
    for (const p of projects) {
      const existing = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: p.id, userId: user.id } },
        select: { id: true },
      });
      if (!existing) {
        await prisma.projectMember.create({
          data: { projectId: p.id, userId: user.id, role: 'MEMBER' },
        });
        added += 1;
        console.log(`+ MEMBER de ${p.slug}`);
      }
    }

    const tokens = await prisma.apiToken.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, scopes: true },
    });
    let scoped = 0;
    for (const t of tokens) {
      if (!t.scopes.includes('projects:read')) {
        await prisma.apiToken.update({
          where: { id: t.id },
          data: { scopes: [...t.scopes, 'projects:read'] },
        });
        scoped += 1;
        console.log(`+ projects:read → token "${t.name}"`);
      }
    }

    console.log(
      `Listo. Proyectos: ${projects.length} (nuevas membresías: ${added}). ` +
        `Tokens actualizados con projects:read: ${scoped}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('sync-mcp-membership failed:', err);
  process.exit(1);
});
