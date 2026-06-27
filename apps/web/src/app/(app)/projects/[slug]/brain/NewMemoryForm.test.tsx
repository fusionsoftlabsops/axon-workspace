import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const act = vi.hoisted(() => ({ captureMemoryAction: vi.fn() }));
vi.mock('@/lib/actions/brain', () => act);

import { NewMemoryForm } from './NewMemoryForm';

describe('NewMemoryForm', () => {
  beforeEach(() => act.captureMemoryAction.mockReset());

  it('disables submit until title and body are filled', () => {
    render(<NewMemoryForm projectSlug="proj" onCreated={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Capture memory' })).toBeDisabled();
  });

  it('submits with parsed payload and resets on success', async () => {
    act.captureMemoryAction.mockResolvedValue({ ok: true });
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<NewMemoryForm projectSlug="proj" onCreated={onCreated} />);

    await user.selectOptions(screen.getByLabelText('Type'), 'DECISION');
    await user.selectOptions(screen.getByLabelText('Destination'), 'PROJECT');
    await user.type(screen.getByLabelText(/Source task/), '42');
    await user.type(screen.getByLabelText(/Tags/), 'a, b, ,c');
    await user.type(screen.getByLabelText('Title'), 'Hello');
    await user.type(screen.getByLabelText(/Body/), 'World');
    await user.click(screen.getByRole('button', { name: 'Capture memory' }));

    expect(act.captureMemoryAction).toHaveBeenCalledWith('proj', {
      type: 'DECISION',
      title: 'Hello',
      body: 'World',
      tags: ['a', 'b', 'c'],
      scope: 'PROJECT',
      sourceTaskNumber: 42,
    });
    expect(onCreated).toHaveBeenCalled();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('');
  });

  it('submits without a source task number', async () => {
    act.captureMemoryAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<NewMemoryForm projectSlug="proj" onCreated={vi.fn()} />);
    await user.type(screen.getByLabelText('Title'), 'T');
    await user.type(screen.getByLabelText(/Body/), 'B');
    await user.click(screen.getByRole('button', { name: 'Capture memory' }));
    expect(act.captureMemoryAction).toHaveBeenCalledWith(
      'proj',
      expect.objectContaining({ sourceTaskNumber: undefined }),
    );
  });

  it('shows an error when the action fails', async () => {
    act.captureMemoryAction.mockResolvedValue({ ok: false, error: 'boom' });
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<NewMemoryForm projectSlug="proj" onCreated={onCreated} />);
    await user.type(screen.getByLabelText('Title'), 'T');
    await user.type(screen.getByLabelText(/Body/), 'B');
    await user.click(screen.getByRole('button', { name: 'Capture memory' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
