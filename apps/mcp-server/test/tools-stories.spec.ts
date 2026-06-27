import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerStoryTools } from '../src/tools/stories.js';
import { collectTools, mockApi, parseText, type MockApi } from './helpers.js';

let api: MockApi;
let tools: ReturnType<typeof collectTools>;

beforeEach(() => {
  api = mockApi();
  tools = collectTools(registerStoryTools, api);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('story tools', () => {
  it('registers all six story tools', () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        'draft_user_story',
        'get_story_draft',
        'grep_repo',
        'list_repo_tree',
        'list_story_drafts',
        'publish_story_draft',
      ].sort(),
    );
  });

  it('get_story_draft: GETs the draft by id', async () => {
    api.get.mockResolvedValue({ id: 'd1', status: 'READY' });
    const res = await tools
      .get('get_story_draft')!
      .handler({ projectSlug: 'proj', draftId: 'd1' });
    expect(api.get).toHaveBeenCalledWith('/projects/proj/stories/drafts/d1');
    expect(parseText(res)).toEqual({ id: 'd1', status: 'READY' });
  });

  it('list_story_drafts: GETs the drafts collection', async () => {
    api.get.mockResolvedValue([{ id: 'd1' }]);
    await tools.get('list_story_drafts')!.handler({ projectSlug: 'proj' });
    expect(api.get).toHaveBeenCalledWith('/projects/proj/stories/drafts');
  });

  it('publish_story_draft: POSTs stateId with default empty subtasks', async () => {
    api.post.mockResolvedValue({ taskId: 't1' });
    await tools
      .get('publish_story_draft')!
      .handler({ projectSlug: 'proj', draftId: 'd1', stateId: 's1' });
    expect(api.post).toHaveBeenCalledWith('/projects/proj/stories/drafts/d1/publish', {
      stateId: 's1',
      includeSubtasks: [],
      finalTitle: undefined,
      finalDescription: undefined,
    });
  });

  it('publish_story_draft: forwards subtasks and overrides', async () => {
    api.post.mockResolvedValue({ taskId: 't1' });
    await tools.get('publish_story_draft')!.handler({
      projectSlug: 'proj',
      draftId: 'd1',
      stateId: 's1',
      includeSubtasks: [0, 2],
      finalTitle: 'Title',
      finalDescription: 'Body',
    });
    expect(api.post).toHaveBeenCalledWith('/projects/proj/stories/drafts/d1/publish', {
      stateId: 's1',
      includeSubtasks: [0, 2],
      finalTitle: 'Title',
      finalDescription: 'Body',
    });
  });

  it('list_repo_tree: no params -> bare tree path', async () => {
    api.get.mockResolvedValue({ tree: [] });
    await tools.get('list_repo_tree')!.handler({ projectSlug: 'proj' });
    expect(api.get).toHaveBeenCalledWith('/projects/proj/repo/tree');
  });

  it('list_repo_tree: builds root and depth query', async () => {
    api.get.mockResolvedValue({ tree: [] });
    await tools
      .get('list_repo_tree')!
      .handler({ projectSlug: 'proj', root: 'src', depth: 3 });
    expect(api.get).toHaveBeenCalledWith('/projects/proj/repo/tree?root=src&depth=3');
  });

  it('grep_repo: POSTs pattern with default empty scope', async () => {
    api.post.mockResolvedValue({ hits: [] });
    await tools.get('grep_repo')!.handler({ projectSlug: 'proj', pattern: 'TODO' });
    expect(api.post).toHaveBeenCalledWith('/projects/proj/repo/grep', {
      pattern: 'TODO',
      scope: [],
    });
  });

  it('grep_repo: forwards scope', async () => {
    api.post.mockResolvedValue({ hits: [] });
    await tools
      .get('grep_repo')!
      .handler({ projectSlug: 'proj', pattern: 'TODO', scope: ['src'] });
    expect(api.post).toHaveBeenCalledWith('/projects/proj/repo/grep', {
      pattern: 'TODO',
      scope: ['src'],
    });
  });

  const baseDraftArgs = {
    projectSlug: 'proj',
    rawInput: 'a long enough natural language need',
    provider: 'ANTHROPIC',
    model: 'claude-x',
    credentialId: 'cred1',
  };

  it('draft_user_story: creates draft then returns once status is READY', async () => {
    vi.useFakeTimers();
    api.post.mockResolvedValue({ ok: true, draftId: 'd9' });
    api.get.mockResolvedValue({ status: 'READY', summary: 'done' });

    const p = tools
      .get('draft_user_story')!
      .handler({ ...baseDraftArgs, pollIntervalMs: 1000, maxWaitMs: 10_000 });
    await vi.advanceTimersByTimeAsync(1000);
    const res = await p;

    expect(api.post).toHaveBeenCalledWith('/projects/proj/stories/drafts', {
      rawInput: baseDraftArgs.rawInput,
      provider: 'ANTHROPIC',
      model: 'claude-x',
      credentialId: 'cred1',
      selectedPaths: [],
      citedMemoryIds: [],
    });
    expect(api.get).toHaveBeenCalledWith('/projects/proj/stories/drafts/d9');
    expect(parseText(res)).toMatchObject({ draftId: 'd9', status: 'READY', summary: 'done' });
  });

  it('draft_user_story: returns an error result when no draftId comes back', async () => {
    api.post.mockResolvedValue({ ok: false });
    const res = await tools.get('draft_user_story')!.handler({ ...baseDraftArgs });
    expect(parseText(res)).toMatchObject({ error: 'no draftId returned' });
    expect(api.get).not.toHaveBeenCalled();
  });

  it('draft_user_story: returns TIMEOUT when the draft never settles', async () => {
    vi.useFakeTimers();
    api.post.mockResolvedValue({ ok: true, draftId: 'd9' });
    api.get.mockResolvedValue({ status: 'PENDING' });

    const p = tools
      .get('draft_user_story')!
      .handler({ ...baseDraftArgs, pollIntervalMs: 2000, maxWaitMs: 5000 });
    await vi.advanceTimersByTimeAsync(6000);
    const res = await p;

    expect(parseText(res)).toMatchObject({
      draftId: 'd9',
      status: 'TIMEOUT',
      partial: { status: 'PENDING' },
    });
  });

  it('draft_user_story: rejects too-short rawInput', async () => {
    await expect(
      tools.get('draft_user_story')!.handler({ ...baseDraftArgs, rawInput: 'short' }),
    ).rejects.toThrow();
  });
});
