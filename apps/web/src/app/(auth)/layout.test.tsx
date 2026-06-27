import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: string, en: string) => en }));
vi.mock('@/components/LocaleSwitcher', () => ({ LocaleSwitcher: () => <div data-testid="locale" /> }));

import AuthLayout from './layout';

describe('AuthLayout', () => {
  it('renders the brand, cover copy, locale switcher and children', async () => {
    render(await AuthLayout({ children: <main data-testid="child">content</main> }));
    expect(screen.getByText('Axon')).toBeInTheDocument();
    expect(screen.getByText(/A technical logbook for devs/)).toBeInTheDocument();
    expect(screen.getByTestId('locale')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toHaveTextContent('content');
  });
});
