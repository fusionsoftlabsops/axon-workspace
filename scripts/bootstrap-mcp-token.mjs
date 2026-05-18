#!/usr/bin/env node
/**
 * Generate a Claude-Code-ready API token without going through the UI.
 *
 * Used for first-time bootstrap. Creates a dedicated "MCP bootstrap" service
 * user (or reuses one if already present), generates a token with
 * tasks:read/write + comments:write + bugs:write scopes, and prints it to
 * stdout. Capture the output:
 *
 *   $token = node scripts/bootstrap-mcp-token.mjs
 *   pnpm mcp:setup $token
 *
 * The service user has no vault access by design — credentials are off-limits
 * to the MCP server.
 */
import { createRequire } from 'node:module';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Prisma client lives in apps/web/node_modules. Build a require() rooted
// there so this script works regardless of the caller's CWD.
const here = path.dirname(fileURLToPath(import.meta.url));
const requireFromWeb = createRequire(path.join(here, '../apps/web/package.json'));
const { PrismaClient } = requireFromWeb('@prisma/client');

// Service-user identity (deterministic, so reruns are idempotent).
const EMAIL = 'mcp-service@admin-data.local';
const NAME = 'MCP service';

// We cannot run argon2id-protected keypair generation server-side without
// the user's passphrase (zero-knowledge constraint). The service account
// will not own credentials in the vault — only tasks/comments. We fill the
// keypair fields with deterministic dummies so the DB constraint is met but
// no real key material is generated.
const DUMMY_PUBKEY = Buffer.alloc(32, 0);
const DUMMY_BLOB = Buffer.from('mcp-service-account-no-vault-access');

async function main() {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.upsert({
      where: { email: EMAIL },
      update: {},
      create: {
        email: EMAIL,
        name: NAME,
        // login disabled: the service user never logs in via web UI. We set
        // a random password hash so it's not trivially guessable, but no one
        // ever uses it.
        passwordHash: '$argon2id$disabled$service-account-no-login',
        publicKey: DUMMY_PUBKEY,
        encryptedPrivateKey: DUMMY_BLOB,
        encryptedPrivKeyNonce: Buffer.alloc(24, 0),
        kdfSalt: Buffer.alloc(16, 0),
      },
    });

    const projects = await prisma.project.findMany({ select: { id: true, slug: true } });
    if (projects.length > 0) {
      await Promise.all(
        projects.map((p) =>
          prisma.projectMember.upsert({
            where: { projectId_userId: { projectId: p.id, userId: user.id } },
            update: {},
            create: { projectId: p.id, userId: user.id, role: 'MEMBER' },
          }),
        ),
      );
    }

    const plain = `ad_pk_${randomBytes(32).toString('base64url')}`;
    const tokenHash = createHash('sha256').update(plain).digest('hex');
    const prefix = plain.slice(0, 12);

    await prisma.apiToken.create({
      data: {
        userId: user.id,
        name: 'MCP bootstrap',
        tokenHash,
        prefix,
        scopes: ['tasks:read', 'tasks:write', 'comments:write', 'bugs:write'],
        projectSlugs: [],
      },
    });

    process.stdout.write(plain);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('bootstrap-mcp-token failed:', err);
  process.exit(1);
});
