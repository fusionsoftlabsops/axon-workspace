import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { findUnique, update, getDeployment, getApp } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  getDeployment: vi.fn(),
  getApp: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { deployment: { findUnique, update } },
}));
vi.mock('./fusion-client', () => ({ getDeployment, getApp }));

import { deriveState, pollDeployment, startPolling } from './poll';

const ROW = { id: 'row1', lastDeploymentId: 'd1', fusionAppId: 'a1', hostname: 'old.host', error: null };

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue(undefined);
});

describe('deriveState', () => {
  it('null → PENDING', () => {
    expect(deriveState(null)).toBe('PENDING');
  });
  it('QUEUED / IN_PROGRESS → BUILDING', () => {
    expect(deriveState({ operation: 'DEPLOY', status: 'QUEUED' })).toBe('BUILDING');
    expect(deriveState({ operation: 'DEPLOY', status: 'IN_PROGRESS' })).toBe('BUILDING');
  });
  it('FAILED / CANCELLED → FAILED', () => {
    expect(deriveState({ operation: 'DEPLOY', status: 'FAILED' })).toBe('FAILED');
    expect(deriveState({ operation: 'DEPLOY', status: 'CANCELLED' })).toBe('FAILED');
  });
  it('FINISHED + STOP/REMOVE → STOPPED', () => {
    expect(deriveState({ operation: 'STOP', status: 'FINISHED' })).toBe('STOPPED');
    expect(deriveState({ operation: 'REMOVE', status: 'FINISHED' })).toBe('STOPPED');
  });
  it('FINISHED + DEPLOY → LIVE', () => {
    expect(deriveState({ operation: 'DEPLOY', status: 'FINISHED' })).toBe('LIVE');
  });
});

describe('pollDeployment', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns immediately when the row is gone', async () => {
    findUnique.mockResolvedValue(null);
    const p = pollDeployment('row1', 't1');
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(getDeployment).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('returns when the row has no lastDeploymentId', async () => {
    findUnique.mockResolvedValue({ ...ROW, lastDeploymentId: null });
    const p = pollDeployment('row1', 't1');
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(getDeployment).not.toHaveBeenCalled();
  });

  it('terminal FINISHED: updates status LIVE + hostname from the app and returns', async () => {
    findUnique.mockResolvedValue(ROW);
    getDeployment.mockResolvedValue({ status: 'FINISHED', operation: 'DEPLOY', errorReason: null });
    getApp.mockResolvedValue({ hostname: 'new.host' });
    const p = pollDeployment('row1', 't1');
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(getApp).toHaveBeenCalledWith('a1', 't1');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'row1' },
      data: { status: 'LIVE', hostname: 'new.host', error: null },
    });
  });

  it('keeps the existing hostname when getApp fails', async () => {
    findUnique.mockResolvedValue(ROW);
    getDeployment.mockResolvedValue({ status: 'FINISHED', operation: 'DEPLOY', errorReason: null });
    getApp.mockRejectedValue(new Error('gone'));
    const p = pollDeployment('row1', 't1');
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(update).toHaveBeenCalledWith({
      where: { id: 'row1' },
      data: { status: 'LIVE', hostname: 'old.host', error: null },
    });
  });

  it('terminal FAILED: updates status FAILED with the error and does not fetch the app', async () => {
    findUnique.mockResolvedValue(ROW);
    getDeployment.mockResolvedValue({ status: 'FAILED', operation: 'DEPLOY', errorReason: 'build broke' });
    const p = pollDeployment('row1', 't1');
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(getApp).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'row1' },
      data: { status: 'FAILED', hostname: 'old.host', error: 'build broke' },
    });
  });

  it('FAILED with no errorReason keeps the row error', async () => {
    findUnique.mockResolvedValue({ ...ROW, error: 'previous failure' });
    getDeployment.mockResolvedValue({ status: 'FAILED', operation: 'DEPLOY', errorReason: null });
    const p = pollDeployment('row1', 't1');
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(update).toHaveBeenCalledWith({
      where: { id: 'row1' },
      data: { status: 'FAILED', hostname: 'old.host', error: 'previous failure' },
    });
  });

  it('swallows a transient getDeployment error and continues to the next tick', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    findUnique.mockResolvedValue(ROW);
    getDeployment
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue({ status: 'FINISHED', operation: 'DEPLOY', errorReason: null });
    getApp.mockResolvedValue({ hostname: 'new.host' });
    const p = pollDeployment('row1', 't1');
    await vi.advanceTimersByTimeAsync(5000); // tick 1: throws, swallowed
    await vi.advanceTimersByTimeAsync(5000); // tick 2: terminal
    await p;
    expect(errSpy).toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it('non-terminal tick updates BUILDING, then a later tick reaches terminal', async () => {
    findUnique.mockResolvedValue(ROW);
    getDeployment
      .mockResolvedValueOnce({ status: 'IN_PROGRESS', operation: 'DEPLOY', errorReason: null })
      .mockResolvedValue({ status: 'FINISHED', operation: 'DEPLOY', errorReason: null });
    getApp.mockResolvedValue({ hostname: 'new.host' });
    const p = pollDeployment('row1', 't1');
    await vi.advanceTimersByTimeAsync(5000); // BUILDING
    expect(update).toHaveBeenLastCalledWith({
      where: { id: 'row1' },
      data: { status: 'BUILDING', hostname: 'old.host', error: null },
    });
    await vi.advanceTimersByTimeAsync(5000); // LIVE, terminal
    await p;
    expect(update).toHaveBeenCalledTimes(2);
  });
});

describe('startPolling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires the poller and swallows a crash (findUnique rejecting)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    findUnique.mockRejectedValue(new Error('db down'));
    expect(() => startPolling('row1', 't1')).not.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.resolve();
    expect(errSpy).toHaveBeenCalledWith('[deploy] poller crashed:', expect.any(Error));
    errSpy.mockRestore();
  });
});
