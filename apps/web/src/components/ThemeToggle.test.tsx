import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/i18n/i18n', () => ({
  useI18n: () => ({ t: (_es: unknown, en: unknown) => en }),
}));

import { ThemeToggle } from './ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.cookie = '';
  });
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to light and shows the dark-mode affordance', () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn).toHaveAttribute('aria-label', 'Switch to dark mode');
    expect(btn).toHaveTextContent('☾');
  });

  it('reads the dark theme set on <html> by the server', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    render(<ThemeToggle />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveAttribute('aria-label', 'Switch to light mode');
    expect(btn).toHaveTextContent('☀');
  });

  it('toggles theme, writes the html attribute and a cookie', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole('button'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.cookie).toContain('dark');
    // toggle back to light
    await user.click(screen.getByRole('button'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
