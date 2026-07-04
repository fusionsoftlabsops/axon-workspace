import { describe, it, expect } from 'vitest';
import { normalizePriority, priorityMeta, PRIORITY_META } from './priority';

describe('normalizePriority', () => {
  it('returns the matching level for valid uppercase values', () => {
    expect(normalizePriority('LOW')).toBe('LOW');
    expect(normalizePriority('MEDIUM')).toBe('MEDIUM');
    expect(normalizePriority('HIGH')).toBe('HIGH');
    expect(normalizePriority('URGENT')).toBe('URGENT');
  });

  it('is case-insensitive', () => {
    expect(normalizePriority('low')).toBe('LOW');
    expect(normalizePriority('High')).toBe('HIGH');
  });

  it('falls back to MEDIUM for missing or unknown values', () => {
    expect(normalizePriority(null)).toBe('MEDIUM');
    expect(normalizePriority(undefined)).toBe('MEDIUM');
    expect(normalizePriority('')).toBe('MEDIUM');
    expect(normalizePriority('foo')).toBe('MEDIUM');
  });
});

describe('priorityMeta', () => {
  it('returns color, icon, label and order for each level', () => {
    expect(priorityMeta('LOW')).toEqual(PRIORITY_META.LOW);
    expect(priorityMeta('MEDIUM')).toEqual(PRIORITY_META.MEDIUM);
    expect(priorityMeta('HIGH')).toEqual(PRIORITY_META.HIGH);
    expect(priorityMeta('URGENT')).toEqual(PRIORITY_META.URGENT);
  });

  it('falls back to MEDIUM meta for unknown values', () => {
    expect(priorityMeta('bogus')).toEqual(PRIORITY_META.MEDIUM);
  });

  it('has a distinct color per level', () => {
    const colors = Object.values(PRIORITY_META).map((m) => m.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('has a distinct icon per level', () => {
    const icons = Object.values(PRIORITY_META).map((m) => m.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});
