import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  projectFindUnique: vi.fn(),
  fileFindMany: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  lastProps: null as Record<string, unknown> | null,
}));
vi.mock('@/auth', () => ({ auth: h.auth }));
vi.mock('@/lib/db', () => ({
  prisma: { project: { findUnique: h.projectFindUnique }, projectFile: { findMany: h.fileFindMany } },
}));
vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: unknown, en: unknown) => en }));
vi.mock('next/navigation', () => ({ notFound: h.notFound }));
vi.mock('./FilesClient', () => ({
  FilesClient: (props: Record<string, unknown>) => {
    h.lastProps = props;
    return <div data-testid="files-client" />;
  },
}));

import Page from './page';

const params = Promise.resolve({ slug: 'proj' });

describe('FilesPage', () => {
  beforeEach(() => {
    h.auth.mockReset();
    h.projectFindUnique.mockReset();
    h.fileFindMany.mockReset();
    h.notFound.mockClear();
    h.lastProps = null;
    h.auth.mockResolvedValue({ user: { id: 'u1' } });
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'OWNER' }] });
    h.fileFindMany.mockResolvedValue([]);
  });

  it('returns null when unauthenticated', async () => {
    h.auth.mockResolvedValue(null);
    expect(await Page({ params })).toBeNull();
  });

  it('calls notFound when project missing', async () => {
    h.projectFindUnique.mockResolvedValue(null);
    await expect(Page({ params })).rejects.toThrow();
    expect(h.notFound).toHaveBeenCalled();
  });

  it('calls notFound when not a member', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [] });
    await expect(Page({ params })).rejects.toThrow();
  });

  it('renders FilesClient with mapped files', async () => {
    h.fileFindMany.mockResolvedValue([
      {
        id: 'f1',
        name: 'a.png',
        mimeType: 'image/png',
        size: 10,
        category: 'IMAGE',
        createdAt: new Date('2024-01-01'),
        uploadedById: 'u1',
        uploadedBy: { name: 'Alice' },
      },
    ]);
    render(await Page({ params }));
    expect(screen.getByTestId('files-client')).toBeInTheDocument();
    expect((h.lastProps?.files as unknown[]).length).toBe(1);
    expect(h.lastProps?.role).toBe('OWNER');
    expect((h.lastProps?.files as Array<Record<string, unknown>>)[0]!.uploaderName).toBe('Alice');
  });
});
