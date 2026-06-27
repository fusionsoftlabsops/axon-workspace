import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  count: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/auth', () => ({ auth: h.auth }));
vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: h.findUnique },
    brainMemory: { count: h.count },
  },
}));
vi.mock('next/navigation', () => ({ notFound: h.notFound }));
vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));
vi.mock('./BoardClient', () => ({
  BoardClient: (props: any) => (
    <div data-testid="board-client" data-canwrite={String(props.canWrite)}>
      states:{props.states.length} tasks:{props.tasks.length} members:{props.members.length}
    </div>
  ),
}));

import BoardPage from './page';

const params = Promise.resolve({ slug: 'demo' });

function fullProject() {
  return {
    id: 'p1',
    slug: 'demo',
    members: [
      { userId: 'u1', role: 'OWNER', user: { id: 'u1', name: 'Ada', email: 'a@x.com' } },
    ],
    workflows: [
      {
        id: 'w1',
        isDefault: true,
        states: [
          { id: 's1', name: 'Todo', color: '#111', category: 'TODO', order: 0 },
        ],
      },
    ],
    tasks: [
      {
        id: 't1',
        taskNumber: 1,
        title: 'Task',
        stateId: 's1',
        priority: 'MEDIUM',
        assignee: { id: 'u1', name: 'Ada' },
        positionInState: 0,
        _count: { subtasks: 0, comments: 0 },
        dueDate: new Date('2026-01-01T00:00:00Z'),
        category: 'feature',
        estimate: '2h',
      },
      {
        id: 't2',
        taskNumber: 2,
        title: 'Task 2',
        stateId: 's1',
        priority: 'LOW',
        assignee: null,
        positionInState: 1,
        _count: { subtasks: 1, comments: 2 },
        dueDate: null,
        category: null,
        estimate: null,
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BoardPage', () => {
  it('returns null without a session', async () => {
    h.auth.mockResolvedValue(null);
    const { container } = render(await BoardPage({ params }));
    expect(container).toBeEmptyDOMElement();
  });

  it('calls notFound when the project is missing', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } });
    h.findUnique.mockResolvedValue(null);
    await expect(BoardPage({ params })).rejects.toThrow();
    expect(h.notFound).toHaveBeenCalled();
  });

  it('calls notFound when the user is not a member', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } });
    const proj = fullProject();
    proj.members = [
      { userId: 'other', role: 'OWNER', user: { id: 'other', name: 'X', email: 'x@x.com' } },
    ];
    h.findUnique.mockResolvedValue(proj);
    await expect(BoardPage({ params })).rejects.toThrow();
    expect(h.notFound).toHaveBeenCalled();
  });

  it('renders a fallback when there is no default workflow', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } });
    const proj = fullProject();
    proj.workflows = [];
    h.findUnique.mockResolvedValue(proj);
    render(await BoardPage({ params }));
    expect(screen.getByText(/no tiene workflow configurado/)).toBeInTheDocument();
  });

  it('renders the board and the memory banner (plural) when memories pending', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } });
    h.findUnique.mockResolvedValue(fullProject());
    h.count.mockResolvedValue(3);
    render(await BoardPage({ params }));
    expect(screen.getByTestId('board-client')).toHaveTextContent('states:1 tasks:2 members:1');
    expect(screen.getByTestId('board-client')).toHaveAttribute('data-canwrite', 'true');
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/memorias locales/)).toBeInTheDocument();
  });

  it('renders the singular banner for exactly one memory', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } });
    h.findUnique.mockResolvedValue(fullProject());
    h.count.mockResolvedValue(1);
    render(await BoardPage({ params }));
    expect(screen.getByText(/memoria local/)).toBeInTheDocument();
  });

  it('renders no banner when there are no pending memories and marks VIEWER read-only', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } });
    const proj = fullProject();
    proj.members[0]!.role = 'VIEWER';
    h.findUnique.mockResolvedValue(proj);
    h.count.mockResolvedValue(0);
    render(await BoardPage({ params }));
    expect(screen.queryByText(/memoria/)).not.toBeInTheDocument();
    expect(screen.getByTestId('board-client')).toHaveAttribute('data-canwrite', 'false');
  });
});
