import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock('@/auth', () => ({ auth: h.auth }));
vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique: h.findUnique } } }));
vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: string, en: string) => en }));
vi.mock('next/navigation', () => ({ redirect: h.redirect }));
vi.mock('./TotpEnrollment', () => ({
  TotpEnrollment: ({ email }: { email: string }) => <div data-testid="enroll">{email}</div>,
}));
vi.mock('./TotpStatus', () => ({ TotpStatus: () => <div data-testid="status" /> }));

import TwoFactorPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TwoFactorPage', () => {
  it('redirects to /login when there is no session', async () => {
    h.auth.mockResolvedValue(null);
    await expect(TwoFactorPage()).rejects.toThrow('REDIRECT:/login');
    expect(h.redirect).toHaveBeenCalledWith('/login');
  });

  it('renders TotpStatus when the user is already enrolled', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', email: 'a@b.com' } });
    h.findUnique.mockResolvedValue({ totpSecretEncrypted: Buffer.from('x') });
    render(await TwoFactorPage());
    expect(screen.getByTestId('status')).toBeInTheDocument();
    expect(screen.queryByTestId('enroll')).not.toBeInTheDocument();
  });

  it('renders TotpEnrollment with the email when not enrolled', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', email: 'a@b.com' } });
    h.findUnique.mockResolvedValue({ totpSecretEncrypted: null });
    render(await TwoFactorPage());
    expect(screen.getByTestId('enroll')).toHaveTextContent('a@b.com');
  });

  it('passes an empty email when the session email is missing', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } });
    h.findUnique.mockResolvedValue(null);
    const { container } = render(await TwoFactorPage());
    expect(container.querySelector('[data-testid="enroll"]')).toBeInTheDocument();
  });
});
