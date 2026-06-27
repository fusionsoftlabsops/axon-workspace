import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  createTaskAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: h.refresh, push: vi.fn() }),
}));
vi.mock('@/lib/actions/tasks', () => ({
  createTaskAction: h.createTaskAction,
}));

import { NewTaskInline } from './NewTaskInline';
import type { MemberView } from './BoardClient';

const members: MemberView[] = [{ id: 'm1', name: 'Ann', email: 'a@x.com' }];

function renderInline() {
  return render(
    <NewTaskInline
      projectSlug="demo"
      stateId="s1"
      defaultAssigneeId="m1"
      members={members}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NewTaskInline', () => {
  it('starts collapsed and opens the form on click', async () => {
    const user = userEvent.setup();
    renderInline();
    const addBtn = screen.getByRole('button', { name: /nueva tarea/ });
    await user.click(addBtn);
    expect(screen.getByPlaceholderText('Título')).toBeInTheDocument();
  });

  it('creates a task and resets on success', async () => {
    h.createTaskAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderInline();
    await user.click(screen.getByRole('button', { name: /nueva tarea/ }));
    await user.type(screen.getByPlaceholderText('Título'), 'New task');
    await user.click(screen.getByRole('button', { name: 'Crear' }));

    await waitFor(() => expect(h.createTaskAction).toHaveBeenCalled());
    expect(h.createTaskAction).toHaveBeenCalledWith('demo', {
      stateId: 's1',
      title: 'New task',
      priority: 'MEDIUM',
      assigneeId: 'm1',
    });
    expect(h.refresh).toHaveBeenCalled();
    // form closes -> back to the add button
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /nueva tarea/ })).toBeInTheDocument(),
    );
  });

  it('shows the action error', async () => {
    h.createTaskAction.mockResolvedValue({ ok: false, error: 'boom' });
    const user = userEvent.setup();
    renderInline();
    await user.click(screen.getByRole('button', { name: /nueva tarea/ }));
    await user.type(screen.getByPlaceholderText('Título'), 'X');
    await user.click(screen.getByRole('button', { name: 'Crear' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('does not submit when the title is only whitespace', async () => {
    const user = userEvent.setup();
    renderInline();
    await user.click(screen.getByRole('button', { name: /nueva tarea/ }));
    await user.type(screen.getByPlaceholderText('Título'), '   ');
    await user.click(screen.getByRole('button', { name: 'Crear' }));
    expect(h.createTaskAction).not.toHaveBeenCalled();
  });

  it('submits on Enter and closes on Escape', async () => {
    h.createTaskAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderInline();
    await user.click(screen.getByRole('button', { name: /nueva tarea/ }));
    const textarea = screen.getByPlaceholderText('Título');
    await user.type(textarea, 'Quick{Enter}');
    await waitFor(() => expect(h.createTaskAction).toHaveBeenCalled());
  });

  it('closes on Escape key', async () => {
    const user = userEvent.setup();
    renderInline();
    await user.click(screen.getByRole('button', { name: /nueva tarea/ }));
    const textarea = screen.getByPlaceholderText('Título');
    await user.type(textarea, '{Escape}');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /nueva tarea/ })).toBeInTheDocument(),
    );
  });

  it('cancels the form with the Cancelar button', async () => {
    const user = userEvent.setup();
    renderInline();
    await user.click(screen.getByRole('button', { name: /nueva tarea/ }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /nueva tarea/ })).toBeInTheDocument(),
    );
  });
});
