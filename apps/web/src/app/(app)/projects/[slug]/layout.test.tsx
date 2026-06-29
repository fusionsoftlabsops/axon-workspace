import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/auth', () => ({ auth: h.auth }));
vi.mock('@/lib/db', () => ({ prisma: { project: { findUnique: h.findUnique } } }));
vi.mock('@/lib/i18n/server', () => ({
  getServerT: async () => (_es: unknown, en: unknown) => en,
}));
vi.mock('next/navigation', () => ({
  notFound: h.notFound,
  usePathname: () => '/projects/demo/plan',
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

import ProjectLayout from './layout';

const params = Promise.resolve({ slug: 'demo' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProjectLayout', () => {
  it('returns null without a session', async () => {
    h.auth.mockResolvedValue(null);
    const { container } = render(await ProjectLayout({ children: <div />, params }));
    expect(container).toBeEmptyDOMElement();
  });

  it('calls notFound when the project is missing', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } });
    h.findUnique.mockResolvedValue(null);
    await expect(ProjectLayout({ children: <div />, params })).rejects.toThrow();
    expect(h.notFound).toHaveBeenCalled();
  });

  it('calls notFound when the user is not a member', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } });
    h.findUnique.mockResolvedValue({ name: 'P', slug: 'demo', members: [] });
    await expect(ProjectLayout({ children: <div />, params })).rejects.toThrow();
    expect(h.notFound).toHaveBeenCalled();
  });

  it('renders nav with management links for an OWNER', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } });
    h.findUnique.mockResolvedValue({
      name: 'Demo Project',
      slug: 'demo',
      members: [{ role: 'OWNER' }],
    });
    render(await ProjectLayout({ children: <div>child-content</div>, params }));
    expect(screen.getByRole('heading', { name: 'Demo Project' })).toBeInTheDocument();
    expect(screen.getByText('child-content')).toBeInTheDocument();
    expect(screen.getByText(/Settings/)).toBeInTheDocument();
    expect(screen.getByText(/Audit/)).toBeInTheDocument();
    expect(screen.getByText(/Board/)).toBeInTheDocument();
  });

  it('hides management links for a VIEWER', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } });
    h.findUnique.mockResolvedValue({
      name: 'Demo Project',
      slug: 'demo',
      members: [{ role: 'VIEWER' }],
    });
    render(await ProjectLayout({ children: <div />, params }));
    expect(screen.queryByText(/Settings/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Audit/)).not.toBeInTheDocument();
  });
});
