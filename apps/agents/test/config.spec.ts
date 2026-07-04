import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('arranca deshabilitado por defecto con los defaults sanos', () => {
    const c = loadConfig({});
    expect(c.enabled).toBe(false);
    expect(c.PORT).toBe(3060);
    expect(c.AXON_API_BASE_URL).toBe('http://axon-web:3000/api/v1');
    expect(c.tokens).toEqual({ SM: undefined, DEV: undefined, QA: undefined });
  });

  it.each(['1', 'true', 'on', 'TRUE'])('AGENTS_ENABLED=%s enciende el worker', (v) => {
    expect(loadConfig({ AGENTS_ENABLED: v }).enabled).toBe(true);
  });

  it('valores no reconocidos quedan apagados', () => {
    expect(loadConfig({ AGENTS_ENABLED: 'yes' }).enabled).toBe(false);
  });

  it('normaliza strings vacíos a undefined y mapea tokens por rol', () => {
    const c = loadConfig({
      REDIS_URL: '',
      AGENT_SM_TOKEN: 'ad_pk_sm',
      AGENT_DEV_TOKEN: '',
      AGENT_QA_TOKEN: 'ad_pk_qa',
      AGENT_DESIGN_TOKEN: 'ad_pk_design',
      AGENT_REVIEWER_TOKEN: 'ad_pk_reviewer',
      PORT: '4000',
    });
    expect(c.REDIS_URL).toBeUndefined();
    expect(c.tokens).toEqual({ SM: 'ad_pk_sm', DEV: undefined, QA: 'ad_pk_qa', DESIGN: 'ad_pk_design', REVIEWER: 'ad_pk_reviewer' });
    expect(c.PORT).toBe(4000);
  });

  it('rechaza configuración inválida con mensaje accionable', () => {
    expect(() => loadConfig({ REDIS_URL: 'no-es-url' })).toThrow(/REDIS_URL/);
  });

  it('DEV_MAX_ITERATIONS por defecto 40, configurable dentro de [4, 200]', () => {
    expect(loadConfig({}).DEV_MAX_ITERATIONS).toBe(40);
    expect(loadConfig({ DEV_MAX_ITERATIONS: '80' }).DEV_MAX_ITERATIONS).toBe(80);
    expect(loadConfig({ DEV_MAX_ITERATIONS: '' }).DEV_MAX_ITERATIONS).toBe(40);
  });

  it('rechaza DEV_MAX_ITERATIONS fuera de rango', () => {
    expect(() => loadConfig({ DEV_MAX_ITERATIONS: '3' })).toThrow(/DEV_MAX_ITERATIONS/);
    expect(() => loadConfig({ DEV_MAX_ITERATIONS: '500' })).toThrow(/DEV_MAX_ITERATIONS/);
  });

  it('AGENT_MAX_DURATION_MS por defecto 20min, configurable dentro de [60_000, 3_600_000]', () => {
    expect(loadConfig({}).AGENT_MAX_DURATION_MS).toBe(1_200_000);
    expect(loadConfig({ AGENT_MAX_DURATION_MS: '600000' }).AGENT_MAX_DURATION_MS).toBe(600_000);
    expect(loadConfig({ AGENT_MAX_DURATION_MS: '' }).AGENT_MAX_DURATION_MS).toBe(1_200_000);
  });

  it('rechaza AGENT_MAX_DURATION_MS fuera de rango', () => {
    expect(() => loadConfig({ AGENT_MAX_DURATION_MS: '1000' })).toThrow(/AGENT_MAX_DURATION_MS/);
    expect(() => loadConfig({ AGENT_MAX_DURATION_MS: '99999999' })).toThrow(/AGENT_MAX_DURATION_MS/);
  });
});
