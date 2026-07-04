import { describe, it, expect } from 'vitest';
import { TEAM_PRESETS, PRESET_IDS, isTeamPreset } from './presets';

describe('TEAM_PRESETS', () => {
  it('define los 3 presets con los 9 roles cada uno', () => {
    expect(PRESET_IDS).toEqual(['ECO', 'BALANCED', 'MAX']);
    for (const id of PRESET_IDS) {
      expect(Object.keys(TEAM_PRESETS[id].roles)).toHaveLength(9);
      expect(TEAM_PRESETS[id].examples.length).toBeGreaterThanOrEqual(5);
    }
  });
  it('ECO apaga Arquitecto/Reviewer/Release y usa qwen para el Dev', () => {
    const eco = TEAM_PRESETS.ECO.roles;
    expect(eco.ARCHITECT.enabled).toBe(false);
    expect(eco.REVIEWER.enabled).toBe(false);
    expect(eco.RELEASE.enabled).toBe(false);
    expect(eco.DEV.llmModel).toBe('qwen3-coder-next');
  });
  it('MAX enciende los 9 con los modelos tope (fable en Arquitecto, opus en QA)', () => {
    const max = TEAM_PRESETS.MAX.roles;
    expect(Object.values(max).every((r) => r.enabled)).toBe(true);
    expect(max.ARCHITECT.llmModel).toBe('claude-fable-5');
    expect(max.QA.llmModel).toBe('claude-opus-4-8');
    expect(max.DEV.llmModel).toBe('claude-sonnet-5');
    expect(max.DEV.tokenBudget).toBe(1_000_000);
  });
  it('isTeamPreset valida', () => {
    expect(isTeamPreset('ECO')).toBe(true);
    expect(isTeamPreset('NOPE')).toBe(false);
  });
});
