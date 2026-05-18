/**
 * Seed mínimo de desarrollo.
 *
 * NO crea un usuario master con keypair, porque ese flujo es zero-knowledge
 * (requiere passphrase del cliente para generar las claves). El usuario master
 * se crea desde la UI /signup en el primer arranque.
 *
 * Este seed solo asegura el catálogo base (templates de workflow) y, si hay
 * un usuario master en la DB, le crea un proyecto demo.
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_WORKFLOW_STATES } from '../../../packages/shared/src/types';
import { ensureMcpServiceMembership } from '../src/lib/mcp-service';

const prisma = new PrismaClient();

async function main() {
  console.log('[seed] empezando…');

  const master = await prisma.user.findFirst({ where: { isMasterUser: true } });
  if (!master) {
    console.log('[seed] no hay master user todavía — crealo desde /signup. Termina aquí.');
    return;
  }

  const slug = 'demo';
  const existing = await prisma.project.findUnique({ where: { slug } });
  if (existing) {
    console.log(`[seed] proyecto "${slug}" ya existe, no se duplica.`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        slug,
        name: 'Proyecto demo',
        description: 'Proyecto de ejemplo con workflow default.',
        ownerId: master.id,
        members: { create: { userId: master.id, role: 'OWNER' } },
        taskCounter: { create: { next: 1 } },
      },
    });

    const workflow = await tx.workflow.create({
      data: {
        projectId: project.id,
        name: 'Default',
        isDefault: true,
        states: {
          create: DEFAULT_WORKFLOW_STATES.map((s, i) => ({
            name: s.name,
            color: s.color,
            category: s.category,
            order: i,
          })),
        },
      },
      include: { states: true },
    });

    await ensureMcpServiceMembership(tx, project.id);

    console.log(`[seed] proyecto "${slug}" creado con workflow ${workflow.id}.`);
  });
}

main()
  .catch((e) => {
    console.error('[seed] fallo:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
