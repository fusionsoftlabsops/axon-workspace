/**
 * Registro ÚNICO de todas las tools — fuente de verdad compartida por ambos
 * transportes (stdio en index.ts y HTTP streamable en http.ts). Tener un solo
 * lugar evita que un transporte quede sin tools nuevas (bug que ocurrió cuando
 * team/supervisor se registraron solo en stdio y nunca aparecieron en el MCP HTTP).
 */
import type { ApiClient } from '../api-client.js';
import type { ToolRegistry } from '../tool-registry.js';
import { registerTaskTools } from './tasks.js';
import { registerCommitTools } from './commits.js';
import { registerBugTools } from './bugs.js';
import { registerBrainTools } from './brain.js';
import { registerStoryTools } from './stories.js';
import { registerSkillTools } from './skills.js';
import { registerTeamTools } from './team.js';
import { registerSupervisorTools } from './supervisor.js';
import { registerPortfolioTools } from './portfolio.js';

export function registerAllTools(registry: ToolRegistry, api: ApiClient): void {
  registerTaskTools(registry, api);
  registerCommitTools(registry, api);
  registerBugTools(registry, api);
  registerBrainTools(registry, api);
  registerStoryTools(registry, api);
  registerSkillTools(registry, api);
  registerTeamTools(registry, api);
  registerSupervisorTools(registry, api);
  registerPortfolioTools(registry, api);
}
