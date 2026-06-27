import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ getInvite: vi.fn() }));
vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: string, en: string) => en }));
vi.mock('@/lib/actions/invitations', () => ({ getInvitationByToken: h.getInvite }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('./SignupForm', () => ({
  SignupForm: ({ token, invitedEmail }: { token: string; invitedEmail: string }) => (
    <div data-testid="signup-form">{`${token}|${invitedEmail}`}</div>
  ),
}));

import SignupPage from './page';

beforeEach(() => vi.clearAllMocks());

describe('SignupPage', () => {
  it('shows the invite-only notice when no token is present', async () => {
    render(await SignupPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('heading', { name: 'Invite-only signup' })).toBeInTheDocument();
    expect(screen.queryByTestId('signup-form')).not.toBeInTheDocument();
    expect(h.getInvite).not.toHaveBeenCalled();
  });

  it('shows the invitation error when the token is invalid', async () => {
    h.getInvite.mockResolvedValue({ ok: false, error: 'The invitation expired' });
    render(await SignupPage({ searchParams: Promise.resolve({ token: 'bad' }) }));
    expect(screen.getByRole('heading', { name: 'Invite-only signup' })).toBeInTheDocument();
    expect(screen.getByText('The invitation expired')).toBeInTheDocument();
  });

  it('renders the signup form for a valid invitation', async () => {
    h.getInvite.mockResolvedValue({ ok: true, email: 'new@x.com' });
    render(await SignupPage({ searchParams: Promise.resolve({ token: 'good' }) }));
    expect(screen.getByRole('heading', { name: 'Create account' })).toBeInTheDocument();
    expect(screen.getByTestId('signup-form')).toHaveTextContent('good|new@x.com');
  });
});
