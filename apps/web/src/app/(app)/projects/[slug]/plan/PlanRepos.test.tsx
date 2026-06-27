import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  getReposSectionAction: vi.fn(),
  createRepoOnGithubAction: vi.fn(),
  linkExistingRepoAction: vi.fn(),
  updateProjectRepoAction: vi.fn(),
  removeProjectRepoAction: vi.fn(),
  verifyRepoAccessAction: vi.fn(),
}));

vi.mock('@/lib/actions/repos', () => ({
  getReposSectionAction: h.getReposSectionAction,
  createRepoOnGithubAction: h.createRepoOnGithubAction,
  linkExistingRepoAction: h.linkExistingRepoAction,
  updateProjectRepoAction: h.updateProjectRepoAction,
  removeProjectRepoAction: h.removeProjectRepoAction,
  verifyRepoAccessAction: h.verifyRepoAccessAction,
}));

import { PlanRepos } from './PlanRepos';

type Section = Record<string, unknown>;

function section(over: Section = {}): Section {
  return {
    githubConfigured: true,
    members: [],
    repos: [],
    suggested: [],
    ...over,
  };
}

function repo(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    name: 'api',
    kind: 'backend',
    url: 'https://github.com/org/api',
    repoPath: '/srv/api',
    githubFullName: 'org/api',
    access: [],
    ...over,
  };
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
});

