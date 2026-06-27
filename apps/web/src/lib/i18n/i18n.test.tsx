import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const btn = (name: string) => screen.getByRole('button', { name });
import { I18nProvider, useI18n } from './i18n';
import { LANG_KEY } from './lang';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

function Consumer() {
  const { lang, setLang, t, fmtDate, fmtDateTime, fmtNumber } = useI18n();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="t">{t('hola', 'hi')}</span>
      <span data-testid="num">{fmtNumber(1234.5)}</span>
      <span data-testid="date">{fmtDate('2026-01-15T00:00:00Z')}</span>
      <span data-testid="datetime">{fmtDateTime('2026-01-15T10:00:00Z')}</span>
      <button onClick={() => setLang('es')}>es</button>
      <button onClick={() => setLang('en')}>en</button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  router.refresh.mockClear();
  document.documentElement.lang = '';
});

describe('I18nProvider + useI18n', () => {
  it('starts in english and renders english strings', () => {
    render(
      <I18nProvider>
        <Consumer />
      </I18nProvider>,
    );
    expect(screen.getByTestId('lang').textContent).toBe('en');
    expect(screen.getByTestId('t').textContent).toBe('hi');
    expect(document.documentElement.lang).toBe('en');
  });

  it('hydrates the saved language from localStorage', () => {
    window.localStorage.setItem(LANG_KEY, 'es');
    render(
      <I18nProvider>
        <Consumer />
      </I18nProvider>,
    );
    expect(screen.getByTestId('lang').textContent).toBe('es');
    expect(screen.getByTestId('t').textContent).toBe('hola');
  });

  it('switches language, persists it and refreshes the router', () => {
    render(
      <I18nProvider>
        <Consumer />
      </I18nProvider>,
    );
    act(() => {
      fireEvent.click(btn('es'));
    });
    expect(screen.getByTestId('lang').textContent).toBe('es');
    expect(window.localStorage.getItem(LANG_KEY)).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when setting the language to the current one', () => {
    render(
      <I18nProvider>
        <Consumer />
      </I18nProvider>,
    );
    act(() => {
      fireEvent.click(btn('en')); // already en
    });
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('formats numbers and dates with the active locale', () => {
    render(
      <I18nProvider>
        <Consumer />
      </I18nProvider>,
    );
    expect(screen.getByTestId('num').textContent).toBe((1234.5).toLocaleString('en-US'));
    expect(screen.getByTestId('date').textContent).toBe(
      new Date('2026-01-15T00:00:00Z').toLocaleDateString('en-US'),
    );
    expect(screen.getByTestId('datetime').textContent).toBe(
      new Date('2026-01-15T10:00:00Z').toLocaleString('en-US'),
    );
  });

  it('default context (no provider) renders english and is inert', () => {
    render(<Consumer />);
    expect(screen.getByTestId('lang').textContent).toBe('en');
    expect(screen.getByTestId('t').textContent).toBe('hi');
    // setLang from default context is a no-op and must not throw
    act(() => {
      fireEvent.click(btn('es'));
    });
    expect(screen.getByTestId('lang').textContent).toBe('en');
  });
});
