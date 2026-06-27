import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ create: vi.fn(), revoke: vi.fn(), refresh: vi.fn(), writeText: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock('@/lib/actions/api-tokens', () => ({
  createApiTokenAction: h.create,
  revokeApiTokenAction: h.revoke,
}));

import { TokensPanel } from './TokensPanel';

type Token = Parameters<typeof TokensPanel>[0]['tokens'][number];
const token = (over: Partial<Token> = {}): Token => ({
  id: 't1',
  name: 'work laptop',
  prefix: 'axon_ab',
  scopes: ['tasks:read'],
  projectSlugs: [],
  lastUsedAt: null,
  expiresAt: null,
  createdAt: new Date().toISOString(),
  ...over,
});

const projects = [{ slug: 'proj', name: 'Proj One' }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('TokensPanel', () => {
  it('shows the empty state when there are no tokens', () => {
    render(<TokensPanel tokens={[]} availableProjects={projects} />);
    expect(screen.getByText('You have not created any tokens yet.')).toBeInTheDocument();
  });

  it('renders existing tokens with all-projects and scoped variants', () => {
    render(
      <TokensPanel
        tokens={[
          token({ id: 'a', name: 'all-proj', lastUsedAt: new Date().toISOString() }),
          token({ id: 'b', name: 'scoped', projectSlugs: ['proj'] }),
        ]}
        availableProjects={projects}
      />,
    );
    expect(screen.getByText('all-proj')).toBeInTheDocument();
    expect(screen.getByText('all')).toBeInTheDocument();
    expect(screen.getByText('proj')).toBeInTheDocument();
  });

  it('toggles scopes and projects then creates a token', async () => {
    h.create.mockResolvedValue({ ok: true, plainToken: 'axon_plain_secret', prefix: 'axon_pl' });
    const user = userEvent.setup();
    render(<TokensPanel tokens={[]} availableProjects={projects} />);
    await user.type(screen.getByPlaceholderText('e.g. MCP server - work laptop'), 'My token');
    // toggle an extra scope and a project
    await user.click(screen.getByRole('checkbox', { name: 'projects:read' }));
    await user.click(screen.getByRole('checkbox', { name: 'Proj One' }));
    await user.click(screen.getByRole('button', { name: 'Create token' }));
    await waitFor(() => expect(h.create).toHaveBeenCalled());
    const arg = h.create.mock.calls[0][0];
    expect(arg.name).toBe('My token');
    expect(arg.scopes).toContain('projects:read');
    expect(arg.projectSlugs).toEqual(['proj']);
    expect(await screen.findByText(/Token created/)).toBeInTheDocument();
    const clip = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(clip).toHaveBeenCalledWith('axon_plain_secret');
    expect(h.refresh).toHaveBeenCalled();
  });

  it('unchecking a default scope removes it from the payload', async () => {
    h.create.mockResolvedValue({ ok: true, plainToken: 'p', prefix: 'pr' });
    const user = userEvent.setup();
    render(<TokensPanel tokens={[]} availableProjects={projects} />);
    await user.type(screen.getByPlaceholderText('e.g. MCP server - work laptop'), 'My token');
    await user.click(screen.getByRole('checkbox', { name: 'tasks:read' })); // default-on -> off
    await user.click(screen.getByRole('button', { name: 'Create token' }));
    await waitFor(() => expect(h.create).toHaveBeenCalled());
    expect(h.create.mock.calls[0][0].scopes).not.toContain('tasks:read');
  });

  it('surfaces a create error', async () => {
    h.create.mockResolvedValue({ ok: false, error: 'bad token' });
    const user = userEvent.setup();
    render(<TokensPanel tokens={[]} availableProjects={projects} />);
    await user.type(screen.getByPlaceholderText('e.g. MCP server - work laptop'), 'My token');
    await user.click(screen.getByRole('button', { name: 'Create token' }));
    expect(await screen.findByText('bad token')).toBeInTheDocument();
  });

  it('revokes a token after confirmation', async () => {
    h.revoke.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<TokensPanel tokens={[token()]} availableProjects={projects} />);
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(h.revoke).toHaveBeenCalledWith('t1'));
    expect(h.refresh).toHaveBeenCalled();
  });

  it('does not revoke when confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<TokensPanel tokens={[token()]} availableProjects={projects} />);
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(h.revoke).not.toHaveBeenCalled();
  });

  it('shows the error from a failed revoke', async () => {
    h.revoke.mockResolvedValue({ ok: false, error: 'revoke-fail' });
    const user = userEvent.setup();
    render(<TokensPanel tokens={[token()]} availableProjects={projects} />);
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('revoke-fail')).toBeInTheDocument();
  });
});
