import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// --- jsdom polyfills so @dnd-kit's PointerSensor can run a real drag ---------
beforeAll(() => {
  if (!(globalThis as any).PointerEvent) {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number;
      isPrimary: boolean;
      constructor(type: string, props: any = {}) {
        super(type, props);
        this.pointerId = props.pointerId ?? 1;
        this.isPrimary = props.isPrimary ?? true;
      }
    }
    (globalThis as any).PointerEvent = PointerEventPolyfill;
  }
  Element.prototype.setPointerCapture = Element.prototype.setPointerCapture ?? (() => {});
  Element.prototype.releasePointerCapture =
    Element.prototype.releasePointerCapture ?? (() => {});
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
});

function rectFor(top: number, left = 0, width = 200, height = 80): DOMRect {
  return {
    top,
    left,
    width,
    height,
    bottom: top + height,
    right: left + width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function setRect(el: Element, top: number, left = 0) {
  (el as HTMLElement).getBoundingClientRect = () => rectFor(top, left);
}

/** Drive @dnd-kit through a full pointer drag from `from` to (x, y). */
async function dragTo(from: Element, x: number, y: number) {
  await act(async () => {
    fireEvent.pointerDown(from, { clientX: 0, clientY: 0, button: 0, isPrimary: true });
  });
  await act(async () => {
    // First move passes the 6px activation constraint.
    fireEvent.pointerMove(document, { clientX: 10, clientY: 10 });
  });
  await act(async () => {
    fireEvent.pointerMove(document, { clientX: x, clientY: y });
  });
  await act(async () => {
    fireEvent.pointerUp(document, { clientX: x, clientY: y });
  });
}

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  moveTaskAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: h.refresh, push: vi.fn() }),
}));
vi.mock('@/lib/actions/tasks', () => ({
  moveTaskAction: h.moveTaskAction,
  createTaskAction: vi.fn(),
}));
// BoardShortcuts has its own dedicated test; mock it here so this file does not
// load a partially-covered instance of the module (which v8 merges down to).
vi.mock('./Shortcuts', () => ({ BoardShortcuts: () => null }));
// El drawer importa un server action (impl-plan) con deps server-only; se
// stubea aquí — su comportamiento se cubre en TaskDrawer.test.tsx.
vi.mock('./TaskDrawer', () => ({ TaskDrawer: () => null }));

import { BoardClient, type StateView, type MemberView } from './BoardClient';
import type { TaskView } from './TaskCard';

const states: StateView[] = [
  { id: 'prog', name: 'In Progress', color: '#00f', category: 'IN_PROGRESS', order: 0 },
  { id: 'done', name: 'Done', color: '#0f0', category: 'DONE', order: 1 },
  { id: 'blocked', name: 'Blocked', color: '#f00', category: 'BLOCKED', order: 2 },
];

const members: MemberView[] = [{ id: 'u1', name: 'Ada', email: 'a@x.com' }];

function task(overrides: Partial<TaskView>): TaskView {
  return {
    id: 't1',
    taskNumber: 1,
    title: 'Task one',
    stateId: 'done',
    priority: 'MEDIUM',
    assignee: null,
    positionInState: 0,
    subtaskCount: 0,
    commentCount: 0,
    dueDate: null,
    category: null,
    estimate: null,
    ...overrides,
  };
}

