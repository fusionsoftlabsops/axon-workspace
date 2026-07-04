/**
 * Presets de equipo agéntico: 3 configuraciones elegibles con un click,
 * correlacionadas al esfuerzo del proyecto. Fuente ÚNICA de verdad: la tabla
 * comparativa de la UI y la acción que aplica la config leen de acá.
 *
 * Racional de asignación (dónde rinde cada modelo):
 * - fable-5   → solo el Arquitecto en MAX: la descomposición de arquitectura es
 *               el razonamiento más duro del ciclo y define todo lo demás.
 * - opus-4-8  → PO/QA/Reviewer/Aria en MAX: juicio profundo.
 * - sonnet-5  → caballo de batalla (probado en producción).
 * - qwen      → Dev self-hosted (≈$0) para lo trivial/backend.
 * - haiku-4-5 → roles de proceso en ECO.
 * - gpt-image-1 (OpenAI) → imágenes en todos los tiers, calidad escalonada.
 */
import type { AgentRole } from '@prisma/client';

export type TeamPreset = 'ECO' | 'BALANCED' | 'MAX';

export interface PresetRoleConfig {
  enabled: boolean;
  llmModel: string;
  tokenBudget: number;
}

export interface PresetDef {
  id: TeamPreset;
  /** [es, en] */
  name: [string, string];
  tagline: [string, string];
  costHint: string;
  examples: Array<[string, string]>;
  roles: Record<AgentRole, PresetRoleConfig>;
}

const QWEN = 'qwen3-coder-next';
const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-5';
const OPUS = 'claude-opus-4-8';
const FABLE = 'claude-fable-5';

export const TEAM_PRESETS: Record<TeamPreset, PresetDef> = {
  ECO: {
    id: 'ECO',
    name: ['🟢 Económica', '🟢 Economy'],
    tagline: [
      '4 agentes, lo barato donde alcanza. Para proyectos simples y validaciones.',
      '4 agents, cheap where it suffices. For simple projects and validations.',
    ],
    costHint: '~$0.05–0.3 / HU',
    examples: [
      ['Landing page con formulario de contacto', 'Landing page with a contact form'],
      ['Portfolio personal o página de evento', 'Personal portfolio or event page'],
      ['Microsite de campaña con inscripción', 'Campaign microsite with signup'],
      ['Blog estático o página institucional', 'Static blog or company page'],
      ['MVP para validar una idea rápido', 'Quick idea-validation MVP'],
    ],
    roles: {
      SM: { enabled: true, llmModel: HAIKU, tokenBudget: 150_000 },
      PO: { enabled: true, llmModel: HAIKU, tokenBudget: 150_000 },
      ARCHITECT: { enabled: false, llmModel: SONNET, tokenBudget: 150_000 },
      DESIGN: { enabled: true, llmModel: HAIKU, tokenBudget: 150_000 },
      DEV: { enabled: true, llmModel: QWEN, tokenBudget: 200_000 },
      QA: { enabled: true, llmModel: HAIKU, tokenBudget: 150_000 },
      REVIEWER: { enabled: false, llmModel: SONNET, tokenBudget: 150_000 },
      MARKETING: { enabled: true, llmModel: HAIKU, tokenBudget: 150_000 },
      RELEASE: { enabled: false, llmModel: SONNET, tokenBudget: 150_000 },
    },
  },
  BALANCED: {
    id: 'BALANCED',
    name: ['🟡 Equilibrada', '🟡 Balanced'],
    tagline: [
      'Equipo completo con fuerza donde duele. Para aplicaciones estándar.',
      'Full team with muscle where it hurts. For standard applications.',
    ],
    costHint: '~$0.5–2 / HU',
    examples: [
      ['SaaS con auth, dashboard y suscripciones', 'SaaS with auth, dashboard and subscriptions'],
      ['E-commerce chico (catálogo + carrito + pagos)', 'Small e-commerce (catalog + cart + payments)'],
      ['App de reservas/turnos con calendario', 'Booking app with calendar'],
      ['Panel administrativo con reportes', 'Admin panel with reporting'],
      ['API REST + frontend web', 'REST API + web frontend'],
    ],
    roles: {
      SM: { enabled: true, llmModel: SONNET, tokenBudget: 300_000 },
      PO: { enabled: true, llmModel: SONNET, tokenBudget: 300_000 },
      ARCHITECT: { enabled: true, llmModel: SONNET, tokenBudget: 300_000 },
      DESIGN: { enabled: true, llmModel: SONNET, tokenBudget: 300_000 },
      DEV: { enabled: true, llmModel: QWEN, tokenBudget: 500_000 },
      QA: { enabled: true, llmModel: SONNET, tokenBudget: 500_000 },
      REVIEWER: { enabled: true, llmModel: SONNET, tokenBudget: 300_000 },
      MARKETING: { enabled: true, llmModel: SONNET, tokenBudget: 300_000 },
      RELEASE: { enabled: true, llmModel: SONNET, tokenBudget: 150_000 },
    },
  },
  MAX: {
    id: 'MAX',
    name: ['🔴 Máxima', '🔴 Maximum'],
    tagline: [
      'Los 9 agentes a máxima potencia, cero cuellos de botella. Para sistemas de alta exigencia.',
      'All 9 agents at full power, zero bottlenecks. For high-demand systems.',
    ],
    costHint: '~$3–10 / HU',
    examples: [
      ['Sistema de inventario y ventas multi-sucursal', 'Multi-branch inventory & sales system'],
      ['Arquitectura de microservicios con colas y eventos', 'Microservices architecture with queues and events'],
      ['ERP/CRM con módulos interdependientes', 'ERP/CRM with interdependent modules'],
      ['Fintech con pagos, conciliación y auditoría', 'Fintech with payments, reconciliation and auditing'],
      ['Plataforma multi-tenant de alta concurrencia', 'High-concurrency multi-tenant platform'],
    ],
    roles: {
      SM: { enabled: true, llmModel: SONNET, tokenBudget: 500_000 },
      PO: { enabled: true, llmModel: OPUS, tokenBudget: 500_000 },
      ARCHITECT: { enabled: true, llmModel: FABLE, tokenBudget: 500_000 },
      DESIGN: { enabled: true, llmModel: OPUS, tokenBudget: 500_000 },
      DEV: { enabled: true, llmModel: SONNET, tokenBudget: 1_000_000 },
      QA: { enabled: true, llmModel: OPUS, tokenBudget: 1_000_000 },
      REVIEWER: { enabled: true, llmModel: OPUS, tokenBudget: 500_000 },
      MARKETING: { enabled: true, llmModel: SONNET, tokenBudget: 300_000 },
      RELEASE: { enabled: true, llmModel: SONNET, tokenBudget: 150_000 },
    },
  },
};

export const PRESET_IDS: TeamPreset[] = ['ECO', 'BALANCED', 'MAX'];

export function isTeamPreset(v: string): v is TeamPreset {
  return v === 'ECO' || v === 'BALANCED' || v === 'MAX';
}
