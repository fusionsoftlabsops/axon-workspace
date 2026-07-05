/**
 * Puente entre la fuente única de roles (@admin/shared) y el enum `AgentRole` de
 * Prisma. El chequeo de paridad de abajo ROMPE la compilación si el enum de
 * Prisma y AGENT_ROLES divergen (agregar/quitar un rol en uno obliga al otro).
 */
import type { AgentRole } from '@prisma/client';
import { AGENT_ROLES, ROLE_META, DEFAULT_ROLE_MODEL, type AgentRoleName } from '@admin/shared';

// Paridad bidireccional: AgentRole (Prisma) === AgentRoleName (shared).
type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _RolesInSync = Assert<Equal<AgentRole, AgentRoleName>>;

/** Los 9 roles, tipados como el enum de Prisma (misma lista que @admin/shared). */
export const ROLES: AgentRole[] = [...AGENT_ROLES];

export { ROLE_META, DEFAULT_ROLE_MODEL };
