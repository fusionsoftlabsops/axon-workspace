import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock('next/navigation', () => ({ redirect: h.redirect }));

import ProjectIndexPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProjectIndexPage', () => {
  it('redirects to the board for the resolved slug', async () => {
    await ProjectIndexPage({ params: Promise.resolve({ slug: 'demo' }) });
    expect(h.redirect).toHaveBeenCalledWith('/projects/demo/board');
  });
});
