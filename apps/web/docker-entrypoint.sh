#!/bin/sh
# Entrypoint para el container web en producción.
# Corre prisma migrate deploy antes de arrancar Next.js. Si la DB no
# responde o las migrations fallan, fail-fast (el container reinicia
# y Coolify reporta unhealthy).

set -e

echo "[entrypoint] $(date -Iseconds) running prisma migrate deploy..."
prisma migrate deploy --schema=./apps/web/prisma/schema.prisma

echo "[entrypoint] $(date -Iseconds) starting Next.js standalone server..."
exec node apps/web/server.js
