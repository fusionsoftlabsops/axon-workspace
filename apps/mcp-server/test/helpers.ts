import { vi } from 'vitest';
import type { ApiClient } from '../src/api-client.js';
import type { ToolDefinition, ToolRegistry } from '../src/tool-registry.js';

export interface MockApi {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
}

export function mockApi(): MockApi {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  };
}

/**
 * Runs a register* function against a fake registry and returns the captured
 * tool definitions keyed by name, so handlers can be invoked directly.
 */
export function collectTools(
  register: (registry: ToolRegistry, api: ApiClient) => void,
  api: MockApi,
): Map<string, ToolDefinition> {
  const defs = new Map<string, ToolDefinition>();
  const registry = {
    register: (def: ToolDefinition) => {
      defs.set(def.tool.name, def);
    },
  } as unknown as ToolRegistry;
  register(registry, api as unknown as ApiClient);
  return defs;
}

/** Parses the JSON-stringified payload out of an MCP text result. */
export function parseText(res: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(res.content[0].text);
}
