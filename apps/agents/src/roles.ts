/**
 * Roles del worker. Copia local GUARDADA contra la fuente única (@admin/shared):
 * el import de tipo + la aserción rompen la compilación si el SoT cambia, así
 * que un rol nuevo NO se descarta en silencio. No importamos el valor de shared
 * porque el worker corre `node dist` y shared se distribuye como fuente TS (el
 * import de tipo se borra al compilar).
 */
import type { AgentRoleName as SharedRole } from '@admin/shared/roles';

export const AGENT_ROLES = ['SM', 'PO', 'ARCHITECT', 'DESIGN', 'DEV', 'QA', 'REVIEWER', 'MARKETING', 'RELEASE'] as const;

export type AgentRoleName = (typeof AGENT_ROLES)[number];

type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// Rompe la compilación si el set de roles del worker ≠ el SoT compartido.
export type _RolesInSync = Assert<Equal<AgentRoleName, SharedRole>>;

/** Set para filtrar payloads externos por rol conocido. */
export const AGENT_ROLE_SET: ReadonlySet<string> = new Set(AGENT_ROLES);
