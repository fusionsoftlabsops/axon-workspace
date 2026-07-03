# syntax=docker/dockerfile:1.7
# Worker de la plataforma agéntica. Corre `node dist/index.js`, expone /health
# en :3060 y habla con axon-web (Admin API v1) y axon-redis por la red interna
# `fusion`. Config 100% por env (AGENTS_ENABLED, REDIS_URL, AXON_API_BASE_URL,
# AGENT_{SM,DEV,QA}_TOKEN) — nada baked-in.

FROM node:22-alpine AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ---------- Install workspace dependencies ----------
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/mcp-server/package.json ./apps/mcp-server/
COPY apps/agents/package.json ./apps/agents/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# ---------- Build + prod deploy tree ----------
FROM deps AS builder
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/agents ./apps/agents
RUN pnpm --filter=@admin/agents build
RUN pnpm --filter=@admin/agents --prod --legacy deploy /deploy

# ---------- Runtime ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3060

# git: el agente Dev clona el repo del proyecto en un workspace efímero.
RUN apk add --no-cache git

COPY --from=builder /deploy ./

RUN addgroup -S agents && adduser -S agents -G agents \
  && chown -R agents:agents /app
USER agents

EXPOSE 3060
CMD ["node", "dist/index.js"]
