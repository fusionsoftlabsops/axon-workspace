#!/usr/bin/env node
/**
 * Acuña el token de servicio del WORKER MULTI-TENANT: un usuario dedicado con un
 * ApiToken de scope `agents:runtime` (y NADA más). Con él, el worker consulta
 * /internal/agent-runtime para obtener los tokens de agente de todos los
 * proyectos. Es un secreto de máxima sensibilidad — va solo al env del worker
 * (AGENT_RUNTIME_TOKEN).
 *
 *   $token = node scripts/emit-runtime-token.mjs
 *   # setear AGENT_RUNTIME_TOKEN=$token en el worker (fusion-infra app_set_env)
 */
import { createRequire } from 'node:module';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const requireFromWeb = createRequire(path.join(here, '../apps/web/package.json'));
const { PrismaClient } = requireFromWeb('@prisma/client');

const EMAIL = 'agents-runtime@agents.axon.local';
const NAME = 'Agents runtime worker';

async function main() {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.upsert({
      where: { email: EMAIL },
      update: {},
      create: {
        email: EMAIL,
        name: NAME,
        passwordHash: '$argon2id$disabled$runtime-worker-no-login',
        publicKey: Buffer.alloc(32, 0),
        encryptedPrivateKey: Buffer.from('agents-runtime-no-vault-access'),
        encryptedPrivKeyNonce: Buffer.alloc(24, 0),
        kdfSalt: Buffer.alloc(16, 0),
      },
    });

    const plain = `ad_pk_${randomBytes(32).toString('base64url')}`;
    const tokenHash = createHash('sha256').update(plain).digest('hex');
    const prefix = plain.slice(0, 12);

    // Un solo token vivo: revoca los anteriores de este usuario.
    await prisma.apiToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await prisma.apiToken.create({
      data: {
        userId: user.id,
        name: 'agents-runtime',
        tokenHash,
        prefix,
        scopes: ['agents:runtime'],
        projectSlugs: [], // el scope ya es global; no se restringe por proyecto
      },
    });

    process.stdout.write(plain);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('emit-runtime-token failed:', err);
  process.exit(1);
});
