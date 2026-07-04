#!/usr/bin/env node
/**
 * admin_data_project — MCP Server
 *
 * Stdio MCP server consumed by Claude Code (or Claude Desktop).
 * Authenticates against the web app's /api/v1 with a scoped API token.
 *
 * Configure via env:
 *   ADMIN_API_BASE_URL  - e.g. http://localhost:3000/api/v1
 *   ADMIN_API_TOKEN     - user-scoped bearer token
 *
 * The server NEVER touches the vault: by design, credentials never flow
 * through LLM context. See plan section "Vault E2E zero-knowledge".
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApiClient } from './api-client.js';
import { ToolRegistry } from './tool-registry.js';
import { registerAllTools } from './tools/register-all.js';

async function main() {
  const baseUrl = process.env.ADMIN_API_BASE_URL;
  const token = process.env.ADMIN_API_TOKEN;

  if (!baseUrl || !token) {
    console.error(
      'admin-mcp: missing ADMIN_API_BASE_URL or ADMIN_API_TOKEN env vars.\n' +
        'Generate a token at <web-app>/settings/tokens and add both vars to your Claude Code MCP config.',
    );
    process.exit(1);
  }

  const api = new ApiClient(baseUrl, token);
  const registry = new ToolRegistry();

  registerAllTools(registry, api);

  const server = new Server(
    { name: 'admin-data-project', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  registry.attach(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('admin-mcp fatal error:', err);
  process.exit(1);
});
