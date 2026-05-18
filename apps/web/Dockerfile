# syntax=docker/dockerfile:1.7
# Multi-stage build for apps/web (Next.js 15 standalone output).

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ---------- Dependencies ----------
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/web/package.json ./apps/web/
COPY apps/mcp-server/package.json ./apps/mcp-server/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# ---------- Build ----------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
RUN pnpm --filter=@admin/web exec prisma generate
ENV STANDALONE_BUILD=true
RUN pnpm --filter=@admin/web build

# ---------- Runtime ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Runtime deps:
#   wget       → HEALTHCHECK
#   openssl    → evita warning de Prisma + habilita sslmode=require contra Postgres
#   ca-certs   → TLS para conexiones salientes (S3 backup, Postgres remoto, etc.)
RUN apk add --no-cache wget openssl ca-certificates

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Prisma CLI global, mismo pin que @prisma/client en apps/web/package.json.
# Le damos ownership a nextjs porque Prisma a veces escribe engines binarios
# en runtime (download on-demand) y el container corre como user no-root.
RUN npm install -g prisma@5.22.0 \
  && npm cache clean --force \
  && chown -R nextjs:nodejs /usr/local/lib/node_modules/prisma \
  && chown -R nextjs:nodejs /usr/local/lib/node_modules/@prisma 2>/dev/null || true

# Standalone output de Next.js + assets estáticos + schema de Prisma.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/prisma ./apps/web/prisma

# Entrypoint que corre prisma migrate deploy antes de arrancar Next.
COPY --chown=nextjs:nodejs apps/web/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000

# Liveness/readiness para Coolify, k8s o cualquier orquestador.
HEALTHCHECK --interval=20s --timeout=5s --start-period=45s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
