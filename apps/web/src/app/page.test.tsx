import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: string, en: string) => en }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => <div data-testid="theme" /> }));
vi.mock('@/components/LocaleSwitcher', () => ({ LocaleSwitcher: () => <div data-testid="locale" /> }));

import HomePage from './page';

describe('HomePage', () => {
  it('renders the hero, CTAs and the three pillars', async () => {
    render(await HomePage());
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in with SSO' })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('link', { name: 'Create account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Forgot your password/i })).not.toBeInTheDocument();
    expect(screen.getByText('Kanban tasks')).toBeInTheDocument();
    expect(screen.getByText('Zero-knowledge vault')).toBeInTheDocument();
    expect(screen.getByText('Brain + MCP')).toBeInTheDocument();
    expect(screen.getByTestId('theme')).toBeInTheDocument();
    expect(screen.getByTestId('locale')).toBeInTheDocument();
  });
});
