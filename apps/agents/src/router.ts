/**
 * Router de eventos → handlers de rol. Cada rol registra qué eventos le
 * interesan (matches) y qué hace con ellos (handle). El router despacha en
 * serie por handler pero aísla errores: un handler que truena no afecta a los
 * demás ni tumba la suscripción.
 */
import type { DomainEventV1 } from './events.js';

export type AgentRoleName =
  | 'SM' | 'DEV' | 'QA' | 'PO' | 'DESIGN' | 'REVIEWER' | 'ARCHITECT' | 'MARKETING' | 'RELEASE';

export interface RoleHandler {
  role: AgentRoleName;
  /** ¿Este evento le incumbe al rol? Debe ser barato (sin IO). */
  matches(event: DomainEventV1): boolean;
  /** Reacción del rol (puede ser costosa: llama a la Admin API / LLM). */
  handle(event: DomainEventV1): Promise<void>;
}

export interface DispatchResult {
  role: AgentRoleName;
  ok: boolean;
  error?: string;
}

export class EventRouter {
  private handlers: RoleHandler[] = [];

  register(handler: RoleHandler): void {
    this.handlers.push(handler);
  }

  get size(): number {
    return this.handlers.length;
  }

  /** Despacha el evento a todos los handlers que hagan match, aislando fallos. */
  async dispatch(event: DomainEventV1): Promise<DispatchResult[]> {
    const results: DispatchResult[] = [];
    for (const h of this.handlers) {
      let interested = false;
      try {
        interested = h.matches(event);
      } catch {
        interested = false;
      }
      if (!interested) continue;
      try {
        await h.handle(event);
        results.push({ role: h.role, ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[agents] handler ${h.role} failed on ${event.type}:`, msg);
        results.push({ role: h.role, ok: false, error: msg });
      }
    }
    return results;
  }
}
