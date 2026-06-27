import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  redirect: vi.fn((p: string) => {
    throw new Error(`REDIRECT:${p}`);
  }),
}));

vi.mock('@/auth', () => ({ auth: h.auth }));
vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique: h.findUnique } } }));
vi.mock('next/navigation', () => ({ redirect: h.redirect }));
vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: string, en: string) => en }));
vi.mock('./RecoveryPanel', () => ({
  RecoveryPanel: ({ hasRecovery }: { hasRecovery: boolean }) => (
    <div data-testid="panel">{String(hasRecovery)}</div>
  ),
}));

import RecoveryPage from './page';

beforeEach(() => vi.clearAllMocks());

describe('RecoveryPage', () => {
  it('redirects to /login when unauthenticated', async () => {
    h.auth.mockResolvedValue(null);
    await expect(RecoveryPage()).rejects.toThrow('REDIRECT:/login');
  });

  it('passes hasRecovery=true when recovery material exists', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } });
    h.findUnique.mockResolvedValue({ encryptedPrivKeyRecovery: Buffer.from('x') });
    render(await RecoveryPage());
    expect(screen.getByTestId('panel')).toHaveTextContent('true');
  });

  it('passes hasRecovery=false when no recovery material', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } });
    h.findUnique.mockResolvedValue(null);
    render(await RecoveryPage());
    expect(screen.getByTestId('panel')).toHaveTextContent('false');
  });
});
