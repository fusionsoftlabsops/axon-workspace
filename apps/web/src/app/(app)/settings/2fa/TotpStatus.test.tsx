import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ disable: vi.fn() }));
vi.mock('@/lib/actions/totp', () => ({ disableTotp: h.disable }));

import { TotpStatus } from './TotpStatus';

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: vi.fn() },
  });
});

describe('TotpStatus', () => {
  it('shows the active state and reveals the disable form on click', async () => {
    const user = userEvent.setup();
    render(<TotpStatus />);
    expect(screen.getByText('✓ 2FA active')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Disable 2FA' }));
    expect(screen.getByPlaceholderText('Current code')).toBeInTheDocument();
  });

  it('cancels back out of the disable form', async () => {
    const user = userEvent.setup();
    render(<TotpStatus />);
    await user.click(screen.getByRole('button', { name: 'Disable 2FA' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByPlaceholderText('Current code')).not.toBeInTheDocument();
  });

  it('reloads on a successful disable', async () => {
    h.disable.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<TotpStatus />);
    await user.click(screen.getByRole('button', { name: 'Disable 2FA' }));
    await user.type(screen.getByPlaceholderText('Current code'), '12ab3456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(h.disable).toHaveBeenCalledWith('123456'));
    await waitFor(() => expect(window.location.reload).toHaveBeenCalled());
  });

  it('shows the error when disable fails', async () => {
    h.disable.mockResolvedValue({ ok: false, error: 'nope' });
    const user = userEvent.setup();
    render(<TotpStatus />);
    await user.click(screen.getByRole('button', { name: 'Disable 2FA' }));
    await user.type(screen.getByPlaceholderText('Current code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('nope')).toBeInTheDocument();
    expect(window.location.reload).not.toHaveBeenCalled();
  });
});
