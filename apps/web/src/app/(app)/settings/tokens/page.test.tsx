import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ auth: vi.fn(), tokFind: vi.fn(), projFind: vi.fn() }));
vi.mock('@/auth', () => ({ auth: h.auth }));
vi.mock('@/lib/db', () => ({
  prisma: { apiToken: { findMany: h.tokFind }, project: { findMany: h.projFind } },
}));
vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: string, en: string) => en }));
vi.mock('./TokensPanel', () => ({
  TokensPanel: ({ tokens, availableProjects }: { tokens: unknown[]; availableProjects: unknown[] }) => (
    <div data-testid="panel">{`${tokens.length}-${availableProjects.length}`}</div>
  ),
}));

import TokensPage from './page';

beforeEach(() => vi.clearAllMocks());

describe('TokensPage', () => {
  it('returns null when unauthenticated', async () => {
    h.auth.mockResolvedValue(null);
    expect(await TokensPage()).toBeNull();
  });

  it('serialises token dates and renders the panel', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } });
    h.tokFind.mockResolvedValue([
      {
        id: 't1',
        name: 'n',
        prefix: 'p',
        scopes: [],
        projectSlugs: [],
        lastUsedAt: new Date('2026-01-01'),
        expiresAt: new Date('2026-02-01'),
        createdAt: new Date('2026-01-02'),
      },
      {
        id: 't2',
        name: 'n2',
        prefix: 'p2',
        scopes: [],
        projectSlugs: [],
        lastUsedAt: null,
        expiresAt: null,
        createdAt: new Date('2026-01-03'),
      },
    ]);
    h.projFind.mockResolvedValue([{ slug: 's', name: 'n' }]);
    render(await TokensPage());
    expect(screen.getByTestId('panel')).toHaveTextContent('2-1');
    expect(screen.getByRole('heading', { name: 'API tokens' })).toBeInTheDocument();
  });
});
