import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  buildTaskDigest: vi.fn(),
  invokeAi: vi.fn(),
}));
vi.mock('./digest', () => ({ buildTaskDigest: deps.buildTaskDigest }));
vi.mock('@/lib/ai/router', () => ({ invokeAi: deps.invokeAi }));

import { extractMemoriesFromTask } from './extractor';

const DIGEST = { taskId: 't1', taskNumber: 1, projectSlug: 'AXON', digest: 'some digest' };

const validDraft = {
  type: 'DECISION',
  title: 'Use Postgres',
  body: 'We chose Postgres for FTS.',
  tags: ['db'],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractMemoriesFromTask', () => {
  it('returns empty drafts when the digest is null', async () => {
    deps.buildTaskDigest.mockResolvedValue(null);
    const res = await extractMemoriesFromTask('t1', 'u1');
    expect(res).toEqual({ drafts: [], model: '', estimatedCostUsd: 0, rawOutput: '' });
    expect(deps.invokeAi).not.toHaveBeenCalled();
  });

  it('parses a clean JSON array of drafts', async () => {
    deps.buildTaskDigest.mockResolvedValue(DIGEST);
    deps.invokeAi.mockResolvedValue({
      output: JSON.stringify([validDraft]),
      model: 'claude-sonnet-4-6',
      estimatedCostUsd: 0.002,
    });
    const res = await extractMemoriesFromTask('t1', 'u1');
    expect(res.model).toBe('claude-sonnet-4-6');
    expect(res.estimatedCostUsd).toBe(0.002);
    expect(res.drafts).toHaveLength(1);
    expect(res.drafts[0]).toMatchObject({ type: 'DECISION', title: 'Use Postgres', tags: ['db'] });
  });

  it('strips a ```json code fence before parsing', async () => {
    deps.buildTaskDigest.mockResolvedValue(DIGEST);
    deps.invokeAi.mockResolvedValue({
      output: '```json\n' + JSON.stringify([validDraft]) + '\n```',
      model: 'm',
      estimatedCostUsd: 0,
    });
    const res = await extractMemoriesFromTask('t1', 'u1');
    expect(res.drafts).toHaveLength(1);
  });

  it('defaults tags to [] when omitted', async () => {
    deps.buildTaskDigest.mockResolvedValue(DIGEST);
    const { tags: _omit, ...noTags } = validDraft;
    deps.invokeAi.mockResolvedValue({
      output: JSON.stringify([noTags]),
      model: 'm',
      estimatedCostUsd: 0,
    });
    const res = await extractMemoriesFromTask('t1', 'u1');
    expect(res.drafts[0]!.tags).toEqual([]);
  });

  it('returns [] drafts when JSON is malformed (keeps model/cost/raw)', async () => {
    deps.buildTaskDigest.mockResolvedValue(DIGEST);
    deps.invokeAi.mockResolvedValue({ output: 'not json {', model: 'm', estimatedCostUsd: 0.5 });
    const res = await extractMemoriesFromTask('t1', 'u1');
    expect(res.drafts).toEqual([]);
    expect(res.model).toBe('m');
    expect(res.rawOutput).toBe('not json {');
  });

  it('returns [] drafts when the array is empty string after cleaning', async () => {
    deps.buildTaskDigest.mockResolvedValue(DIGEST);
    deps.invokeAi.mockResolvedValue({ output: '   ', model: 'm', estimatedCostUsd: 0 });
    expect((await extractMemoriesFromTask('t1', 'u1')).drafts).toEqual([]);
  });

  it('rejects a batch that violates the schema (e.g. >10 items)', async () => {
    deps.buildTaskDigest.mockResolvedValue(DIGEST);
    deps.invokeAi.mockResolvedValue({
      output: JSON.stringify(Array.from({ length: 11 }, () => validDraft)),
      model: 'm',
      estimatedCostUsd: 0,
    });
    expect((await extractMemoriesFromTask('t1', 'u1')).drafts).toEqual([]);
  });

  it('degrades gracefully when invokeAi throws (Error)', async () => {
    deps.buildTaskDigest.mockResolvedValue(DIGEST);
    deps.invokeAi.mockRejectedValue(new Error('no api key'));
    const res = await extractMemoriesFromTask('t1', 'u1');
    expect(res.drafts).toEqual([]);
    expect(res.model).toBe('');
    expect(res.rawOutput).toContain('EXTRACTION_FAILED: no api key');
  });

  it('degrades gracefully when invokeAi throws a non-Error', async () => {
    deps.buildTaskDigest.mockResolvedValue(DIGEST);
    deps.invokeAi.mockRejectedValue('overloaded');
    const res = await extractMemoriesFromTask('t1', 'u1');
    expect(res.rawOutput).toContain('EXTRACTION_FAILED: overloaded');
  });
});
