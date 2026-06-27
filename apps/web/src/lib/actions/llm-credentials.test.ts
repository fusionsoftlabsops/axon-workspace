import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, auditMock, revalidateMock, createMock, listMock, revokeMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  auditMock: vi.fn(),
  revalidateMock: vi.fn(),
  createMock: vi.fn(),
  listMock: vi.fn(),
  revokeMock: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('@/lib/llm-credentials/store', () => ({
  createLlmCredential: createMock,
  listLlmCredentialsForUser: listMock,
  revokeLlmCredential: revokeMock,
}));

import {
  createLlmCredentialAction,
  revokeLlmCredentialAction,
  listMyLlmCredentialsAction,
} from './llm-credentials';

const validInput = { provider: 'ANTHROPIC' as const, label: 'key', plainKey: '12345678' };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u1' } });
});

describe('createLlmCredentialAction', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await createLlmCredentialAction(validInput)).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects invalid input', async () => {
    const res = await createLlmCredentialAction({ provider: 'ANTHROPIC', label: '', plainKey: '1' } as never);
    expect(res).toEqual({ ok: false, error: 'Datos inválidos' });
  });

  it('creates the credential, audits and revalidates', async () => {
    createMock.mockResolvedValue({ id: 'c1', keyPrefix: 'sk-1' });
    const res = await createLlmCredentialAction(validInput);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', provider: 'ANTHROPIC', label: 'key' }),
    );
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'llm_credential.create' }));
    expect(revalidateMock).toHaveBeenCalledWith('/settings/llm-credentials');
    expect(res).toEqual({ ok: true, id: 'c1', keyPrefix: 'sk-1' });
  });

  it('returns the error message when the store throws', async () => {
    createMock.mockRejectedValue(new Error('store fail'));
    expect(await createLlmCredentialAction(validInput)).toEqual({ ok: false, error: 'store fail' });
  });

  it('falls back to a generic message for non-Error throws', async () => {
    createMock.mockRejectedValue('weird');
    const res = await createLlmCredentialAction(validInput);
    expect(res).toEqual({ ok: false, error: 'no se pudo guardar la credencial' });
  });
});

describe('revokeLlmCredentialAction', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await revokeLlmCredentialAction('c1')).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects when not found or no permission', async () => {
    revokeMock.mockResolvedValue({ ok: false });
    expect(await revokeLlmCredentialAction('c1')).toEqual({
      ok: false,
      error: 'no encontrada o sin permisos',
    });
  });

  it('revokes, audits and revalidates', async () => {
    revokeMock.mockResolvedValue({ ok: true });
    const res = await revokeLlmCredentialAction('c1');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'llm_credential.revoke' }));
    expect(res).toEqual({ ok: true });
  });
});

describe('listMyLlmCredentialsAction', () => {
  it('returns [] when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await listMyLlmCredentialsAction()).toEqual([]);
  });

  it('returns the store list for the user', async () => {
    listMock.mockResolvedValue([{ id: 'c1' }]);
    expect(await listMyLlmCredentialsAction()).toEqual([{ id: 'c1' }]);
    expect(listMock).toHaveBeenCalledWith('u1');
  });
});
