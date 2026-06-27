import { beforeEach, describe, expect, it } from 'vitest';
import { registerBrainTools } from '../src/tools/brain.js';
import { collectTools, mockApi, parseText, type MockApi } from './helpers.js';

let api: MockApi;
let tools: ReturnType<typeof collectTools>;

beforeEach(() => {
  api = mockApi();
  tools = collectTools(registerBrainTools, api);
});

describe('brain tools', () => {
  it('registers all six brain tools', () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        'capture_memory',
        'cite_memory',
        'extract_memories_from_task',
        'publish_memory',
        'pull_project_brain',
        'recall',
      ].sort(),
    );
  });

  it('recall: no query/limit -> bare recall path', async () => {
    api.get.mockResolvedValue([]);
    await tools.get('recall')!.handler({ projectSlug: 'proj' });
    expect(api.get).toHaveBeenCalledWith('/projects/proj/brain/recall');
  });

  it('recall: builds q and limit query params', async () => {
    api.get.mockResolvedValue([{ id: 'm1' }]);
    const res = await tools
      .get('recall')!
      .handler({ projectSlug: 'proj', query: 'auth', limit: 5 });
    expect(api.get).toHaveBeenCalledWith('/projects/proj/brain/recall?q=auth&limit=5');
    expect(parseText(res)).toEqual([{ id: 'm1' }]);
  });

  it('pull_project_brain: GETs the pull path', async () => {
    api.get.mockResolvedValue({ news: [] });
    await tools.get('pull_project_brain')!.handler({ projectSlug: 'proj' });
    expect(api.get).toHaveBeenCalledWith('/projects/proj/brain/pull');
  });

  it('cite_memory: POSTs taskNumber and context', async () => {
    api.post.mockResolvedValue({ ok: true });
    await tools.get('cite_memory')!.handler({
      projectSlug: 'proj',
      memoryId: 'mem1',
      taskNumber: 8,
      context: 'used for X',
    });
    expect(api.post).toHaveBeenCalledWith('/projects/proj/brain/memories/mem1/cite', {
      taskNumber: 8,
      context: 'used for X',
    });
  });

  it('capture_memory: defaults tags=[] and scope=LOCAL when not publishing', async () => {
    api.post.mockResolvedValue({ id: 'mem2' });
    await tools.get('capture_memory')!.handler({
      projectSlug: 'proj',
      type: 'DECISION',
      title: 'Chose X',
      body: 'because Y',
    });
    expect(api.post).toHaveBeenCalledWith('/projects/proj/brain/memories', {
      type: 'DECISION',
      title: 'Chose X',
      body: 'because Y',
      tags: [],
      scope: 'LOCAL',
      sourceTaskNumber: undefined,
    });
  });

  it('capture_memory: scope=PROJECT when publishImmediately and forwards tags + source', async () => {
    api.post.mockResolvedValue({ id: 'mem3' });
    await tools.get('capture_memory')!.handler({
      projectSlug: 'proj',
      type: 'PATTERN',
      title: 'Pattern',
      body: 'body',
      tags: ['a', 'b'],
      sourceTaskNumber: 4,
      publishImmediately: true,
    });
    expect(api.post).toHaveBeenCalledWith('/projects/proj/brain/memories', {
      type: 'PATTERN',
      title: 'Pattern',
      body: 'body',
      tags: ['a', 'b'],
      scope: 'PROJECT',
      sourceTaskNumber: 4,
    });
  });

  it('publish_memory: POSTs empty body to publish path', async () => {
    api.post.mockResolvedValue({ ok: true });
    await tools.get('publish_memory')!.handler({ projectSlug: 'proj', memoryId: 'mem1' });
    expect(api.post).toHaveBeenCalledWith('/projects/proj/brain/memories/mem1/publish', {});
  });

  it('extract_memories_from_task: POSTs taskNumber', async () => {
    api.post.mockResolvedValue({ candidates: [] });
    await tools
      .get('extract_memories_from_task')!
      .handler({ projectSlug: 'proj', taskNumber: 11 });
    expect(api.post).toHaveBeenCalledWith('/projects/proj/brain/extract', { taskNumber: 11 });
  });

  it('rejects an invalid memory type', async () => {
    await expect(
      tools.get('capture_memory')!.handler({
        projectSlug: 'proj',
        type: 'BOGUS',
        title: 't',
        body: 'b',
      }),
    ).rejects.toThrow();
  });
});
