import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: string, en: string) => en }));

import Playground from './page';

describe('Playground', () => {
  it('renders the design-system reference page', async () => {
    render(await Playground());
    expect(screen.getByText('The Notebook')).toBeInTheDocument();
    expect(screen.getByText('Idempotency in webhooks')).toBeInTheDocument();
    // A sampling of the primitive sections.
    expect(screen.getByRole('heading', { name: 'Small signals before the headline' })).toBeInTheDocument();
    expect(screen.getByText('payments')).toBeInTheDocument();
  });
});
