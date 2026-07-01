import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  projectFindUnique: vi.fn(),
  taskFindMany: vi.fn(),
  env: vi.fn(() => ({ FUSION_CODE_BASE_URL: 'https://infra.test', AXON_MCP_URL: 'https://mcp-axon.test/mcp' })),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/auth', () => ({ auth: m.auth }));
vi.mock('@/lib/db', () => ({
  prisma: { project: { findUnique: m.projectFindUnique }, task: { findMany: m.taskFindMany } },
}));
vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: string, en: string) => en }));
vi.mock('@/lib/env', () => ({ env: m.env }));
vi.mock('next/navigation', () => ({ notFound: m.notFound }));
vi.mock('@/components/ui', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  Eyebrow: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('./DevelopClient', () => ({
  DevelopClient: ({ hus, fusionBase }: { hus: unknown[]; fusionBase: string | null }) => (
    <div data-testid="client" data-count={hus.length} data-base={fusionBase ?? ''} />
  ),
}));

import Page from './page';

const params = (slug = 'p') => Promise.resolve({ slug });

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: 'u1' } });
  m.env.mockReturnValue({ FUSION_CODE_BASE_URL: 'https://infra.test', AXON_MCP_URL: 'https://mcp-axon.test/mcp' });
  m.taskFindMany.mockResolvedValue([
    { taskNumber: 1, title: 'Login', state: { name: 'To Do', category: 'TODO' }, sprint: { name: 'S1' } },
  ]);
});

describe('DevelopPage', () => {
  it('notFound when the user is not a member', async () => {
    m.projectFindUnique.mockResolvedValue({ id: 'pr', members: [] });
    await expect(Page({ params: params() })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders the guide with the project HUs for a member', async () => {
    m.projectFindUnique.mockResolvedValue({ id: 'pr', members: [{ role: 'ADMIN' }] });
    render(await Page({ params: params() }));
    expect(screen.getByText('Develop with Fusion Code')).toBeInTheDocument();
    const client = screen.getByTestId('client');
    expect(client).toHaveAttribute('data-count', '1');
    expect(client).toHaveAttribute('data-base', 'https://infra.test');
  });
});
