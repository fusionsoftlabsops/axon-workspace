import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: h.auth }));
vi.mock('@/lib/db', () => ({ prisma: { project: { findMany: h.findMany } } }));
vi.mock('@/lib/i18n/server', () => ({
  getServerT: async () => (_es: unknown, en: unknown) => en,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/ui', () => ({
  Eyebrow: ({ children }: any) => <span>{children}</span>,
}));
vi.mock('./NewProjectForm', () => ({
  NewProjectForm: () => <div data-testid="new-project-form" />,
}));

import ProjectsPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProjectsPage', () => {
  it('returns null when there is no session', async () => {
    h.auth.mockResolvedValue(null);
    const { container } = render(await ProjectsPage());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the catalog with project cards, status badges and meta', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } });
    h.findMany.mockResolvedValue([
      {
        id: 'p1',
        slug: 'alpha',
        name: 'Alpha',
        description: 'first project',
        status: 'PAUSED',
        _count: { tasks: 3, members: 2 },
        members: [{ role: 'OWNER' }],
      },
      {
        id: 'p2',
        slug: 'beta',
        name: 'Beta',
        description: null,
        status: 'ACTIVE',
        _count: { tasks: 0, members: 1 },
        members: [{ role: 'ADMIN' }],
      },
      {
        id: 'p3',
        slug: 'gamma',
        name: 'Gamma',
        description: 'done one',
        status: 'COMPLETED',
        _count: { tasks: 5, members: 4 },
        members: [{ role: 'VIEWER' }],
      },
    ]);

    render(await ProjectsPage());

    expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();
    // status badges (only non-active lifecycle ones render)
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    // description present for p1, absent for p2
    expect(screen.getByText('first project')).toBeInTheDocument();
    // singular vs plural member label
    expect(screen.getByText('member')).toBeInTheDocument();
    expect(screen.getAllByText('members').length).toBeGreaterThan(0);
    // slug code
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByTestId('new-project-form')).toBeInTheDocument();
  });

  it('renders with no projects', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } });
    h.findMany.mockResolvedValue([]);
    render(await ProjectsPage());
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByTestId('new-project-form')).toBeInTheDocument();
  });
});
