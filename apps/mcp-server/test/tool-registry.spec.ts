import { describe, expect, it, vi } from 'vitest';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ToolRegistry, type ToolDefinition } from '../src/tool-registry.js';

function makeDef(name: string, handler?: ToolDefinition['handler']): ToolDefinition {
  return {
    tool: { name, description: name, inputSchema: { type: 'object' } },
    handler:
      handler ?? (async () => ({ content: [{ type: 'text' as const, text: name }] })),
  };
}

/** Captures the two request handlers attach() wires onto the Server. */
function fakeServer() {
  const handlers = new Map<unknown, (req: unknown) => Promise<unknown>>();
  const server = {
    setRequestHandler: vi.fn((schema: unknown, fn: (req: unknown) => Promise<unknown>) => {
      handlers.set(schema, fn);
    }),
  };
  return { server: server as unknown as Server, handlers, spy: server.setRequestHandler };
}

describe('ToolRegistry', () => {
  it('registers a tool', () => {
    const reg = new ToolRegistry();
    expect(() => reg.register(makeDef('a'))).not.toThrow();
  });

  it('throws on duplicate tool name', () => {
    const reg = new ToolRegistry();
    reg.register(makeDef('dup'));
    expect(() => reg.register(makeDef('dup'))).toThrow('Tool already registered: dup');
  });

  it('attach wires ListTools to return all registered tools', async () => {
    const reg = new ToolRegistry();
    reg.register(makeDef('a'));
    reg.register(makeDef('b'));
    const { server, handlers, spy } = fakeServer();

    reg.attach(server);

    expect(spy).toHaveBeenCalledTimes(2);
    const listHandler = handlers.get(ListToolsRequestSchema)!;
    const res = (await listHandler({})) as { tools: Array<{ name: string }> };
    expect(res.tools.map((t) => t.name)).toEqual(['a', 'b']);
  });

  it('attach dispatches CallTool to the matching handler', async () => {
    const reg = new ToolRegistry();
    const handler = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    }));
    reg.register(makeDef('go', handler));
    const { server, handlers } = fakeServer();
    reg.attach(server);

    const call = handlers.get(CallToolRequestSchema)!;
    const res = await call({ params: { name: 'go', arguments: { x: 1 } } });

    expect(handler).toHaveBeenCalledWith({ x: 1 });
    expect(res).toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });

  it('attach returns an isError result for an unknown tool', async () => {
    const reg = new ToolRegistry();
    const { server, handlers } = fakeServer();
    reg.attach(server);

    const call = handlers.get(CallToolRequestSchema)!;
    const res = (await call({ params: { name: 'nope', arguments: {} } })) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('Unknown tool: nope');
  });

  it('attach wraps a thrown Error into an isError result', async () => {
    const reg = new ToolRegistry();
    reg.register(
      makeDef('boom', async () => {
        throw new Error('kaboom');
      }),
    );
    const { server, handlers } = fakeServer();
    reg.attach(server);

    const call = handlers.get(CallToolRequestSchema)!;
    const res = (await call({ params: { name: 'boom', arguments: {} } })) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('Tool error: kaboom');
  });

  it('attach stringifies a non-Error throw', async () => {
    const reg = new ToolRegistry();
    reg.register(
      makeDef('boom2', async () => {
        throw 'plain-string';
      }),
    );
    const { server, handlers } = fakeServer();
    reg.attach(server);

    const call = handlers.get(CallToolRequestSchema)!;
    const res = (await call({ params: { name: 'boom2', arguments: {} } })) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('Tool error: plain-string');
  });
});
