import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }));
const h = vi.hoisted(() => ({
  deleteProjectAction: vi.fn(),
  setProjectStatusAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/actions/projects', () => ({
  deleteProjectAction: h.deleteProjectAction,
  setProjectStatusAction: h.setProjectStatusAction,
}));

import { ProjectLifecyclePanel } from './ProjectLifecyclePanel';

function props(over: Record<string, unknown> = {}) {
  return {
    projectSlug: 'my-proj',
    projectName: 'My Project',
    currentStatus: 'ACTIVE',
    ...over,
  } as never;
}

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
  Object.values(h).forEach((fn) => fn.mockReset());
});

describe('ProjectLifecyclePanel', () => {
  it('renders all status buttons with the active one disabled', () => {
    render(<ProjectLifecyclePanel {...props()} />);
    expect(screen.getByRole('button', { name: 'Active' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Paused' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Completed' })).toBeEnabled();
  });

  it('changes the status and refreshes', async () => {
    const user = userEvent.setup();
    h.setProjectStatusAction.mockResolvedValue({ ok: true });
    render(<ProjectLifecyclePanel {...props()} />);
    await user.click(screen.getByRole('button', { name: 'Paused' }));
    expect(h.setProjectStatusAction).toHaveBeenCalledWith('my-proj', 'PAUSED');
    expect(router.refresh).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Paused' })).toBeDisabled();
  });

  it('shows an error when changing status fails', async () => {
    const user = userEvent.setup();
    h.setProjectStatusAction.mockResolvedValue({ ok: false, error: 'status err' });
    render(<ProjectLifecyclePanel {...props()} />);
    await user.click(screen.getByRole('button', { name: 'Inactive' }));
    expect(await screen.findByText('status err')).toBeInTheDocument();
  });

  it('opens the delete confirmation and enables delete only on exact slug match', async () => {
    const user = userEvent.setup();
    render(<ProjectLifecyclePanel {...props()} />);
    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    const confirm = screen.getByRole('button', { name: /Delete "My Project"/i });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByPlaceholderText('my-proj'), 'my-proj');
    expect(confirm).toBeEnabled();
  });

  it('deletes the project and navigates away', async () => {
    const user = userEvent.setup();
    h.deleteProjectAction.mockResolvedValue({ ok: true });
    render(<ProjectLifecyclePanel {...props()} />);
    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    await user.type(screen.getByPlaceholderText('my-proj'), 'my-proj');
    await user.click(screen.getByRole('button', { name: /Delete "My Project"/i }));
    expect(h.deleteProjectAction).toHaveBeenCalledWith('my-proj');
    expect(router.push).toHaveBeenCalledWith('/projects');
  });

  it('shows an error when deletion fails', async () => {
    const user = userEvent.setup();
    h.deleteProjectAction.mockResolvedValue({ ok: false, error: 'del err' });
    render(<ProjectLifecyclePanel {...props()} />);
    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    await user.type(screen.getByPlaceholderText('my-proj'), 'my-proj');
    await user.click(screen.getByRole('button', { name: /Delete "My Project"/i }));
    expect(await screen.findByText('del err')).toBeInTheDocument();
  });

  it('cancels the delete confirmation', async () => {
    const user = userEvent.setup();
    render(<ProjectLifecyclePanel {...props()} />);
    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    await user.type(screen.getByPlaceholderText('my-proj'), 'partial');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    // back to the single trigger button
    expect(screen.getByRole('button', { name: 'Delete project' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('my-proj')).toBeNull();
  });
});
