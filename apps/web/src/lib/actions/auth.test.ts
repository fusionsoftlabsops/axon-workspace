import { describe, it, expect, vi, beforeEach } from 'vitest';

const { signInMock, signOutMock, redirectMock } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  signOutMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/auth', () => ({ signIn: signInMock, signOut: signOutMock }));

import { ssoLoginAction, logoutAction } from './auth';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ssoLoginAction', () => {
  it('inicia el login federado (authentik) hacia /projects', async () => {
    signInMock.mockResolvedValue(undefined);
    await ssoLoginAction();
    expect(signInMock).toHaveBeenCalledWith('authentik', { redirectTo: '/projects' });
  });
});

describe('logoutAction', () => {
  it('signs out and redirects to /login', async () => {
    signOutMock.mockResolvedValue(undefined);
    await logoutAction();
    expect(signOutMock).toHaveBeenCalledWith({ redirect: false });
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });
});
