#!/usr/bin/env node
/**
 * Emit a personal API token for a given user (default: the first master
 * user, or whichever email is passed as argv[2]).
 *
 * Usage:
 *   node scripts/emit-personal-token.mjs                       # picks first master user
 *   node scripts/emit-personal-token.mjs manuel@admin-data.local
 *
 * Prints the plain token to stdout. Pipe to setup-mcp.ps1:
 *   $token = node scripts/emit-personal-token.mjs
 *   pnpm mcp:setup $token
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const requireFromWeb = createRequire(path.join(here, '../apps/web/package.json'));
const { PrismaClient } = requireFromWeb('@prisma/client');

const emailArg = process.argv[2];

const prisma = new PrismaClient();
try {
  const user = emailArg
    ? await prisma.user.findUnique({ where: { email: emailArg } })
    : await prisma.user.findFirst({ where: { isMasterUser: true } });

  if (!user) {
    const hint = emailArg
      ? `User ${emailArg} not found.`
      : 'No master user found — sign up via /signup first.';
    throw new Error(hint);
  }

  const plain = `ad_pk_${randomBytes(32).toString('base64url')}`;
  const tokenHash = createHash('sha256').update(plain).digest('hex');
  const prefix = plain.slice(0, 12);

  await prisma.apiToken.create({
    data: {
      userId: user.id,
      name: `Personal token (${new Date().toISOString().slice(0, 10)})`,
      tokenHash,
      prefix,
      scopes: [
        'projects:read',
        'tasks:read',
        'tasks:write',
        'comments:write',
        'bugs:write',
        'brain:read',
        'brain:write',
      ],
      projectSlugs: [], // empty = all projects this user is a member of
    },
  });

  // Only the token goes to stdout — everything else to stderr so callers can
  // do `$token = node scripts/emit-personal-token.mjs` cleanly in PowerShell.
  process.stderr.write(`Emitted token for ${user.email} (${user.name})\n`);
  process.stdout.write(plain);
} finally {
  await prisma.$disconnect();
}
