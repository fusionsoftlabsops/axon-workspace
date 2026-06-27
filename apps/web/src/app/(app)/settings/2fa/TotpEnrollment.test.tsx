import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  begin: vi.fn(),
  confirm: vi.fn(),
  toDataURL: vi.fn(),
}));

vi.mock('qrcode', () => ({ default: { toDataURL: h.toDataURL } }));
vi.mock('@/lib/actions/totp', () => ({
  beginTotpEnrollment: h.begin,
  confirmTotpEnrollment: h.confirm,
}));

import { TotpEnrollment } from './TotpEnrollment';

beforeEach(() => {
  vi.clearAllMocks();
  h.begin.mockResolvedValue({ secret: 'SECRET123', otpauthUri: 'otpauth://x' });
  h.toDataURL.mockResolvedValue('data:image/png;base64,zzz');
});

describe('TotpEnrollment', () => {
  it('auto-starts enrollment and renders the QR + manual secret', async () => {
    render(<TotpEnrollment email="a@b.com" />);
    await waitFor(() => expect(h.begin).toHaveBeenCalled());
    const img = await screen.findByAltText('TOTP setup QR code');
    expect(img).toHaveAttribute('src', 'data:image/png;base64,zzz');
    expect(screen.getByText('SECRET123')).toBeInTheDocument();
    expect(screen.getByText('a@b.com')).toBeInTheDocument();
  });

  it('shows an error when enrollment start fails', async () => {
    h.begin.mockRejectedValue(new Error('boom'));
    render(<TotpEnrollment email="a@b.com" />);
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.getByText('Generating QR…')).toBeInTheDocument();
  });

  it('confirms enrollment with a valid code and shows success', async () => {
    h.confirm.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<TotpEnrollment email="a@b.com" />);
    await screen.findByAltText('TOTP setup QR code');
    await user.type(screen.getByPlaceholderText('6-digit code'), '12a34b56');
    await user.click(screen.getByRole('button', { name: 'Enable 2FA' }));
    await waitFor(() => expect(h.confirm).toHaveBeenCalledWith('SECRET123', '123456'));
    expect(await screen.findByText(/2FA enabled/)).toBeInTheDocument();
  });

  it('shows the error returned by confirm', async () => {
    h.confirm.mockResolvedValue({ ok: false, error: 'bad code' });
    const user = userEvent.setup();
    render(<TotpEnrollment email="a@b.com" />);
    await screen.findByAltText('TOTP setup QR code');
    await user.type(screen.getByPlaceholderText('6-digit code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Enable 2FA' }));
    expect(await screen.findByText('bad code')).toBeInTheDocument();
  });
});
