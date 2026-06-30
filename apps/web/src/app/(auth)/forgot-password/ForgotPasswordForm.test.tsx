import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ children, href }: any) => <a href={href}>{children}</a> }));
vi.mock('@/lib/actions/password-reset', () => ({ requestPasswordResetAction: h.request }));

import { ForgotPasswordForm } from './ForgotPasswordForm';

beforeEach(() => {
  vi.clearAllMocks();
  h.request.mockResolvedValue({ ok: true });
});

describe('ForgotPasswordForm', () => {
  it('submits the email and shows the uniform confirmation', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);
    await user.type(screen.getByRole('textbox'), 'me@x.com');
    await user.click(screen.getByRole('button', { name: /Send link/i }));
    expect(h.request).toHaveBeenCalledWith({ email: 'me@x.com' });
    expect(await screen.findByText(/we sent a reset link/i)).toBeInTheDocument();
  });
});
