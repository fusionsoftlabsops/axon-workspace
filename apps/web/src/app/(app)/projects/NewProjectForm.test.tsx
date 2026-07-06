import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  createProjectAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push, refresh: h.refresh, back: vi.fn() }),
}));
vi.mock('@/lib/actions/projects', () => ({
  createProjectAction: h.createProjectAction,
}));

import { NewProjectForm } from './NewProjectForm';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NewProjectForm', () => {
  it('auto-fills the slug from the first keystroke of the name', async () => {
    const user = userEvent.setup();
    render(<NewProjectForm />);
    const slugInput = screen.getByPlaceholderText('slug (auto)') as HTMLInputElement;
    expect(slugInput.value).toBe('');
    await user.type(screen.getByPlaceholderText('Project name'), 'Hello');
    // The name field only seeds the slug while it is still empty.
    expect(slugInput.value).toBe('h');
  });

  it('submits with a manually edited slug and the description', async () => {
    h.createProjectAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<NewProjectForm />);

    await user.type(screen.getByPlaceholderText('Project name'), 'Project Name');
    const slugInput = screen.getByPlaceholderText('slug (auto)');
    await user.clear(slugInput);
    await user.type(slugInput, 'My Custom Slug!!');
    await user.type(screen.getByPlaceholderText('Description (optional)'), 'a desc');

    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(h.createProjectAction).toHaveBeenCalled());
    // The slug field re-slugifies on every keystroke, so interstitial spaces
    // never survive as hyphens — they are stripped as trailing separators.
    expect(h.createProjectAction).toHaveBeenCalledWith({
      slug: 'mycustomslug',
      name: 'Project Name',
      description: 'a desc',
      runtime: 'CLOUD',
    });
    expect(h.push).toHaveBeenCalledWith('/projects/mycustomslug/plan');
    expect(h.refresh).toHaveBeenCalled();
  });

  it('falls back to slugifying the name when the slug field is empty', async () => {
    h.createProjectAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<NewProjectForm />);

    await user.type(screen.getByPlaceholderText('Project name'), 'Edge Case Name');
    await user.clear(screen.getByPlaceholderText('slug (auto)'));
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(h.createProjectAction).toHaveBeenCalled());
    expect(h.createProjectAction).toHaveBeenCalledWith({
      slug: 'edge-case-name',
      name: 'Edge Case Name',
      description: undefined,
      runtime: 'CLOUD',
    });
    expect(h.push).toHaveBeenCalledWith('/projects/edge-case-name/plan');
  });

  it('shows the error returned by the action and does not navigate', async () => {
    h.createProjectAction.mockResolvedValue({ ok: false, error: 'slug taken' });
    const user = userEvent.setup();
    render(<NewProjectForm />);

    await user.type(screen.getByPlaceholderText('Project name'), 'X');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(await screen.findByText('slug taken')).toBeInTheDocument();
    expect(h.push).not.toHaveBeenCalled();
  });

  it('disables the submit button while the name is empty', () => {
    render(<NewProjectForm />);
    expect(screen.getByRole('button', { name: 'Create project' })).toBeDisabled();
  });

  it('pasa runtime LOCAL cuando se elige el runtime local', async () => {
    h.createProjectAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<NewProjectForm />);

    await user.type(screen.getByPlaceholderText('Project name'), 'Local Proj');
    await user.click(screen.getByLabelText(/Local · your Claude Code/));
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(h.createProjectAction).toHaveBeenCalled());
    expect(h.createProjectAction).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'LOCAL' }));
  });
});