describe('PlanRepos', () => {
  it('shows a loading state before the section resolves', async () => {
    h.getReposSectionAction.mockReturnValue(new Promise(() => {}));
    render(<PlanRepos slug="p" canWrite />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows the github-not-configured hint and renders a repo row', async () => {
    h.getReposSectionAction.mockResolvedValue({
      ok: true,
      data: section({
        githubConfigured: false,
        repos: [repo({ access: [], accessCheckedAt: null, githubFullName: null, repoPath: null })],
      }),
    });
    render(<PlanRepos slug="p" canWrite />);
    expect(await screen.findByText(/GitHub is not configured/i)).toBeInTheDocument();
    expect(screen.getByText('no local path')).toBeInTheDocument();
    // github not configured -> no "Check access" button
    expect(screen.queryByText(/Check access/i)).toBeNull();
  });

  it('renders a repo row with access matrix and verify, then verifies', async () => {
    const user = userEvent.setup();
    h.getReposSectionAction.mockResolvedValue({
      ok: true,
      data: section({
        repos: [
          repo({
            accessCheckedAt: '2024-01-01T00:00:00Z',
            access: [
              { userId: 'u1', name: 'Ann', login: 'ann', hasAccess: true, permission: 'push' },
              { userId: 'u2', name: 'Bob', login: null, hasAccess: false },
              { userId: 'u3', name: 'Cy', login: 'cy', hasAccess: null },
            ],
          }),
        ],
      }),
    });
    h.verifyRepoAccessAction.mockResolvedValue({ ok: true, data: section({ repos: [repo()] }) });
    render(<PlanRepos slug="p" canWrite />);
    expect(await screen.findByText('✓ push')).toBeInTheDocument();
    expect(screen.getByText(/no access/i)).toBeInTheDocument();
    expect(screen.getByText(/no handle/i)).toBeInTheDocument();
    expect(screen.getByText(/Manage access on GitHub/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Check access/i }));
    expect(h.verifyRepoAccessAction).toHaveBeenCalledWith('p', 'r1');
  });

  it('edits a repo row and saves', async () => {
    const user = userEvent.setup();
    h.getReposSectionAction.mockResolvedValue({ ok: true, data: section({ repos: [repo()] }) });
    h.updateProjectRepoAction.mockResolvedValue({ ok: true, data: section({ repos: [repo()] }) });
    render(<PlanRepos slug="p" canWrite />);
    await user.click(await screen.findByRole('button', { name: /Configure/i }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.updateProjectRepoAction).toHaveBeenCalled();
  });

  it('cancels the repo row edit', async () => {
    const user = userEvent.setup();
    h.getReposSectionAction.mockResolvedValue({ ok: true, data: section({ repos: [repo()] }) });
    render(<PlanRepos slug="p" canWrite />);
    await user.click(await screen.findByRole('button', { name: /Configure/i }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: /Configure/i })).toBeInTheDocument();
  });

  it('removes a repo after confirmation', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    h.getReposSectionAction.mockResolvedValue({ ok: true, data: section({ repos: [repo()] }) });
    h.removeProjectRepoAction.mockResolvedValue({ ok: true, data: section({ repos: [] }) });
    render(<PlanRepos slug="p" canWrite />);
    await user.click(await screen.findByRole('button', { name: /Remove/i }));
    expect(h.removeProjectRepoAction).toHaveBeenCalledWith('p', 'r1');
  });

  it('does not remove when confirmation is declined', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    h.getReposSectionAction.mockResolvedValue({ ok: true, data: section({ repos: [repo()] }) });
    render(<PlanRepos slug="p" canWrite />);
    await user.click(await screen.findByRole('button', { name: /Remove/i }));
    expect(h.removeProjectRepoAction).not.toHaveBeenCalled();
  });

  it('hides write actions when canWrite is false', async () => {
    h.getReposSectionAction.mockResolvedValue({ ok: true, data: section({ repos: [repo()] }) });
    render(<PlanRepos slug="p" canWrite={false} />);
    await screen.findByText('api');
    expect(screen.queryByRole('button', { name: /Configure/i })).toBeNull();
  });

  it('creates a suggested repo on github', async () => {
    const user = userEvent.setup();
    h.getReposSectionAction.mockResolvedValue({
      ok: true,
      data: section({
        suggested: [{ name: 'web', kind: 'frontend', stack: 'next', reason: 'ui' }],
      }),
    });
    h.createRepoOnGithubAction.mockResolvedValue({ ok: true, data: section() });
    render(<PlanRepos slug="p" canWrite />);
    expect(await screen.findByText('AI-suggested')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Create on GitHub/i }));
    expect(h.createRepoOnGithubAction).toHaveBeenCalledWith('p', {
      name: 'web',
      kind: 'frontend',
      description: 'ui',
    });
  });

  it('links a suggested repo from a pasted url', async () => {
    const user = userEvent.setup();
    h.getReposSectionAction.mockResolvedValue({
      ok: true,
      data: section({ suggested: [{ name: 'web', kind: 'frontend' }] }),
    });
    h.linkExistingRepoAction.mockResolvedValue({ ok: true, data: section() });
    render(<PlanRepos slug="p" canWrite />);
    const url = await screen.findByPlaceholderText(/or paste existing URL/i);
    await user.type(url, 'https://github.com/org/web');
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(h.linkExistingRepoAction).toHaveBeenCalledWith('p', {
      name: 'web',
      kind: 'frontend',
      url: 'https://github.com/org/web',
    });
  });

  it('manually adds an existing repo and surfaces an error', async () => {
    const user = userEvent.setup();
    h.getReposSectionAction.mockResolvedValue({ ok: true, data: section() });
    h.linkExistingRepoAction.mockResolvedValue({ ok: false, error: 'bad url' });
    render(<PlanRepos slug="p" canWrite />);
    await user.click(await screen.findByRole('button', { name: /Add existing repo/i }));
    await user.type(screen.getByPlaceholderText('name'), 'lib');
    await user.type(screen.getByPlaceholderText('https://github.com/org/repo'), 'https://x/lib');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(h.linkExistingRepoAction).toHaveBeenCalled();
    expect(await screen.findByText('bad url')).toBeInTheDocument();
  });

  it('closes the manual add form via cancel', async () => {
    const user = userEvent.setup();
    h.getReposSectionAction.mockResolvedValue({ ok: true, data: section() });
    render(<PlanRepos slug="p" canWrite />);
    await user.click(await screen.findByRole('button', { name: /Add existing repo/i }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: /Add existing repo/i })).toBeInTheDocument();
  });
});
