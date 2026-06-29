import { describe, it, expect } from 'vitest';
import { deriveProgress } from './progress';

const log = (text: string, stepId?: string) => ({ text, stepId: stepId ?? null });

describe('deriveProgress', () => {
  it('terminal statuses report 100% with the matching phase', () => {
    expect(deriveProgress('FINISHED', [log('ok')])).toMatchObject({ phase: 'done', percent: 100, lastLine: 'ok' });
    expect(deriveProgress('FAILED', [log('boom')])).toMatchObject({ phase: 'failed', percent: 100 });
    expect(deriveProgress('CANCELLED', [])).toMatchObject({ phase: 'cancelled', percent: 100, lastLine: null });
  });

  it('queued when there are no logs or no step ids', () => {
    expect(deriveProgress('QUEUED', [])).toMatchObject({ phase: 'queued', percent: 5 });
    expect(deriveProgress('IN_PROGRESS', [log('system line')])).toMatchObject({ phase: 'queued', percent: 5 });
  });

  it('maps the latest step id to a phase', () => {
    expect(deriveProgress('IN_PROGRESS', [log('a', 'login')])).toMatchObject({ phase: 'login', percent: 12 });
    expect(deriveProgress('IN_PROGRESS', [log('a', 'push')])).toMatchObject({ phase: 'publishing', percent: 78 });
    expect(deriveProgress('IN_PROGRESS', [log('a', 'prune')])).toMatchObject({ phase: 'pruning', percent: 88 });
    expect(deriveProgress('IN_PROGRESS', [log('a', 'run')])).toMatchObject({ phase: 'starting', percent: 94 });
    expect(deriveProgress('IN_PROGRESS', [log('a', 'pull')])).toMatchObject({ phase: 'pulling', percent: 40 });
    expect(deriveProgress('IN_PROGRESS', [log('a', 'stop')])).toMatchObject({ phase: 'stopping', percent: 60 });
  });

  it('uses the LAST step id when several are present', () => {
    const logs = [log('x', 'build'), log('y', 'push')];
    expect(deriveProgress('IN_PROGRESS', logs)).toMatchObject({ phase: 'publishing' });
  });

  it('creeps through the build phase by build-log count, capped at 72', () => {
    expect(deriveProgress('IN_PROGRESS', [log('b', 'build')]).percent).toBe(37);
    const many = Array.from({ length: 40 }, () => log('b', 'build'));
    expect(deriveProgress('IN_PROGRESS', many).percent).toBe(72);
  });

  it('falls back to building for an unknown step id', () => {
    expect(deriveProgress('IN_PROGRESS', [log('a', 'mystery')])).toMatchObject({ phase: 'building', percent: 30 });
  });

  it('returns the last line as live detail', () => {
    expect(deriveProgress('IN_PROGRESS', [log('first', 'build'), log('latest', 'build')]).lastLine).toBe('latest');
  });
});
