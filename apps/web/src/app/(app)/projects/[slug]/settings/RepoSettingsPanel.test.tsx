import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }));
const h = vi.hoisted(() => ({ setProjectRepoConfigAction: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/actions/repo-config', () => ({
  setProjectRepoConfigAction: h.setProjectRepoConfigAction,
}));

import { RepoSettingsPanel } from './RepoSettingsPanel';

function props(over: Record<string, unknown> = {}) {
  return {
    projectSlug: 'p',
    initial: { repoPath: null, repoUrl: null, repoDefaultBranch: null },
    ...over,
  } as never;
}

beforeEach(() => {
  router.refresh.mockReset();
  h.setProjectRepoConfigAction.mockReset();
});

describe('RepoSettingsPanel', () => {
  it('renders with defaults (branch main) and pre-fills initial values', () => {
    render(
      <RepoSettingsPanel
        {...props({ initial: { repoPath: '/srv/x', repoUrl: 'http://x', repoDefaultBranch: 'dev' } })}
      />,
    );
    expect(screen.getByDisplayValue('/srv/x')).toBeInTheDocument();
    expect(screen.getByDisplayValue('http://x')).toBeInTheDocument();
    expect(screen.getByDisplayValue('dev')).toBeInTheDocument();
  });

  it('saves the config and shows a success message', async () => {
    const user = userEvent.setup();
    h.setProjectRepoConfigAction.mockResolvedValue({ ok: true });
    render(<RepoSettingsPanel {...props()} />);
    await user.type(screen.getByPlaceholderText(/mi-app/), 'C:/repo');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.setProjectRepoConfigAction).toHaveBeenCalledWith('p', {
      repoPath: 'C:/repo',
      repoUrl: null,
      repoDefaultBranch: 'main',
    });
    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
  });

  it('clears the branch to main when emptied', async () => {
    const user = userEvent.setup();
    h.setProjectRepoConfigAction.mockResolvedValue({ ok: true });
    render(<RepoSettingsPanel {...props({ initial: { repoPath: null, repoUrl: null, repoDefaultBranch: 'dev' } })} />);
    await user.clear(screen.getByDisplayValue('dev'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.setProjectRepoConfigAction).toHaveBeenCalledWith('p', {
      repoPath: null,
      repoUrl: null,
      repoDefaultBranch: 'main',
    });
  });

  it('shows the returned error when saving fails', async () => {
    const user = userEvent.setup();
    h.setProjectRepoConfigAction.mockResolvedValue({ ok: false, error: 'invalid path' });
    render(<RepoSettingsPanel {...props()} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('invalid path')).toBeInTheDocument();
  });

  it('shows a fallback error when saving fails without a message', async () => {
    const user = userEvent.setup();
    h.setProjectRepoConfigAction.mockResolvedValue({ ok: false });
    render(<RepoSettingsPanel {...props()} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('could not save')).toBeInTheDocument();
  });
});
