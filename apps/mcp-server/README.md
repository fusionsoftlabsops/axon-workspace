# @admin/mcp-server

MCP stdio server que conecta Claude Code con `admin_data_project`. Se despliega como **imagen Docker** (`admin-data-mcp:latest`) — Claude Code la invoca con `docker run -i --rm` en cada sesión.

## Despliegue (recomendado: Docker)

Desde la raíz del repo:

```pwsh
# 1. Build de la imagen (solo la primera vez o tras cambios en el código)
pnpm mcp:docker:build

# 2. Generar un token bootstrap + registrar en Claude Code
$token = node scripts/bootstrap-mcp-token.mjs
pnpm mcp:setup $token

# 3. Verificar
claude mcp get admin-data
```

`bootstrap-mcp-token.mjs` crea un usuario "MCP service" no-interactivo (sin acceso al vault) y emite un token API con scopes `tasks:read|write`, `comments:write`, `bugs:write`. Es idempotente — se puede correr de nuevo para rotar el token.

> **Cuando crees proyectos**, el MCP service user debe agregarse como miembro para que el MCP pueda verlos. El bootstrap lo agrega automáticamente a todos los proyectos que existan al momento de generar el token. Si creas un proyecto después, agrega manualmente `mcp-service@admin-data.local` como `MEMBER` desde `/projects/<slug>/settings` (o re-corre el bootstrap).

## Uso desde Claude Code

Una vez registrado, en cualquier proyecto donde abras Claude Code:

```
> ¿Qué tareas tengo asignadas en admin_data_project?
> Marca la tarea PROJ-12 como Desarrollo.
> Genera el mensaje de commit para PROJ-12: "implementar middleware de rate limit"
> Reporta un bug en admin_data_project: el endpoint /api/v1/tasks tira 500 cuando taskNumber es 0.
```

Claude detecta automáticamente las 20 tools disponibles:

**Tareas**
| Tool | Acción |
|------|--------|
| `list_my_tasks` | Lista tareas asignadas (filtrable por proyecto y estado). |
| `get_task` | Detalles de una tarea (descripción, subtareas, comentarios). |
| `update_task_status` | Mueve una tarea entre estados del workflow. |
| `create_task` | Crea tarea o subtarea. |
| `add_comment` | Comenta en una tarea. |

**Commits / PRs / bugs**
| Tool | Acción |
|------|--------|
| `generate_commit_message` | Mensaje de commit ligado a una tarea (vía Sonnet 4.6). |
| `generate_pr_description` | Descripción de PR usando contexto de la tarea (vía Sonnet 4.6). |
| `report_bug` | Crea un bug ticket con resumen + repro + stack trace. |

**Cerebro del proyecto**
| Tool | Acción |
|------|--------|
| `recall` | Busca memorias relevantes del cerebro (full-text). Úsalo al iniciar una tarea. |
| `pull_project_brain` | Trae novedades incrementales del cerebro principal desde tu último pull. |
| `cite_memory` | Registra que una memoria informó tu trabajo en una tarea (alimenta métricas). |
| `capture_memory` | Captura manual de un aprendizaje (tipo DECISION/GOTCHA/PATTERN/ANTIPATTERN/RUNBOOK/GLOSSARY/NOTE). |
| `publish_memory` | Promueve una memoria LOCAL → PROJECT. |
| `extract_memories_from_task` | Ejecuta el extractor IA sobre una tarea para generar candidatos LOCAL. |

**Historias de Usuario (HU) y repo**
| Tool | Acción |
|------|--------|
| `draft_user_story` | Genera un borrador de HU partiendo de una necesidad en lenguaje natural + archivos del repo + memorias del cerebro. El server ejecuta la generación en background; la tool hace polling hasta READY/ERRORED (default 90s). Requiere `repoPath` configurado en el proyecto y al menos una `LlmCredential`. |
| `get_story_draft` | Estado actual de un draft por id. Útil cuando `draft_user_story` hizo timeout. |
| `list_story_drafts` | Lista los drafts del proyecto con summary + status + costo. |
| `publish_story_draft` | Publica un draft READY como Task con `kind=STORY`. Opcionalmente crea subtasks hijas a partir del `subtaskBreakdown` (índices 0-based). |
| `list_repo_tree` | Árbol del repo sandboxeado al `repoPath` del proyecto. Útil antes de `draft_user_story` para elegir paths relevantes. |
| `grep_repo` | Búsqueda de texto literal en el repo (escapado como regex). Máx 100 hits con `path:line:text`. |

