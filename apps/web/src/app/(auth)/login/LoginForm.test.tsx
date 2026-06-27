import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  login: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  params: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push, refresh: h.refresh }),
  useSearchParams: () => h.params,
}));
vi.mock('@/lib/actions/auth', () => ({ loginAction: h.login }));

import { LoginForm } from './LoginForm';

beforeEach(() => {
  vi.clearAllMocks();
  h.params = new URLSearchParams();
});

describe('LoginForm', () => {
  it('logs in successfully and navigates to the default callback', async () => {
    h.login.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    const { container } = render(<LoginForm />);
    await user.type(container.querySelector('input[type=email]')!, 'a@b.com');
    await user.type(container.querySelector('input[type=password]')!, 'password1234');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(h.login).toHaveBeenCalledWith('a@b.com', 'password1234', undefined));
    expect(h.push).toHaveBeenCalledWith('/projects');
    expect(h.refresh).toHaveBeenCalled();
  });

  it('honours the callbackUrl query param', async () => {
    h.params = new URLSearchParams('callbackUrl=/dashboard');
    h.login.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    const { container } = render(<LoginForm />);
    await user.type(container.querySelector('input[type=email]')!, 'a@b.com');
    await user.type(container.querySelector('input[type=password]')!, 'password1234');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/dashboard'));
  });

  it('reveals the TOTP field when 2FA is required', async () => {
    h.login.mockResolvedValue({ ok: false, error: 'TOTP_REQUIRED' });
    const user = userEvent.setup();
    const { container } = render(<LoginForm />);
    await user.type(container.querySelector('input[type=email]')!, 'a@b.com');
    await user.type(container.querySelector('input[type=password]')!, 'password1234');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/Enter the code from your authenticator app/)).toBeInTheDocument();
    // Second submit includes the TOTP code.
    h.login.mockResolvedValue({ ok: true });
    await user.type(container.querySelector('input[inputmode="numeric"]')!, '12ab3456');
    await user.click(screen.getByRole('button', { name: 'Verify 2FA' }));
    await waitFor(() => expect(h.login).toHaveBeenLastCalledWith('a@b.com', 'password1234', '123456'));
  });

  it('shows invalid-credentials on a generic failure', async () => {
    h.login.mockResolvedValue({ ok: false, error: 'NOPE' });
    const user = userEvent.setup();
    const { container } = render(<LoginForm />);
    await user.type(container.querySelector('input[type=email]')!, 'a@b.com');
    await user.type(container.querySelector('input[type=password]')!, 'password1234');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
  });
});
