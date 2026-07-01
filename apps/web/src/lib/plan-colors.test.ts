import { describe, it, expect } from 'vitest';
import { CHAT_PALETTE, defaultColorFor, effectiveColor, contrastText, HEX_COLOR } from './plan-colors';

const members = [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }];

describe('defaultColorFor', () => {
  it('assigns a stable color by member position', () => {
    expect(defaultColorFor('a', members)).toBe(CHAT_PALETTE[0]);
    expect(defaultColorFor('b', members)).toBe(CHAT_PALETTE[1]);
    expect(defaultColorFor('c', members)).toBe(CHAT_PALETTE[2]);
    // Stable across calls.
    expect(defaultColorFor('b', members)).toBe(defaultColorFor('b', members));
  });

  it('falls back to a deterministic hash for unknown users', () => {
    const c = defaultColorFor('zzz', members);
    expect(CHAT_PALETTE).toContain(c);
    expect(defaultColorFor('zzz', members)).toBe(c);
  });
});

describe('effectiveColor', () => {
  it('prefers an explicit override', () => {
    expect(effectiveColor('a', { a: '#123456' }, members)).toBe('#123456');
  });
  it('uses the default when no override', () => {
    expect(effectiveColor('a', {}, members)).toBe(CHAT_PALETTE[0]);
  });
});

describe('contrastText', () => {
  it('returns dark text on light backgrounds', () => {
    expect(contrastText('#ffffff')).toBe('#111111');
    expect(contrastText('#eab308')).toBe('#111111');
  });
  it('returns light text on dark backgrounds', () => {
    expect(contrastText('#000000')).toBe('#ffffff');
    expect(contrastText('#3b82f6')).toBe('#ffffff');
  });
  it('is safe for malformed input', () => {
    expect(contrastText('nope')).toBe('#ffffff');
  });
});

describe('HEX_COLOR', () => {
  it('accepts 6-digit hex and rejects the rest', () => {
    expect(HEX_COLOR.test('#aabbcc')).toBe(true);
    expect(HEX_COLOR.test('#ABC')).toBe(false);
    expect(HEX_COLOR.test('red')).toBe(false);
  });
});