### Ejemplo: generar y publicar una HU

```
> draft_user_story:
    projectSlug: "mi-cliente-principal"
    rawInput: "Agregar export CSV de tareas filtrado por columna del Kanban"
    provider: "ANTHROPIC"
    model: "claude-sonnet-4-6"
    credentialId: "<id de la LlmCredential, ver /settings/llm-credentials>"
    selectedPaths: ["apps/web/src/app/(app)/projects/[slug]/board"]
    maxWaitMs: 90000

# Devuelve { draftId, status: 'READY', summary, acceptanceCriteria, subtaskBreakdown, ... }

> publish_story_draft:
    projectSlug: "mi-cliente-principal"
    draftId: "<draftId de arriba>"
    stateId: "<id del WorkflowState destino, ej. la columna Preparación>"
    includeSubtasks: [0, 1, 2]   # primeros 3 índices del subtaskBreakdown
```

La HU se crea como `Task` con `kind: 'STORY'` + N subtareas hijas con `parentTaskId`.

## Modo desarrollo (sin Docker)

Para iterar rápido sobre el código del MCP server:

```pwsh
pnpm mcp:dev   # watch mode con tsx
```

Y registra una entrada que use el binario local en lugar de Docker:

```pwsh
claude mcp add admin-data-dev `
  --scope user `
  -e ADMIN_API_BASE_URL=http://localhost:3000/api/v1 `
  -e ADMIN_API_TOKEN=ad_pk_xxxx `
  -- node "$PWD/apps/mcp-server/dist/index.js"
```

(Tienes que correr `pnpm mcp:build` antes para que `dist/index.js` exista.)

## Arquitectura

```
Claude Code
    │ stdio (JSON-RPC)
    ▼
docker run -i --rm
    │ ENV: ADMIN_API_BASE_URL, ADMIN_API_TOKEN
    ▼
admin-data-mcp container (node:22-alpine, ~280 MB)
    │ HTTP/JSON
    │ Authorization: Bearer ad_pk_*
    ▼
host.docker.internal:3000 → Next.js /api/v1/*
    │
    ▼
PostgreSQL
```

## Lo que **no** hace

El MCP server **no accede al vault de credenciales**, por diseño. El vault es zero-knowledge: los secretos solo se desencriptan en el browser del usuario con su passphrase. Permitir que un MCP server lea credenciales rompería esa garantía y filtraría secretos al contexto del LLM.

Si necesitas credenciales durante el desarrollo (ej. API keys para tests), cópialas manualmente desde la UI del vault.

Las `LlmCredential` (API keys de Anthropic/OpenAI/Google/Moonshot que `draft_user_story` necesita) son **distintas** del vault: viven server-side, encriptadas con `AUTH_TOTP_KEY` (no con la passphrase del usuario). El MCP server las usa indirectamente vía `credentialId` — nunca ve la key plana, solo dispara la generación en el server donde se decripta en memoria por la duración de la request.

El acceso al repo via `list_repo_tree` / `grep_repo` / `draft_user_story` está sandboxeado al `repoPath` configurado en el proyecto: paths que intenten escapar (`..`, absolutos, symlinks que salen) se rechazan en el server.

## Rotación / revocación

Para revocar el token actual (la cuenta MCP service deja de funcionar inmediatamente):

```pwsh
# Vía UI: /settings/tokens, click "Revocar" en el row del token
# O re-bootstrap para emitir uno nuevo:
$token = node scripts/bootstrap-mcp-token.mjs
pnpm mcp:setup $token
```

Para des-registrar el MCP de Claude Code:

```pwsh
pnpm mcp:remove
```
