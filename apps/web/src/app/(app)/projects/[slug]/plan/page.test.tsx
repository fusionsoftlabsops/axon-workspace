import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  count: vi.fn(() => Promise.resolve(0)),
  getOrCreatePlanAction: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/auth', () => ({ auth: m.auth }));
vi.mock('@/lib/db', () => ({
  prisma: { project: { findUnique: m.findUnique }, projectFile: { count: m.count } },
}));
vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: string, en: string) => en }));
vi.mock('next/navigation', () => ({ notFound: m.notFound }));
vi.mock('@/lib/actions/planning', () => ({ getOrCreatePlanAction: m.getOrCreatePlanAction }));
vi.mock('./PlanChat', () => ({
  PlanChat: ({ canWrite }: { canWrite: boolean }) => <div>planchat:{canWrite ? 'rw' : 'ro'}</div>,
}));

import Page from './page';

const params = (slug = 'p') => Promise.resolve({ slug });

beforeEach(() => {
  Object.values(m).forEach((fn) => (fn as any).mockReset?.());
  m.notFound.mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND');
  });
});

describe('PlanPage', () => {
  it('returns null when there is no session', async () => {
    m.auth.mockResolvedValue(null);
    const ui = await Page({ params: params() });
    expect(ui).toBeNull();
  });

  it('calls notFound when the project is missing', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue(null);
    await expect(Page({ params: params() })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(m.notFound).toHaveBeenCalled();
  });

  it('calls notFound when the user is not a member', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({ members: [] });
    await expect(Page({ params: params() })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders PlanChat with write access for a non-viewer', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({ members: [{ role: 'ADMIN' }] });
    m.getOrCreatePlanAction.mockResolvedValue({ ok: true, data: { status: 'READY' } });
    render(await Page({ params: params() }));
    expect(screen.getByText('planchat:rw')).toBeInTheDocument();
  });

  it('renders PlanChat read-only for a viewer', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({ members: [{ role: 'VIEWER' }] });
    m.getOrCreatePlanAction.mockResolvedValue({ ok: true, data: { status: 'READY' } });
    render(await Page({ params: params() }));
    expect(screen.getByText('planchat:ro')).toBeInTheDocument();
  });

  it('shows the action error when the plan cannot be loaded', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({ members: [{ role: 'ADMIN' }] });
    m.getOrCreatePlanAction.mockResolvedValue({ ok: false, error: 'load error' });
    render(await Page({ params: params() }));
    expect(screen.getByText('load error')).toBeInTheDocument();
  });

  it('shows a generic message when the action is ok but has no data', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({ members: [{ role: 'ADMIN' }] });
    m.getOrCreatePlanAction.mockResolvedValue({ ok: true, data: null });
    render(await Page({ params: params() }));
    expect(screen.getByText('Could not load the plan')).toBeInTheDocument();
  });
});
