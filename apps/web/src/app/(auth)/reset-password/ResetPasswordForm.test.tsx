import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ reset: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('@/lib/actions/password-reset', () => ({ resetPasswordAction: h.reset }));

import { ResetPasswordForm } from './ResetPasswordForm';

function passwordInputs() {
  return Array.from(document.querySelectorAll('input[type=password]')) as HTMLInputElement[];
}

beforeEach(() => {
  vi.clearAllMocks();
  h.reset.mockResolvedValue({ ok: true });
});

describe('ResetPasswordForm', () => {
  it('rejects a short password without calling the action', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm token="t1" />);
    const [pw, confirm] = passwordInputs();
    await user.type(pw, 'short');
    await user.type(confirm, 'short');
    await user.click(screen.getByRole('button', { name: /Change password/i }));
    expect(await screen.findByText(/at least 12 characters/i)).toBeInTheDocument();
    expect(h.reset).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm token="t1" />);
    const [pw, confirm] = passwordInputs();
    await user.type(pw, 'a-good-password-1');
    await user.type(confirm, 'a-good-password-2');
    await user.click(screen.getByRole('button', { name: /Change password/i }));
    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(h.reset).not.toHaveBeenCalled();
  });

  it('submits and redirects on success', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm token="t1" />);
    const [pw, confirm] = passwordInputs();
    await user.type(pw, 'a-good-password-1');
    await user.type(confirm, 'a-good-password-1');
    await user.click(screen.getByRole('button', { name: /Change password/i }));
    expect(h.reset).toHaveBeenCalledWith({ token: 't1', password: 'a-good-password-1' });
    expect(h.push).toHaveBeenCalledWith('/login?reset=1');
  });

  it('surfaces a server error', async () => {
    const user = userEvent.setup();
    h.reset.mockResolvedValue({ ok: false, error: 'Enlace inválido o expirado. Solicitá uno nuevo.' });
    render(<ResetPasswordForm token="t1" />);
    const [pw, confirm] = passwordInputs();
    await user.type(pw, 'a-good-password-1');
    await user.type(confirm, 'a-good-password-1');
    await user.click(screen.getByRole('button', { name: /Change password/i }));
    expect(await screen.findByText(/Enlace inválido/i)).toBeInTheDocument();
  });
});
