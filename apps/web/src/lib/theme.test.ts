import { describe, expect, it } from 'vitest';
import { THEME_COOKIE, type Theme } from './theme';

describe('theme', () => {
  it('exposes the theme cookie name', () => {
    expect(THEME_COOKIE).toBe('theme');
  });

  it('accepts the two theme values', () => {
    const light: Theme = 'light';
    const dark: Theme = 'dark';
    expect([light, dark]).toEqual(['light', 'dark']);
  });
});
