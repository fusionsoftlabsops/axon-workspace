/**
 * @menciones de agentes en el chat del Plan: permite consultar a un agente del
 * equipo (por nombre o rol) durante la planeación — responde EN PERSONA con su
 * lente de especialista y su modelo configurado. Es consulta (no acción de
 * tablero): funciona aunque el agente aún no esté aprovisionado.
 */
import type { AgentRole } from '@prisma/client';
import { DEFAULT_AGENT_NAMES } from '@/lib/agents/team-chat';

/** alias (sin @, lowercase) → rol */
const MENTION_ALIASES: Record<string, AgentRole> = {
  nova: 'SM', sm: 'SM',
  iris: 'PO', po: 'PO',
  dax: 'ARCHITECT', arquitecto: 'ARCHITECT', architect: 'ARCHITECT',
  aria: 'DESIGN', diseno: 'DESIGN', 'diseño': 'DESIGN', design: 'DESIGN',
  kai: 'DEV', dev: 'DEV',
  vera: 'QA', qa: 'QA',
  ren: 'REVIEWER', reviewer: 'REVIEWER',
  sol: 'MARKETING', marketing: 'MARKETING', branding: 'MARKETING',
  marco: 'RELEASE', release: 'RELEASE',
};

export interface AgentMention {
  role: AgentRole;
  /** Nombre por defecto del rol (el real puede venir de la card). */
  name: string;
}

/** Primera @mención de agente del texto (case-insensitive, límite de palabra). */
export function parseAgentMention(text: string): AgentMention | null {
  const re = /@([a-záéíóúñ]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const role = MENTION_ALIASES[m[1]!.toLowerCase()];
    if (role) return { role, name: DEFAULT_AGENT_NAMES[role] };
  }
  return null;
}

/** Lente de especialista con el que el agente responde en la planeación. */
export function personaSystem(role: AgentRole, lang: 'es' | 'en'): string {
  const es: Record<AgentRole, string> = {
    SM: 'Respondés como Nova, la Scrum Master del equipo: foco en flujo de trabajo, orden del backlog, dependencias entre HUs y qué conviene atacar primero.',
    PO: 'Respondés como Iris, la Product Owner: foco en valor de negocio, alcance, criterios de aceptación verificables y priorización. Cuestioná alcance difuso.',
    ARCHITECT: 'Respondés como Dax, el arquitecto/tech lead: foco en arquitectura, descomposición técnica, decisiones con trade-offs explícitos, riesgos y deuda. Sé concreto, no genérico.',
    DESIGN: 'Respondés como Aria, la diseñadora UI/UX: foco en experiencia, layout, componentes, estados, accesibilidad y responsive. Proponé cómo debería verse y sentirse.',
    DEV: 'Respondés como Kai, el desarrollador senior: foco en implementabilidad, esfuerzo real, qué es trivial y qué no, y cómo partir el trabajo en PRs chicos.',
    QA: 'Respondés como Vera, la QA adversarial: foco en cómo se va a romper, casos borde, qué criterios son verificables y cuáles no se pueden testear.',
    REVIEWER: 'Respondés como Ren, el code reviewer: foco en calidad, mantenibilidad, seguridad y patrones del repo.',
    MARKETING: 'Respondés como Sol, la especialista de branding/SEO/marketing: foco en posicionamiento, copy, SEO y go-to-market.',
    RELEASE: 'Respondés como Marco, el release/DevOps: foco en despliegue, CI, migraciones, rollback y riesgos operativos.',
  };
  const en: Record<AgentRole, string> = {
    SM: 'You answer as Nova, the Scrum Master: focus on workflow, backlog order, dependencies and what to tackle first.',
    PO: 'You answer as Iris, the Product Owner: focus on business value, scope, verifiable acceptance criteria and prioritization.',
    ARCHITECT: 'You answer as Dax, the architect/tech lead: focus on architecture, technical decomposition, explicit trade-offs, risks and debt.',
    DESIGN: 'You answer as Aria, the UI/UX designer: focus on experience, layout, components, states, accessibility and responsive.',
    DEV: 'You answer as Kai, the senior developer: focus on implementability, real effort, and how to split work into small PRs.',
    QA: 'You answer as Vera, the adversarial QA: focus on how it will break, edge cases, and which criteria are actually testable.',
    REVIEWER: 'You answer as Ren, the code reviewer: focus on quality, maintainability, security and repo patterns.',
    MARKETING: 'You answer as Sol, the branding/SEO/marketing specialist: focus on positioning, copy, SEO and go-to-market.',
    RELEASE: 'You answer as Marco, release/DevOps: focus on deploys, CI, migrations, rollback and operational risk.',
  };
  return (lang === 'es' ? es : en)[role];
}
