#!/usr/bin/env node
/**
 * admin_data_project — MCP Server (HTTP transport)
 *
 * Streamable-HTTP variant of the stdio server in `index.ts`. Consumed by
 * remote MCP clients (e.g. fusion-code / qwen-code) over HTTPS, mirroring the
 * fusion-infra MCP (`mcp.fusion-soft-lab.com`).
 *
 * Unlike the stdio server, the API token is NOT read from the environment:
 * each caller forwards their own scoped `ad_pk_` token in the `Authorization`
 * header, and the server uses it (per session) to call the web app's /api/v1.
 * This keeps attribution (comments, brain memories) correct per developer and
 * lets each token be revoked independently.
 *
 * Configure via env:
 *   ADMIN_API_BASE_URL  - e.g. https://axon-web-btera.fusion-soft-lab.com/api/v1
 *   PORT                - HTTP port (default 3040)
 *
 * Like the stdio server, this NEVER touches the vault: credentials never flow
 * through LLM context.
 */
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ApiClient } from './api-client.js';
import { ToolRegistry } from './tool-registry.js';
import { registerAllTools } from './tools/register-all.js';

const BASE_URL = process.env.ADMIN_API_BASE_URL;
const PORT = Number(process.env.PORT ?? 3040);

if (!BASE_URL) {
  console.error('admin-mcp-http: missing ADMIN_API_BASE_URL env var.');
  process.exit(1);
}

/** Build a fresh MCP server bound to the caller's bearer token. */
function buildServer(token: string): Server {
  const api = new ApiClient(BASE_URL!, token);
  const registry = new ToolRegistry();
  registerAllTools(registry, api);

  const server = new Server(
    { name: 'admin-data-project', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  registry.attach(server);
  return server;
}

// ---- Streamable HTTP transport (STATELESS) ----
// Antes las sesiones vivían en memoria (Record<sid, transport>): cada redeploy
// del contenedor las borraba y el cliente quedaba con "No valid session" hasta
// reconectar a mano. Este server es de tools puras (sin notificaciones push),
// así que el modo stateless del SDK es el correcto: el Bearer token viaja en
// CADA request, se construye un server efímero por petición y no hay nada que
// perder en un reinicio (además habilita múltiples réplicas).
const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'admin-data-mcp' });
});

app.post('/mcp', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Missing Authorization (admin API token)' },
      id: null,
    });
    return;
  }
  // The web API expects `Bearer ad_pk_...`; ApiClient adds the prefix itself,
  // so strip a leading scheme if the caller already sent one.
  const token = auth.replace(/^Bearer\s+/i, '');
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: sin session id, sin estado
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transport.close();
  });
  await buildServer(token).connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Stateless: no hay stream SSE por sesión ni sesiones que cerrar.
app.get('/mcp', (_req, res) => {
  res.status(405).set('Allow', 'POST').send('Stateless server: use POST');
});
app.delete('/mcp', (_req, res) => {
  res.status(405).set('Allow', 'POST').send('Stateless server: use POST');
});

app.listen(PORT, () => {
  console.log(`admin-data MCP (HTTP) on :${PORT} → ${BASE_URL}`);
});
