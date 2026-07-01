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
import { randomUUID } from 'node:crypto';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { ApiClient } from './api-client.js';
import { ToolRegistry } from './tool-registry.js';
import { registerTaskTools } from './tools/tasks.js';
import { registerCommitTools } from './tools/commits.js';
import { registerBugTools } from './tools/bugs.js';
import { registerBrainTools } from './tools/brain.js';
import { registerStoryTools } from './tools/stories.js';
import { registerSkillTools } from './tools/skills.js';

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
  registerTaskTools(registry, api);
  registerCommitTools(registry, api);
  registerBugTools(registry, api);
  registerBrainTools(registry, api);
  registerStoryTools(registry, api);
  registerSkillTools(registry, api);

  const server = new Server(
    { name: 'admin-data-project', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  registry.attach(server);
  return server;
}

// ---- Streamable HTTP transport (stateful sessions, token per session) ----
const transports: Record<string, StreamableHTTPServerTransport> = {};
const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'admin-data-mcp' });
});

app.post('/mcp', async (req, res) => {
  const sid = req.headers['mcp-session-id'] as string | undefined;
  let transport: StreamableHTTPServerTransport | undefined = sid ? transports[sid] : undefined;

  if (!transport) {
    if (sid || !isInitializeRequest(req.body)) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'No valid session; send initialize first' },
        id: null,
      });
      return;
    }
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
    const t = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports[id] = t;
      },
    });
    t.onclose = () => {
      if (t.sessionId) delete transports[t.sessionId];
    };
    await buildServer(token).connect(t);
    transport = t;
  }
  await transport.handleRequest(req, res, req.body);
});

// GET (SSE stream) / DELETE (end session) reuse the session transport.
const bySession = async (req: express.Request, res: express.Response) => {
  const sid = req.headers['mcp-session-id'] as string | undefined;
  const transport = sid ? transports[sid] : undefined;
  if (!transport) {
    res.status(400).send('Invalid or missing session id');
    return;
  }
  await transport.handleRequest(req, res);
};
app.get('/mcp', bySession);
app.delete('/mcp', bySession);

app.listen(PORT, () => {
  console.log(`admin-data MCP (HTTP) on :${PORT} → ${BASE_URL}`);
});
