import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnlockPrompt } from './UnlockPrompt';

const { unlock } = vi.hoisted(() => ({ unlock: vi.fn() }));
vi.mock('@/components/vault/UnlockContext', () => ({
  useVaultUnlock: () => ({ vault: null, unlock, lock: vi.fn() }),
}));

beforeEach(() => vi.clearAllMocks());

describe('UnlockPrompt', () => {
  it('submits passphrase and calls unlock', async () => {
    const user = userEvent.setup();
    unlock.mockResolvedValue({ ok: true });
    render(<UnlockPrompt />);
    const input = screen.getByLabelText('Vault passphrase');
    await user.type(input, 'secret');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(unlock).toHaveBeenCalledWith('secret'));
  });

  it('shows error and clears passphrase on failed unlock', async () => {
    const user = userEvent.setup();
    unlock.mockResolvedValue({ ok: false, error: 'bad pass' });
    render(<UnlockPrompt />);
    const input = screen.getByLabelText('Vault passphrase') as HTMLInputElement;
    await user.type(input, 'wrong');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('bad pass')).toBeInTheDocument();
    await waitFor(() => expect(input.value).toBe(''));
  });
});
