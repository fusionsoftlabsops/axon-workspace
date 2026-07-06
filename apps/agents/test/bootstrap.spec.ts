import { describe, it, expect } from 'vitest';
import { buildProjectTeam, type RuntimeAgent, type RuntimeProject } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';

const FULL_ENV = {
  AGENTS_ENABLED: '1',
  FUSION_MODEL_URL: 'https://modelo.local/v1',
  FUSION_TOKEN: 'fsn_x',
  ANTHROPIC_API_KEY: 'sk-ant-x',
  GITHUB_TOKEN: 'ghp_x',
};

/** Los 9 agentes habilitados con el modelo que le toca a cada rol. */
function fullAgents(): RuntimeAgent[] {
  const claude = (role: RuntimeAgent['role']): RuntimeAgent => ({
    role,
    token: `t-${role.toLowerCase()}`,
    llmModel: 'claude-sonnet-5',
    enabled: true,
  });
  return [
    claude('SM'),
    claude('PO'),
    claude('ARCHITECT'),
    claude('MARKETING'),
    claude('DESIGN'),
    { role: 'DEV', token: 't-dev', llmModel: 'qwen3-coder-next', enabled: true },
    { role: 'QA', token: 't-qa', llmModel: 'claude-opus-4-8', enabled: true },
    claude('REVIEWER'),
    claude('RELEASE'),
  ];
}

function project(agents: RuntimeAgent[]): RuntimeProject {
  return { projectId: 'p1', projectSlug: 'axon', agents };
}

describe('buildProjectTeam', () => {
  it('con config completa registra los handlers/sweep del equipo (incl. PO)', () => {
    const team = buildProjectTeam(loadConfig(FULL_ENV), project(fullAgents()));
    expect(team.registered).toEqual([
      'SM:assign', 'SM:retro', 'SM:stale-sweep', 'PO', 'ARCHITECT', 'MARKETING', 'DESIGN', 'DEV(+strong)', 'QA', 'REVIEWER', 'RELEASE',
    ]);
    expect(team.skipped).toEqual([]);
    expect(team.handlers).toHaveLength(10); // +release (el sweep no es handler)
    expect(team.staleSweep).not.toBeNull();
  });

  it('sin agentes no registra nada y reporta cada rol ausente', () => {
    const team = buildProjectTeam(loadConfig(FULL_ENV), project([]));
    expect(team.registered).toEqual([]);
    expect(team.handlers).toHaveLength(0);
    expect(team.skipped.map((s) => s.role)).toEqual(['SM', 'PO', 'ARCHITECT', 'MARKETING', 'DESIGN', 'DEV', 'QA', 'REVIEWER', 'RELEASE']);
  });

  it('cada rol degrada por separado según lo que falte', () => {
    const team = buildProjectTeam(
      loadConfig({
        ...FULL_ENV,
        ANTHROPIC_API_KEY: '', // sin Claude: SM pierde retro, QA/REVIEWER quedan fuera
        FUSION_MODEL_URL: '', // sin Qwen: DEV queda fuera
      }),
      project(fullAgents()),
    );
    // PO, Arquitecto, Marketing y Diseño son deterministas (no necesitan Claude) → siguen activos.
    expect(team.registered).toEqual(['SM:assign', 'SM:stale-sweep', 'PO', 'ARCHITECT', 'MARKETING', 'DESIGN', 'RELEASE']);
    expect(team.skipped).toEqual(
      expect.arrayContaining([
        { role: 'SM:retro', reason: 'sin ANTHROPIC_API_KEY' },
        { role: 'DEV', reason: 'sin FUSION_MODEL_URL / FUSION_TOKEN' },
        { role: 'QA', reason: 'sin ANTHROPIC_API_KEY' },
        { role: 'REVIEWER', reason: 'sin ANTHROPIC_API_KEY' },
      ]),
    );
  });

  it('un agente apagado se ignora (como si estuviera ausente)', () => {
    const agents = fullAgents().map((a) => (a.role === 'DEV' ? { ...a, enabled: false } : a));
    const team = buildProjectTeam(loadConfig(FULL_ENV), project(agents));
    expect(team.registered).not.toContain('DEV(+strong)');
    expect(team.skipped).toContainEqual({ role: 'DEV', reason: 'agente ausente/apagado' });
  });
});
