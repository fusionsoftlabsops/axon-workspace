import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ setLang: vi.fn(), lang: 'en' as 'en' | 'es' }));
vi.mock('@/lib/i18n/i18n', () => ({
  useI18n: () => ({ lang: h.lang, setLang: h.setLang, t: (_es: unknown, en: unknown) => en }),
}));

import { LocaleSwitcher } from './LocaleSwitcher';

describe('LocaleSwitcher', () => {
  beforeEach(() => {
    h.setLang.mockClear();
    h.lang = 'en';
  });

  it('renders both languages and marks the active one as pressed', () => {
    render(<LocaleSwitcher />);
    const en = screen.getByRole('button', { name: 'en' });
    const es = screen.getByRole('button', { name: 'es' });
    expect(en).toHaveAttribute('aria-pressed', 'true');
    expect(es).toHaveAttribute('aria-pressed', 'false');
    // separator dot present between the two
    expect(screen.getByRole('group')).toHaveTextContent('·');
  });

  it('marks es as active when lang is es', () => {
    h.lang = 'es';
    render(<LocaleSwitcher />);
    expect(screen.getByRole('button', { name: 'es' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls setLang when a language button is clicked', async () => {
    const user = userEvent.setup();
    render(<LocaleSwitcher />);
    await user.click(screen.getByRole('button', { name: 'es' }));
    expect(h.setLang).toHaveBeenCalledWith('es');
  });
});
