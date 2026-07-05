/**
 * Lista local de roles para las tools del MCP. Es una copia GUARDADA contra la
 * fuente única (@admin/shared): el import de tipo + la aserción de abajo rompen
 * la compilación si el SoT cambia, así que no puede haber descarte silencioso.
 * (No importamos el VALOR de shared porque este app corre `node dist` y shared
 * se distribuye como fuente TS; el import de tipo se borra al compilar.)
 */
import type { AgentRoleName } from '@admin/shared';

export const ROLES = ['SM', 'PO', 'ARCHITECT', 'DESIGN', 'DEV', 'QA', 'REVIEWER', 'MARKETING', 'RELEASE'] as const;

type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// Rompe la compilación si ROLES ≠ AgentRoleName (SoT).
export type _RolesInSync = Assert<Equal<(typeof ROLES)[number], AgentRoleName>>;
