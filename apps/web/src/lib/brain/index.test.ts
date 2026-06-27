import { describe, expect, it, vi } from 'vitest';

// The barrel pulls in modules that touch prisma / the AI router at import time
// only through functions, but mock db to keep the import side-effect-free.
vi.mock('@/lib/db', () => ({ prisma: {} }));

import * as brain from './index';

describe('brain barrel', () => {
  it('re-exports the public surface', () => {
    expect(typeof brain.buildTaskDigest).toBe('function');
    expect(typeof brain.extractMemoriesFromTask).toBe('function');
    expect(typeof brain.searchBrain).toBe('function');
    expect(typeof brain.isStale).toBe('function');
    expect(typeof brain.pullProjectBrain).toBe('function');
    expect(typeof brain.citeMemory).toBe('function');
  });
});
