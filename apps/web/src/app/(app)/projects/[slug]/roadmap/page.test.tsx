import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/auth', () => ({ auth: m.auth }));
vi.mock('@/lib/db', () => ({
  prisma: { project: { findUnique: m.findUnique }, projectPlan: { findFirst: m.findFirst } },
}));
vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: string, en: string) => en }));
vi.mock('next/navigation', () => ({ notFound: m.notFound }));
vi.mock('next/link', () => ({ default: ({ children, href }: any) => <a href={href}>{children}</a> }));

import Page from './page';

const params = (slug = 'p') => Promise.resolve({ slug });

function task(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    taskNumber: 1,
    title: 'Task one',
    category: 'backend',
    estimate: '2d',
    priority: 'HIGH',
    recommendedRoles: ['be'],
    ...over,
  };
}

beforeEach(() => {
  Object.values(m).forEach((fn) => (fn as any).mockReset?.());
  m.notFound.mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND');
  });
  m.findFirst.mockResolvedValue(null);
});

describe('RoadmapPage', () => {
  it('returns null without a session', async () => {
    m.auth.mockResolvedValue(null);
    expect(await Page({ params: params() })).toBeNull();
  });

  it('calls notFound when the project is missing', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue(null);
    await expect(Page({ params: params() })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows the empty state when there are no sprints', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({ id: 'pr', members: [{ role: 'ADMIN' }], sprints: [] });
    render(await Page({ params: params() }));
    expect(screen.getByText(/No published plan yet/i)).toBeInTheDocument();
  });

  it('shows the empty state when sprints have no tasks', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({
      id: 'pr',
      members: [{ role: 'ADMIN' }],
      sprints: [{ id: 's1', name: 'S1', goal: 'g', tasks: [] }],
    });
    render(await Page({ params: params() }));
    expect(screen.getByText(/No published plan yet/i)).toBeInTheDocument();
  });

  it('renders the grid with lanes, tasks and suggested repos', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({
      id: 'pr',
      members: [{ role: 'ADMIN' }],
      sprints: [
        {
          id: 's1',
          name: 'Sprint 1',
          goal: 'goal one',
          tasks: [
            task({ id: 'a', category: 'backend', title: 'BE task' }),
            task({ id: 'b', category: null, title: 'Misc task', estimate: null, recommendedRoles: [] }),
            task({ id: 'c', category: 'frontend', title: 'FE task' }),
          ],
        },
      ],
    });
    m.findFirst.mockResolvedValue({
      suggestedRepos: [{ name: 'api', kind: 'backend', stack: 'node', reason: 'core' }],
    });
    render(await Page({ params: params() }));
    expect(screen.getByText('Sprint 1')).toBeInTheDocument();
    expect(screen.getByText('BE task')).toBeInTheDocument();
    expect(screen.getByText('Misc task')).toBeInTheDocument();
    expect(screen.getByText('Backend')).toBeInTheDocument();
    expect(screen.getByText('Suggested repositories')).toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();
  });

  it('renders the grid without the repos section when there are none', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({
      id: 'pr',
      members: [{ role: 'ADMIN' }],
      sprints: [{ id: 's1', name: 'S1', goal: '', tasks: [task()] }],
    });
    m.findFirst.mockResolvedValue(null);
    render(await Page({ params: params() }));
    expect(screen.queryByText('Suggested repositories')).toBeNull();
    expect(screen.getByText('Task one')).toBeInTheDocument();
  });
});
