import { beforeEach, describe, expect, it, vi } from 'vitest';

const headers = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: headers.get })),
}));

import { getServerLang, getServerT } from './server';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getServerLang', () => {
  it('returns es when the cookie is es', async () => {
    headers.get.mockReturnValue({ value: 'es' });
    expect(await getServerLang()).toBe('es');
  });

  it('returns en when the cookie is en, other, or absent', async () => {
    headers.get.mockReturnValue({ value: 'en' });
    expect(await getServerLang()).toBe('en');
    headers.get.mockReturnValue({ value: 'fr' });
    expect(await getServerLang()).toBe('en');
    headers.get.mockReturnValue(undefined);
    expect(await getServerLang()).toBe('en');
  });
});

describe('getServerT', () => {
  it('binds t() to the cookie language', async () => {
    headers.get.mockReturnValue({ value: 'es' });
    const t = await getServerT();
    expect(t('hola', 'hi')).toBe('hola');

    headers.get.mockReturnValue({ value: 'en' });
    const tEn = await getServerT();
    expect(tEn('hola', 'hi')).toBe('hi');
  });
});
