import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ auth: vi.fn(), credFind: vi.fn(), projFind: vi.fn() }));
vi.mock('@/auth', () => ({ auth: h.auth }));
vi.mock('@/lib/db', () => ({
  prisma: {
    llmCredential: { findMany: h.credFind },
    project: { findMany: h.projFind },
  },
}));
vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: string, en: string) => en }));
vi.mock('./LlmCredentialsPanel', () => ({
  LlmCredentialsPanel: ({ credentials, projects }: { credentials: unknown[]; projects: unknown[] }) => (
    <div data-testid="panel">{`${credentials.length}-${projects.length}`}</div>
  ),
}));

import LlmCredentialsPage from './page';

beforeEach(() => vi.clearAllMocks());

describe('LlmCredentialsPage', () => {
  it('returns null when unauthenticated', async () => {
    h.auth.mockResolvedValue(null);
    expect(await LlmCredentialsPage()).toBeNull();
  });

  it('maps credential dates to ISO strings and renders the panel', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } });
    h.credFind.mockResolvedValue([
      {
        id: 'c1',
        provider: 'ANTHROPIC',
        label: 'l',
        keyPrefix: 'sk',
        modelDefault: null,
        lastUsedAt: new Date('2026-01-01'),
        createdAt: new Date('2026-01-02'),
        revokedAt: null,
        projectId: null,
      },
    ]);
    h.projFind.mockResolvedValue([{ id: 'p1', slug: 's', name: 'n' }]);
    render(await LlmCredentialsPage());
    expect(screen.getByTestId('panel')).toHaveTextContent('1-1');
    expect(screen.getByRole('heading', { name: 'LLM credentials' })).toBeInTheDocument();
  });
});
