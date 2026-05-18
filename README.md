# admin_data_project

Plataforma **self-hosted** multi-proyecto con:

- Kanban configurable con jerarquía Epic → Tarea → Subtarea.
- **Vault E2E zero-knowledge** de credenciales por proyecto, con permisos granulares por colaborador. Ni el admin del servidor puede leer secretos en claro.
- **IA integrada** (Claude Haiku/Sonnet/Opus) para redacción de tareas, criterios de aceptación y breakdown de epics.
- **MCP server** que conecta Claude Code con tus tareas: listar, actualizar estado, generar commits/PRs, reportar bugs.

## Stack

| Capa | Elección |
|------|----------|
| Frontend | Next.js 15 (App Router) · React 19 · SASS Modules · @dnd-kit |
| Backend | Server Actions · Route Handlers · Auth.js v5 + TOTP |
| ORM/DB | Prisma 5 · PostgreSQL 16 |
| Cripto | libsodium-wrappers (X25519 sealed boxes, XSalsa20-Poly1305, argon2id) |
| IA | @anthropic-ai/sdk con router Haiku/Sonnet/Opus |
| MCP | @modelcontextprotocol/sdk (servidor Node separado) |
| Deploy | Docker Compose |

## Arranque rápido (desarrollo)

```sh
# 1. Instalar dependencias
pnpm install

# 2. Levantar Postgres
docker compose up -d db

# 3. Copiar y editar variables de entorno
cp .env.example .env
# Generar AUTH_SECRET: openssl rand -base64 32

# 4. Migrar la base de datos y semilla
pnpm db:migrate
pnpm db:seed

# 5. Levantar la web en dev
pnpm dev
```

Abre http://localhost:3000 y crea tu usuario master.

## Producción (Docker Compose completo)

```sh
docker compose --profile prod up -d
```

Levanta `db` + `web`.

### MCP server (Docker, integrado en Claude Code)

```pwsh
# Build de la imagen ~280 MB (~2 min primera vez)
pnpm mcp:docker:build

# Generar token + registrar en Claude Code
$token = node scripts/bootstrap-mcp-token.mjs
pnpm mcp:setup $token

# Verificar
claude mcp get admin-data
```

Claude Code arranca un contenedor fresco con `docker run -i --rm` en cada
sesión y se comunica por stdio. Ver [`apps/mcp-server/README.md`](apps/mcp-server/README.md)
para detalles, modo dev y troubleshooting.

## Estructura del monorepo

```
.
├── apps/
│   ├── web/          # Next.js 15 (UI + API)
│   └── mcp-server/   # MCP stdio server para Claude Code
├── packages/
│   └── shared/       # Tipos y Zod schemas compartidos
├── docker-compose.yml
└── .env.example
```

## Documentación

- Plan completo: ver `~/.claude/plans/trabajo-en-m-ltiples-proyectos-*.md`.
- Arquitectura criptográfica del vault: sección "Vault E2E zero-knowledge" del plan.
- Configuración MCP para Claude Code: [`apps/mcp-server/README.md`](apps/mcp-server/README.md).
