import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLang, tr, localeFor, persistLang, LANG_KEY, LANG_COOKIE } from './lang';

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getLang', () => {
  it('returns the saved language when valid', () => {
    window.localStorage.setItem(LANG_KEY, 'es');
    expect(getLang()).toBe('es');
    window.localStorage.setItem(LANG_KEY, 'en');
    expect(getLang()).toBe('en');
  });

  it('defaults to en when nothing is saved or value is invalid', () => {
    expect(getLang()).toBe('en');
    window.localStorage.setItem(LANG_KEY, 'fr');
    expect(getLang()).toBe('en');
  });

  it('defaults to en when localStorage throws', () => {
    vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getLang()).toBe('en');
  });
});

describe('tr', () => {
  it('selects the spanish value when lang is es', () => {
    window.localStorage.setItem(LANG_KEY, 'es');
    expect(tr('hola', 'hi')).toBe('hola');
  });
  it('selects the english value otherwise', () => {
    expect(tr('hola', 'hi')).toBe('hi');
  });
});

describe('localeFor', () => {
  it('maps lang codes to BCP-47 tags', () => {
    expect(localeFor('es')).toBe('es-ES');
    expect(localeFor('en')).toBe('en-US');
  });
});

describe('persistLang', () => {
  it('writes localStorage and a cookie', () => {
    persistLang('es');
    expect(window.localStorage.getItem(LANG_KEY)).toBe('es');
    expect(document.cookie).toContain(`${LANG_COOKIE}=es`);
  });

  it('swallows localStorage and cookie write errors', () => {
    vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const cookieSpy = vi
      .spyOn(document, 'cookie', 'set')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    expect(() => persistLang('en')).not.toThrow();
    cookieSpy.mockRestore();
  });
});
