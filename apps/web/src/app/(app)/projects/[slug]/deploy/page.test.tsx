import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  getDeployViewAction: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/auth', () => ({ auth: m.auth }));
vi.mock('@/lib/db', () => ({ prisma: { project: { findUnique: m.findUnique } } }));
vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: string, en: string) => en }));
vi.mock('next/navigation', () => ({ notFound: m.notFound }));
vi.mock('@/lib/actions/deploy', () => ({ getDeployViewAction: m.getDeployViewAction }));
vi.mock('./DeployClient', () => ({
  DeployClient: ({ slug }: { slug: string }) => <div>deployclient:{slug}</div>,
}));

import Page from './page';

const params = (slug = 'p') => Promise.resolve({ slug });

beforeEach(() => {
  Object.values(m).forEach((fn) => (fn as any).mockReset?.());
  m.notFound.mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND');
  });
});

describe('DeployPage', () => {
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

  it('renders the client with the loaded view', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({ members: [{ role: 'ADMIN' }] });
    m.getDeployViewAction.mockResolvedValue({ ok: true, data: { configured: true } });
    render(await Page({ params: params('axon') }));
    expect(screen.getByText('deployclient:axon')).toBeInTheDocument();
  });

  it('shows the action error when the view cannot be loaded', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({ members: [{ role: 'ADMIN' }] });
    m.getDeployViewAction.mockResolvedValue({ ok: false, error: 'boom' });
    render(await Page({ params: params() }));
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('shows a generic message when ok but no data', async () => {
    m.auth.mockResolvedValue({ user: { id: 'u1' } });
    m.findUnique.mockResolvedValue({ members: [{ role: 'ADMIN' }] });
    m.getDeployViewAction.mockResolvedValue({ ok: true, data: null });
    render(await Page({ params: params() }));
    expect(screen.getByText('Could not load deployment')).toBeInTheDocument();
  });
});
