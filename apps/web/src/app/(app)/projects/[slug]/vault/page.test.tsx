import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import VaultPage from './page';

const { auth, findProject, findCreds, notFound } = vi.hoisted(() => ({
  auth: vi.fn(),
  findProject: vi.fn(),
  findCreds: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));

vi.mock('next/navigation', () => ({ notFound }));
vi.mock('@/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: findProject },
    credential: { findMany: findCreds },
  },
}));
vi.mock('./VaultClient', () => ({
  VaultClient: (props: {
    isAdmin: boolean;
    canCreate: boolean;
    credentials: unknown[];
  }) => (
    <div data-testid="vault-client">
      admin:{String(props.isAdmin)} create:{String(props.canCreate)} creds:
      {props.credentials.length}
    </div>
  ),
}));

const params = (slug = 'p') => Promise.resolve({ slug });

beforeEach(() => vi.clearAllMocks());

describe('VaultPage', () => {
  it('returns null when unauthenticated', async () => {
    auth.mockResolvedValue(null);
    expect(await VaultPage({ params: params() })).toBeNull();
  });

  it('notFound when project missing or not a member', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    findProject.mockResolvedValue(null);
    await expect(VaultPage({ params: params() })).rejects.toThrow('NOT_FOUND');

    findProject.mockResolvedValue({ id: 'pj', members: [] });
    await expect(VaultPage({ params: params() })).rejects.toThrow('NOT_FOUND');
  });

  it('renders VaultClient with admin + mapped credentials (OWNER)', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    findProject.mockResolvedValue({ id: 'pj', members: [{ role: 'OWNER' }] });
    findCreds.mockResolvedValue([
      {
        id: 'c1',
        name: 'tok',
        type: 'API_KEY',
        metadataPublic: { username: 'bob' },
        createdAt: new Date('2026-01-01T00:00:00Z'),
        createdById: 'u1',
        needsRotation: false,
        access: [{ userId: 'u1', user: { id: 'u1', name: 'Bob', email: 'b@x.com' } }],
      },
      {
        id: 'c2',
        name: 'note',
        type: 'NOTE',
        metadataPublic: null,
        createdAt: new Date('2026-01-02T00:00:00Z'),
        createdById: 'u2',
        needsRotation: true,
        access: [],
      },
    ]);
    render(await VaultPage({ params: params() }));
    const client = screen.getByTestId('vault-client');
    expect(client).toHaveTextContent('admin:true');
    expect(client).toHaveTextContent('create:true');
    expect(client).toHaveTextContent('creds:2');
  });

  it('VIEWER is not admin and cannot create', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    findProject.mockResolvedValue({ id: 'pj', members: [{ role: 'VIEWER' }] });
    findCreds.mockResolvedValue([]);
    render(await VaultPage({ params: params() }));
    const client = screen.getByTestId('vault-client');
    expect(client).toHaveTextContent('admin:false');
    expect(client).toHaveTextContent('create:false');
  });

  it('ADMIN role is admin', async () => {
    auth.mockResolvedValue({ user: { id: 'u1' } });
    findProject.mockResolvedValue({ id: 'pj', members: [{ role: 'ADMIN' }] });
    findCreds.mockResolvedValue([]);
    render(await VaultPage({ params: params() }));
    expect(screen.getByTestId('vault-client')).toHaveTextContent('admin:true');
  });
});
