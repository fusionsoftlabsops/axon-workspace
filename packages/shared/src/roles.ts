/**
 * Fuente ÚNICA de verdad de los roles de agente — compartida por web, worker y
 * MCP. Antes esta lista estaba copiada ~7 veces (arrays no exhaustivos) y un rol
 * nuevo se descartaba en silencio. Ahora vive acá una sola vez; la web la cruza
 * contra el enum `AgentRole` de Prisma (ver roles-parity en apps/web) para que
 * agregar un rol al enum ROMPA la compilación en vez de perderse.
 *
 * Nota: este paquete no puede importar Prisma; `AgentRoleName` se define acá y la
 * paridad con el enum se verifica del lado web.
 */
export const AGENT_ROLES = [
  'SM',
  'PO',
  'ARCHITECT',
  'DESIGN',
  'DEV',
  'QA',
  'REVIEWER',
  'MARKETING',
  'RELEASE',
] as const;

export type AgentRoleName = (typeof AGENT_ROLES)[number];

export interface RoleMeta {
  /** Nombre de persona en el equipo (ej. "Nova"). */
  persona: string;
  /** Nombre del usuario de servicio del rol (ej. "Agente Scrum Master"). */
  serviceName: string;
  /** Modelo por defecto al provisionar el equipo estilo-axon. */
  defaultModel: string;
  /** Proveedor LLM del rol cuando corre en el worker. */
  provider: 'claude' | 'qwen';
  /**
   * Rol advisory: dispara generación server-side en axon-web (no usa el LLM del
   * worker). Los no-advisory (DEV/QA/REVIEWER, y el retro del SM) sí lo usan.
   */
  advisory: boolean;
  /** Necesita el token de GitHub (clone/push/PR). */
  needsGit: boolean;
}

const SONNET = 'claude-sonnet-5';
const QWEN = 'qwen3-coder-next';

export const ROLE_META = {
  SM: { persona: 'Nova', serviceName: 'Agente Scrum Master', defaultModel: SONNET, provider: 'claude', advisory: false, needsGit: false },
  PO: { persona: 'Iris', serviceName: 'Agente Product Owner', defaultModel: SONNET, provider: 'claude', advisory: true, needsGit: false },
  ARCHITECT: { persona: 'Dax', serviceName: 'Agente Arquitecto', defaultModel: SONNET, provider: 'claude', advisory: true, needsGit: false },
  DESIGN: { persona: 'Aria', serviceName: 'Agente Diseño', defaultModel: SONNET, provider: 'claude', advisory: true, needsGit: false },
  DEV: { persona: 'Kai', serviceName: 'Agente Dev', defaultModel: QWEN, provider: 'qwen', advisory: false, needsGit: true },
  QA: { persona: 'Vera', serviceName: 'Agente QA', defaultModel: SONNET, provider: 'claude', advisory: false, needsGit: true },
  REVIEWER: { persona: 'Ren', serviceName: 'Agente Code Reviewer', defaultModel: SONNET, provider: 'claude', advisory: false, needsGit: true },
  MARKETING: { persona: 'Sol', serviceName: 'Agente Branding', defaultModel: SONNET, provider: 'claude', advisory: true, needsGit: false },
  RELEASE: { persona: 'Marco', serviceName: 'Agente Release', defaultModel: SONNET, provider: 'claude', advisory: false, needsGit: true },
} satisfies Record<AgentRoleName, RoleMeta>;

/** Set para chequeos de pertenencia (ej. filtrar payloads externos). */
export const AGENT_ROLE_SET: ReadonlySet<string> = new Set(AGENT_ROLES);

/** Mapa rol → modelo por defecto (equipo estilo-axon). */
export const DEFAULT_ROLE_MODEL: Record<AgentRoleName, string> = Object.fromEntries(
  AGENT_ROLES.map((r) => [r, ROLE_META[r].defaultModel]),
) as Record<AgentRoleName, string>;
