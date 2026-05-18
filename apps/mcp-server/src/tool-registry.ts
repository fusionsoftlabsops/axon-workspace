import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

export type ToolHandler = (args: Record<string, unknown> | undefined) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}>;

export interface ToolDefinition {
  tool: Tool;
  handler: ToolHandler;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(def: ToolDefinition): void {
    if (this.tools.has(def.tool.name)) {
      throw new Error(`Tool already registered: ${def.tool.name}`);
    }
    this.tools.set(def.tool.name, def);
  }

  attach(server: Server): void {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Array.from(this.tools.values(), (d) => d.tool),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const def = this.tools.get(req.params.name);
      if (!def) {
        return {
          content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }],
          isError: true,
        };
      }
      try {
        return await def.handler(req.params.arguments);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Tool error: ${message}` }],
          isError: true,
        };
      }
    });
  }
}
