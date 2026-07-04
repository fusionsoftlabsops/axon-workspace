import { describe, it, expect } from 'vitest';
import { buildTeam } from '../src/bootstrap.js';
import { EventRouter } from '../src/router.js';
import { loadConfig } from '../src/config.js';

const FULL_ENV = {
  AGENTS_ENABLED: '1',
  AGENT_PROJECT_ID: 'p1',
  AGENT_PROJECT_SLUG: 'axon',
  AGENT_SM_TOKEN: 'ad_pk_sm',
  AGENT_PO_TOKEN: 'ad_pk_po',
  AGENT_ARCHITECT_TOKEN: 'ad_pk_arch',
  AGENT_DESIGN_TOKEN: 'ad_pk_design',
  AGENT_DEV_TOKEN: 'ad_pk_dev',
  AGENT_QA_TOKEN: 'ad_pk_qa',
  AGENT_REVIEWER_TOKEN: 'ad_pk_reviewer',
  FUSION_MODEL_URL: 'https://modelo.local/v1',
  FUSION_TOKEN: 'fsn_x',
  ANTHROPIC_API_KEY: 'sk-ant-x',
  GITHUB_TOKEN: 'ghp_x',
};

describe('buildTeam', () => {
  it('con config completa registra los handlers/sweep del equipo (incl. PO)', () => {
    const router = new EventRouter();
    const team = buildTeam(loadConfig(FULL_ENV), router);
    expect(team.registered).toEqual(['SM:assign', 'SM:retro', 'SM:stale-sweep', 'PO', 'ARCHITECT', 'DESIGN', 'DEV(+strong)', 'QA', 'REVIEWER']);
    expect(team.skipped).toEqual([]);
    expect(router.size).toBe(8); // assign+retro+po+architect+design+dev+qa+reviewer (el sweep no es handler)
    expect(team.staleSweep).not.toBeNull();
  });

  it('sin proyecto configurado no registra nada y lo reporta', () => {
    const router = new EventRouter();
    const team = buildTeam(loadConfig({ AGENTS_ENABLED: '1' }), router);
    expect(team.registered).toEqual([]);
    expect(team.skipped[0]!.reason).toContain('AGENT_PROJECT_ID');
    expect(router.size).toBe(0);
  });

  it('cada rol degrada por separado según lo que falte', () => {
    const router = new EventRouter();
    const team = buildTeam(
      loadConfig({
        ...FULL_ENV,
        ANTHROPIC_API_KEY: '', // sin Claude: SM pierde retro, QA queda fuera
        FUSION_MODEL_URL: '', // sin Qwen: DEV queda fuera
      }),
      router,
    );
    // PO, Arquitecto y Diseño son deterministas (no necesitan Claude) → siguen activos.
    // Reviewer necesita Claude → queda fuera sin ANTHROPIC_API_KEY.
    expect(team.registered).toEqual(['SM:assign', 'SM:stale-sweep', 'PO', 'ARCHITECT', 'DESIGN']);
    expect(team.skipped).toEqual(
      expect.arrayContaining([
        { role: 'SM:retro', reason: 'sin ANTHROPIC_API_KEY' },
        { role: 'DEV', reason: 'sin FUSION_MODEL_URL / FUSION_TOKEN' },
        { role: 'QA', reason: 'sin ANTHROPIC_API_KEY' },
        { role: 'REVIEWER', reason: 'sin ANTHROPIC_API_KEY' },
      ]),
    );
  });

  it('sin tokens de rol, cada rol se omite con motivo claro', () => {
    const router = new EventRouter();
    const team = buildTeam(
      loadConfig({ AGENTS_ENABLED: '1', AGENT_PROJECT_ID: 'p1', AGENT_PROJECT_SLUG: 'axon' }),
      router,
    );
    expect(team.registered).toEqual([]);
    expect(team.skipped.map((s) => s.role)).toEqual(['SM', 'PO', 'ARCHITECT', 'DESIGN', 'DEV', 'QA', 'REVIEWER']);
  });
});
