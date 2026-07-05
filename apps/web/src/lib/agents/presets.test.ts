import { describe, it, expect } from 'vitest';
import {
  TEAM_PRESETS,
  PRESET_IDS,
  isTeamPreset,
  PRESET_RANK,
  presetMeetsFloor,
  presetBudget,
} from './presets';

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

describe('anti-downgrade (presetMeetsFloor)', () => {
  it('rank ECO < BALANCED < MAX', () => {
    expect(PRESET_RANK.ECO).toBeLessThan(PRESET_RANK.BALANCED);
    expect(PRESET_RANK.BALANCED).toBeLessThan(PRESET_RANK.MAX);
  });
  it('sin floor, cualquier preset vale', () => {
    expect(presetMeetsFloor('ECO', null)).toBe(true);
    expect(presetMeetsFloor('ECO', undefined)).toBe(true);
    expect(presetMeetsFloor('ECO', 'NOPE')).toBe(true);
  });
  it('con floor BALANCED: ECO no, BALANCED sí, MAX sí', () => {
    expect(presetMeetsFloor('ECO', 'BALANCED')).toBe(false);
    expect(presetMeetsFloor('BALANCED', 'BALANCED')).toBe(true);
    expect(presetMeetsFloor('MAX', 'BALANCED')).toBe(true);
  });
});

describe('presetBudget', () => {
  it('resume Dev + total + agentes habilitados por preset', () => {
    const eco = presetBudget('ECO');
    expect(eco.dev).toBe(200_000);
    expect(eco.agents).toBe(6); // ECO apaga Arquitecto/Reviewer/Release
    const max = presetBudget('MAX');
    expect(max.dev).toBe(1_000_000);
    expect(max.agents).toBe(9);
    expect(max.totalEnabled).toBeGreaterThan(eco.totalEnabled);
  });
});
