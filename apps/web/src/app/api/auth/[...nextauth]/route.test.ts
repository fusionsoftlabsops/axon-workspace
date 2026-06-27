import { describe, it, expect, vi } from 'vitest';

const { getHandler, postHandler } = vi.hoisted(() => ({
  getHandler: vi.fn(),
  postHandler: vi.fn(),
}));
vi.mock('@/auth', () => ({ handlers: { GET: getHandler, POST: postHandler } }));

import { GET, POST } from './route';

describe('auth/[...nextauth] route', () => {
  it('re-exports the Auth.js GET/POST handlers', () => {
    expect(GET).toBe(getHandler);
    expect(POST).toBe(postHandler);
  });
});
