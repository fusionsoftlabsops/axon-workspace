import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ setLogin: vi.fn() }));
vi.mock('@/lib/actions/me', () => ({ setGithubLoginAction: h.setLogin }));

import { GithubHandlePanel } from './GithubHandlePanel';

beforeEach(() => vi.clearAllMocks());

describe('GithubHandlePanel', () => {
  it('disables Save while clean and enables it once dirty', async () => {
    const user = userEvent.setup();
    render(<GithubHandlePanel initial={null} />);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.type(screen.getByRole('textbox'), 'octocat');
    expect(save).toBeEnabled();
  });

  it('saves a handle and shows the saved indicator', async () => {
    h.setLogin.mockResolvedValue({ ok: true, githubLogin: 'octocat' });
    const user = userEvent.setup();
    render(<GithubHandlePanel initial={null} />);
    await user.type(screen.getByRole('textbox'), '@octocat');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.setLogin).toHaveBeenCalledWith('@octocat'));
    expect(await screen.findByText(/Saved/)).toBeInTheDocument();
  });

  it('shows the error returned by the action', async () => {
    h.setLogin.mockResolvedValue({ ok: false, error: 'invalid handle' });
    const user = userEvent.setup();
    render(<GithubHandlePanel initial="old" />);
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'new');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('invalid handle')).toBeInTheDocument();
  });
});
