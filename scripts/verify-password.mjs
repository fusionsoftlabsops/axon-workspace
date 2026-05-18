import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const requireFromWeb = createRequire(path.join(here, '../apps/web/package.json'));
const { verify } = requireFromWeb('@node-rs/argon2');
const { PrismaClient } = requireFromWeb('@prisma/client');

const p = new PrismaClient();
const u = await p.user.findUnique({
  where: { email: 'manuel@admin-data.local' },
  select: { passwordHash: true },
});
console.log('hash:', u.passwordHash);
for (const pwd of [
  'MasterLogin-2026-Strong',
  'vault-passphrase-correct-horse-battery',
]) {
  try {
    const ok = await verify(u.passwordHash, pwd);
    console.log(JSON.stringify({ pwd, ok }));
  } catch (e) {
    console.log(JSON.stringify({ pwd, error: e.message }));
  }
}
await p.$disconnect();
