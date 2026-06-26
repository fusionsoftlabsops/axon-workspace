# graphify-svc

Thin HTTP wrapper around the [`graphify`](https://pypi.org/project/graphifyy/)
code knowledge-graph engine. Axon's **"Analyze an existing project"** onboarding
calls this over the internal `fusion` Docker network — the same way the web app
already calls the self-hosted infra LLM (`apps/web/src/lib/ai/infra-llm.ts`).

Given a project's GitHub repos, it clones them and runs the proven
`python -m graphify extract` pipeline, returning the combined knowledge graph
(`{ nodes, edges, communities }`) plus token/cost stats.

## API

### `GET /health`
```json
{ "ok": true, "service": "graphify-svc", "version": "0.1.0",
  "githubConfigured": true, "defaultBackend": "deepseek", "allowedOrgs": ["fusionsoftlabsops"] }
```

### `POST /analyze`
Body:
```json
{
  "repos": [
    { "name": "idea-forge-backend", "githubFullName": "fusionsoftlabsops/idea-forge-backend", "branch": "main", "kind": "backend" }
  ],
  "backend": "deepseek"
}
```
- `githubFullName` (`owner/repo`) or a `github.com/...` `cloneUrl` is required per repo.
- Only owners in `GRAPHIFY_ALLOWED_ORGS` are clonable (guards against arbitrary clone/SSRF).
- If `GRAPHIFY_AUTH_TOKEN` is set, send `Authorization: Bearer <token>`.

Response:
```json
{
  "graph": { "nodes": [...], "edges": [...], "links": [...] },
  "stats": { "nodes": 542, "edges": 503, "communities": 47, "tokensIn": 43356, "tokensOut": 7443, "costUsd": 0.0082, "backend": "deepseek" },
  "report": "# GRAPH_REPORT.md …",
  "backend": "deepseek",
  "repos": ["fusionsoftlabsops/idea-forge-backend"]
}
```

## Configuration (env)

| Var | Purpose |
|---|---|
| `GRAPHIFY_GITHUB_TOKEN` | PAT with read access to the private repos (injected into the clone URL; never returned/logged) |
| `GRAPHIFY_ALLOWED_ORGS` | comma-separated org allowlist (default `fusionsoftlabsops`) |
| `GRAPHIFY_AUTH_TOKEN` | optional bearer the caller (Axon) must present |
| `GRAPHIFY_BACKEND` | default extraction backend (default `deepseek`) |
| `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` / … | read by `graphify` for semantic extraction |
| `GRAPHIFY_MAX_REPOS` | per-request repo cap (default 10) |
| `GRAPHIFY_EXTRACT_TIMEOUT` | seconds before the extract subprocess is killed (default 1500) |
| `PORT` | listen port (default 3050) |

## Develop / test

```sh
python -m venv .venv && .venv/Scripts/python -m pip install fastapi pydantic httpx pytest
.venv/Scripts/python -m pytest -q          # clone + extract are monkeypatched (offline)
```

## Build / run

```sh
docker build -t graphify-svc apps/graphify-svc
docker run --rm -p 3050:3050 \
  -e GRAPHIFY_GITHUB_TOKEN=ghp_xxx -e DEEPSEEK_API_KEY=sk-xxx graphify-svc
```

Deployed on fusion-infra as an **internal-only** app (no public domain); Axon
reaches it via `GRAPHIFY_URL` on the `fusion` network.