function renderBoard(tasks: TaskView[], canWrite = true) {
  return render(
    <BoardClient
      projectSlug="demo"
      canWrite={canWrite}
      currentUserId="u1"
      states={states}
      members={members}
      tasks={tasks}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BoardClient', () => {
  it('renders columns, counts and task cards', () => {
    renderBoard([
      task({ id: 't1', stateId: 'done', title: 'Done task' }),
      task({ id: 't2', stateId: 'prog', title: 'Progress task', positionInState: 0 }),
    ]);
    expect(screen.getByRole('heading', { name: 'In Progress' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getByText('Done task')).toBeInTheDocument();
    expect(screen.getByText('Progress task')).toBeInTheDocument();
    // new task affordance present because canWrite
    expect(screen.getAllByRole('button', { name: /nueva tarea/ }).length).toBe(states.length);
  });

  it('hides the new-task affordance when read-only', () => {
    renderBoard([task({ id: 't1' })], false);
    expect(screen.queryByRole('button', { name: /nueva tarea/ })).not.toBeInTheDocument();
  });

  it('quick-moves a DONE task back to in-progress and refreshes on success', async () => {
    h.moveTaskAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderBoard([task({ id: 't1', stateId: 'done', title: 'Done task' })]);

    const reopen = screen.getByRole('button', { name: '↩ Reopen' });
    await user.click(reopen);

    await waitFor(() => expect(h.moveTaskAction).toHaveBeenCalled());
    const args = h.moveTaskAction.mock.calls[0];
    expect(args[0]).toBe('demo');
    expect(args[1]).toBe('t1');
    expect(args[2]).toBe('prog');
    expect(args[3]).toEqual(['t1']);
    expect(h.refresh).toHaveBeenCalled();
  });

  it('reverts and alerts when the quick-move fails', async () => {
    h.moveTaskAction.mockResolvedValue({ ok: false, error: 'nope' });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const user = userEvent.setup();
    renderBoard([task({ id: 't1', stateId: 'done', title: 'Done task' })]);

    await user.click(screen.getByRole('button', { name: '↩ Reopen' }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('nope'));
    alertSpy.mockRestore();
  });

  it('reorders a task within a column via drag and persists the new order', async () => {
    h.moveTaskAction.mockResolvedValue({ ok: true });
    const { container } = renderBoard([
      task({ id: 't1', stateId: 'prog', title: 'First', positionInState: 0 }),
      task({ id: 't2', stateId: 'prog', title: 'Second', positionInState: 1 }),
    ]);

    container.querySelectorAll('section').forEach((s) => setRect(s, 9000));
    const cards = container.querySelectorAll('article');
    setRect(cards[0]!, 0); // t1
    setRect(cards[1]!, 100); // t2

    await dragTo(cards[0]!, 100, 140);

    await waitFor(() => expect(h.moveTaskAction).toHaveBeenCalled());
    const args = h.moveTaskAction.mock.calls[0];
    expect(args[0]).toBe('demo');
    expect(args[1]).toBe('t1');
    expect(args[2]).toBe('prog'); // same column
    expect(h.refresh).toHaveBeenCalled();
  });

  it('moves a task to another column via drag', async () => {
    h.moveTaskAction.mockResolvedValue({ ok: true });
    const { container } = renderBoard([
      task({ id: 't1', stateId: 'prog', title: 'First', positionInState: 0 }),
      task({ id: 't3', stateId: 'done', title: 'Third', positionInState: 0 }),
    ]);

    container.querySelectorAll('section').forEach((s) => setRect(s, 9000));
    const cards = container.querySelectorAll('article');
    setRect(cards[0]!, 0); // t1 (prog)
    setRect(cards[1]!, 100); // t3 (done)

    await dragTo(cards[0]!, 100, 140);

    await waitFor(() => expect(h.moveTaskAction).toHaveBeenCalled());
    const args = h.moveTaskAction.mock.calls[0];
    expect(args[1]).toBe('t1');
    expect(args[2]).toBe('done'); // crossed into the done column
  });

  it('reverts and alerts when a drag persist fails', async () => {
    h.moveTaskAction.mockResolvedValue({ ok: false, error: 'drag boom' });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { container } = renderBoard([
      task({ id: 't1', stateId: 'prog', title: 'First', positionInState: 0 }),
      task({ id: 't2', stateId: 'prog', title: 'Second', positionInState: 1 }),
    ]);

    container.querySelectorAll('section').forEach((s) => setRect(s, 9000));
    const cards = container.querySelectorAll('article');
    setRect(cards[0]!, 0);
    setRect(cards[1]!, 100);

    await dragTo(cards[0]!, 100, 140);

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('drag boom'));
    alertSpy.mockRestore();
  });

  it('ignores a quick-move when there is no in-progress target', async () => {
    // No IN_PROGRESS state -> inProgressStateId is null -> quick action not shown.
    const onlyDone: StateView[] = [
      { id: 'done', name: 'Done', color: '#0f0', category: 'DONE', order: 0 },
    ];
    render(
      <BoardClient
        projectSlug="demo"
        canWrite
        currentUserId="u1"
        states={onlyDone}
        members={members}
        tasks={[task({ id: 't1', stateId: 'done' })]}
      />,
    );
    expect(screen.queryByRole('button', { name: '↩ Reopen' })).not.toBeInTheDocument();
  });
});
