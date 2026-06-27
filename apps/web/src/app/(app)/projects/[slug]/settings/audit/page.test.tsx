import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/auth', () => ({ auth: m.auth }));
vi.mock('@/lib/db', () => ({
  prisma: { project: { findUnique: m.findUnique }, auditLog: { findMany: m.findMany } },
}));
vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: string, en: string) => en }));
vi.mock('next/navigation', () => ({ notFound: m.notFound }));

import Page from './page';

const params = (slug = 'p') => Promise.resolve({ slug });
const sp = (o: Record<string, string> = {}) => Promise.resolve(o);

beforeEach(() => {
  Object.values(m).forEach((fn) => (fn as any).mockReset?.());
  m.notFound.mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND');
  });
  m.findMany.mockResolvedValue([]);
});

describe('AuditPage', () => {
  it('returns null without a session', async () => {
    m.auth.mockResolvedValue(null);
    expect(await Page({ params: params(), searchParams: sp() })).toBeNull();
  });

  it('calls notFound when the project is missing', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue(null);
    await expect(Page({ params: params(), searchParams: sp() })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('calls notFound for a non-admin/owner member', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({ id: 'pr', members: [{ role: 'MEMBER' }] });
    await expect(Page({ params: params(), searchParams: sp() })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders the empty state with no events', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({ id: 'pr', members: [{ role: 'OWNER' }] });
    m.findMany.mockResolvedValue([]);
    render(await Page({ params: params(), searchParams: sp() }));
    expect(screen.getByText(/No events in the selected range/i)).toBeInTheDocument();
  });

  it('renders audit entries with actor, payload and known/unknown action labels', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({ id: 'pr', members: [{ role: 'ADMIN' }] });
    m.findMany.mockResolvedValue([
      {
        id: 'e1',
        createdAt: new Date('2024-01-01T10:00:00Z'),
        actor: { name: 'Ann', email: 'ann@x.com' },
        action: 'member.invite',
        resourceType: 'member',
        resourceId: 'abcdef123456',
        payload: { foo: 'bar' },
        ip: '1.2.3.4',
      },
      {
        id: 'e2',
        createdAt: new Date('2024-01-02T10:00:00Z'),
        actor: null,
        action: 'some.unknown.action',
        resourceType: 'thing',
        resourceId: 'zzzzzzzzzzzz',
        payload: null,
        ip: null,
      },
    ]);
    render(await Page({ params: params(), searchParams: sp() }));
    // "Member invited" appears both as a filter option and the action cell
    expect(screen.getAllByText('Member invited').length).toBeGreaterThan(1);
    expect(screen.getByText('some.unknown.action')).toBeInTheDocument();
    expect(screen.getByText('Ann')).toBeInTheDocument();
    expect(screen.getByText(/"foo":"bar"/)).toBeInTheDocument();
  });

  it('applies the action filter and clamps an out-of-range days value', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({ id: 'pr', members: [{ role: 'OWNER' }] });
    m.findMany.mockResolvedValue([]);
    render(await Page({ params: params(), searchParams: sp({ action: 'task.create', days: '1000' }) }));
    const where = m.findMany.mock.calls[0][0].where;
    expect(where.action).toBe('task.create');
    expect(screen.getByText(/Last 365 days/i)).toBeInTheDocument();
  });

  it('defaults to 7 days when days is not a number', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({ id: 'pr', members: [{ role: 'OWNER' }] });
    m.findMany.mockResolvedValue([]);
    render(await Page({ params: params(), searchParams: sp({ days: 'abc' }) }));
    expect(screen.getByText(/Last 7 days/i)).toBeInTheDocument();
  });
});
