# syntax=docker/dockerfile:1.7
# Multi-stage build for apps/web (Next.js 15 standalone output).
#
# Base Debian (node:22-slim, glibc + OpenSSL 3): el engine de Prisma
# `debian-openssl-3.0.x` carga de forma confiable. Antes usábamos node:22-alpine
# y el engine caía en `linux-musl` (necesitaba libssl.so.1.1, ausente en Alpine
# con OpenSSL 3) → PrismaClientInitializationError → crash-loop. Ver binaryTargets
# en prisma/schema.prisma (["native","debian-openssl-3.0.x"]).

FROM node:22-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# openssl/ca-certs en el BUILDER: sin el paquete openssl, Prisma no detecta
# OpenSSL 3 al `generate`/`build` y cae al engine `debian-openssl-1.1.x` (que
# necesita libssl.so.1.1, ausente) → crash. Con openssl detecta 3.0.x correcto.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

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
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Runtime deps:
#   wget       → HEALTHCHECK
#   openssl    → engine de Prisma (libssl.so.3) + sslmode=require contra Postgres
#   ca-certs   → TLS para conexiones salientes (S3 backup, Postgres remoto, etc.)
RUN apt-get update \
  && apt-get install -y --no-install-recommends wget openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs

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
