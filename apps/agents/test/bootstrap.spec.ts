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
  AGENT_DEV_TOKEN: 'ad_pk_dev',
  AGENT_QA_TOKEN: 'ad_pk_qa',
  FUSION_MODEL_URL: 'https://modelo.local/v1',
  FUSION_TOKEN: 'fsn_x',
  ANTHROPIC_API_KEY: 'sk-ant-x',
  GITHUB_TOKEN: 'ghp_x',
};

describe('buildTeam', () => {
  it('con config completa registra los handlers/sweep del equipo (incl. PO)', () => {
    const router = new EventRouter();
    const team = buildTeam(loadConfig(FULL_ENV), router);
    expect(team.registered).toEqual(['SM:assign', 'SM:retro', 'SM:stale-sweep', 'PO', 'DEV', 'QA']);
    expect(team.skipped).toEqual([]);
    expect(router.size).toBe(5); // assign + retro + po + dev + qa (el sweep no es handler de eventos)
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
    // El PO es determinista (no necesita Claude) → sigue activo.
    expect(team.registered).toEqual(['SM:assign', 'SM:stale-sweep', 'PO']);
    expect(team.skipped).toEqual(
      expect.arrayContaining([
        { role: 'SM:retro', reason: 'sin ANTHROPIC_API_KEY' },
        { role: 'DEV', reason: 'sin FUSION_MODEL_URL / FUSION_TOKEN' },
        { role: 'QA', reason: 'sin ANTHROPIC_API_KEY' },
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
    expect(team.skipped.map((s) => s.role)).toEqual(['SM', 'PO', 'DEV', 'QA']);
  });
});
