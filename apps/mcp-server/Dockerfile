# syntax=docker/dockerfile:1.7
# Multi-stage build for the MCP stdio server. Final image runs
# `node dist/index.js` and talks to the admin_data_project API over HTTP
# with a scoped bearer token (env: ADMIN_API_BASE_URL, ADMIN_API_TOKEN).

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
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# ---------- Build the MCP server + produce a prod deployment ----------
FROM deps AS builder
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/mcp-server ./apps/mcp-server
RUN pnpm --filter=@admin/mcp-server build
# `pnpm deploy` writes a self-contained tree containing ONLY the deps the
# target package needs (workspace packages get inlined, dev deps dropped).
# This collapses the runtime image from ~1.6 GB to ~150 MB.
RUN pnpm --filter=@admin/mcp-server --prod --legacy deploy /deploy

# ---------- Runtime image ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /deploy ./

RUN addgroup -S mcp && adduser -S mcp -G mcp \
  && chown -R mcp:mcp /app
USER mcp

# stdio transport — no ports to expose.
ENTRYPOINT ["node", "dist/index.js"]
