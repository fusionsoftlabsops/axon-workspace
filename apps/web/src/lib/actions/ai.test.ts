import { describe, it, expect, vi, beforeEach } from 'vitest';

const { auditMock, assertMock, invokeAiMock } = vi.hoisted(() => ({
  auditMock: vi.fn(),
  assertMock: vi.fn(),
  invokeAiMock: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: assertMock }));
vi.mock('@/lib/ai/router', () => ({ invokeAi: invokeAiMock }));

import { invokeAiAction } from './ai';

const okCtx = { ok: true, userId: 'u1', projectId: 'p1', role: 'OWNER' as const };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('invokeAiAction', () => {
  it('rejects invalid input before checking membership', async () => {
    const res = await invokeAiAction('slug', { purpose: 'nope', context: 'x' } as never);
    expect(res).toEqual({ ok: false, error: 'Datos inválidos' });
    expect(assertMock).not.toHaveBeenCalled();
  });

  it('propagates the membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'Proyecto no encontrado' });
    const res = await invokeAiAction('slug', { purpose: 'task.draft', context: 'hi' });
    expect(res).toEqual({ ok: false, error: 'Proyecto no encontrado' });
  });

  it('invokes the AI and returns the result + audits', async () => {
    assertMock.mockResolvedValue(okCtx);
    invokeAiMock.mockResolvedValue({ output: 'out', model: 'opus', estimatedCostUsd: 0.5 });
    const res = await invokeAiAction('slug', { purpose: 'task.draft', context: 'hi' });
    expect(invokeAiMock).toHaveBeenCalledWith({
      purpose: 'task.draft',
      context: 'hi',
      userId: 'u1',
      projectId: 'p1',
    });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ai.invoke', actorId: 'u1', projectId: 'p1' }),
    );
    expect(res).toEqual({ ok: true, output: 'out', model: 'opus', estimatedCostUsd: 0.5 });
  });

  it('returns the error message when invokeAi throws an Error', async () => {
    assertMock.mockResolvedValue(okCtx);
    invokeAiMock.mockRejectedValue(new Error('boom'));
    const res = await invokeAiAction('slug', { purpose: 'task.draft', context: 'hi' });
    expect(res).toEqual({ ok: false, error: 'boom' });
  });

  it('falls back to a generic message for non-Error throws', async () => {
    assertMock.mockResolvedValue(okCtx);
    invokeAiMock.mockRejectedValue('weird');
    const res = await invokeAiAction('slug', { purpose: 'task.draft', context: 'hi' });
    expect(res).toEqual({ ok: false, error: 'Error de IA' });
  });
});
