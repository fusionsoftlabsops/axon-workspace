import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

import { TaskCard, type TaskView } from './TaskCard';

function makeTask(overrides: Partial<TaskView> = {}): TaskView {
  return {
    id: 't1',
    taskNumber: 7,
    title: 'Do the thing',
    stateId: 's1',
    priority: 'HIGH',
    assignee: { id: 'u1', name: 'Ada Lovelace' },
    positionInState: 0,
    subtaskCount: 2,
    commentCount: 3,
    dueDate: '2026-01-15T00:00:00.000Z',
    category: 'feature',
    estimate: '3h',
    ...overrides,
  };
}

describe('TaskCard', () => {
  it('renders full metadata wrapped in a link', () => {
    render(<TaskCard task={makeTask()} projectSlug="demo" canWrite />);
    expect(screen.getByText('#7')).toBeInTheDocument();
    expect(screen.getByText('Do the thing')).toBeInTheDocument();
    expect(screen.getByText('feature')).toBeInTheDocument();
    expect(screen.getByText('3h')).toBeInTheDocument();
    // initials of "Ada Lovelace"
    expect(screen.getByText('AL')).toBeInTheDocument();
    expect(screen.getByText(/↳ 2/)).toBeInTheDocument();
    expect(screen.getByText(/💬 3/)).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/projects/demo/board?task=t1');
  });

  it('renders minimal task without optional metadata', () => {
    render(
      <TaskCard
        task={makeTask({
          assignee: null,
          subtaskCount: 0,
          commentCount: 0,
          dueDate: null,
          category: null,
          estimate: null,
          priority: 'LOW',
        })}
        projectSlug="demo"
        canWrite={false}
      />,
    );
    expect(screen.getByText('Do the thing')).toBeInTheDocument();
    expect(screen.queryByText('feature')).not.toBeInTheDocument();
  });

  it('renders single-word assignee initials', () => {
    render(
      <TaskCard
        task={makeTask({ assignee: { id: 'u2', name: 'Cher' } })}
        projectSlug="demo"
        canWrite
      />,
    );
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('renders as plain content (no link) when used as overlay', () => {
    render(<TaskCard task={makeTask()} projectSlug="demo" canWrite={false} isOverlay />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Do the thing')).toBeInTheDocument();
  });

  it('shows the Reopen quick action for a DONE column and calls onQuickMove', async () => {
    const onQuickMove = vi.fn();
    const user = userEvent.setup();
    render(
      <TaskCard
        task={makeTask()}
        projectSlug="demo"
        canWrite
        stateCategory="DONE"
        inProgressStateId="prog"
        onQuickMove={onQuickMove}
      />,
    );
    const btn = screen.getByRole('button', { name: '↩ Reopen' });
    await user.click(btn);
    expect(onQuickMove).toHaveBeenCalledWith('t1', 'prog');
  });

  it('shows the Unblock quick action for a BLOCKED column', () => {
    render(
      <TaskCard
        task={makeTask()}
        projectSlug="demo"
        canWrite
        stateCategory="BLOCKED"
        inProgressStateId="prog"
        onQuickMove={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '↩ Unblock' })).toBeInTheDocument();
  });

  it('hides the quick action for non DONE/BLOCKED categories', () => {
    render(
      <TaskCard
        task={makeTask()}
        projectSlug="demo"
        canWrite
        stateCategory="IN_PROGRESS"
        inProgressStateId="prog"
        onQuickMove={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /Reopen|Unblock/ }),
    ).not.toBeInTheDocument();
  });

  describe('priority badge', () => {
    it('renders a single priority indicator with an aria-label including the level', () => {
      render(<TaskCard task={makeTask({ priority: 'HIGH' })} projectSlug="demo" canWrite />);
      const badges = screen.getAllByRole('img');
      expect(badges).toHaveLength(1);
      expect(badges[0]).toHaveAttribute('aria-label', expect.stringContaining('High'));
      expect(badges[0]).toHaveAttribute('title', expect.stringContaining('High'));
    });

    it.each([
      ['LOW', 'Low', '▽'],
      ['MEDIUM', 'Medium', '='],
      ['HIGH', 'High', '△'],
      ['URGENT', 'Urgent', '⚑'],
    ] as const)('shows the correct icon and label for %s', (priority, label, icon) => {
      render(<TaskCard task={makeTask({ priority })} projectSlug="demo" canWrite />);
      const badge = screen.getByRole('img');
      expect(badge).toHaveTextContent(icon);
      expect(badge).toHaveAttribute('aria-label', expect.stringContaining(label));
    });

    it('falls back to the neutral (MEDIUM) state for an unknown priority value without throwing', () => {
      render(
        <TaskCard
          task={makeTask({ priority: 'BOGUS' as any })}
          projectSlug="demo"
          canWrite
        />,
      );
      const badge = screen.getByRole('img');
      expect(badge).toHaveAttribute('aria-label', expect.stringContaining('Medium'));
    });
  });
});
