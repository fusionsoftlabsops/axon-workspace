import { beforeEach, describe, expect, it } from 'vitest';
import { registerCommitTools } from '../src/tools/commits.js';
import { registerBugTools } from '../src/tools/bugs.js';
import { collectTools, mockApi, parseText, type MockApi } from './helpers.js';

describe('commit tools', () => {
  let api: MockApi;
  let tools: ReturnType<typeof collectTools>;
  beforeEach(() => {
    api = mockApi();
    tools = collectTools(registerCommitTools, api);
  });

  it('registers both commit tools', () => {
    expect([...tools.keys()].sort()).toEqual(
      ['generate_commit_message', 'generate_pr_description'].sort(),
    );
  });

  it('generate_commit_message: POSTs diffSummary and returns raw message text', async () => {
    api.post.mockResolvedValue({ message: 'feat: thing — PROJ-12' });
    const res = await tools
      .get('generate_commit_message')!
      .handler({ projectSlug: 'proj', taskNumber: 12, diffSummary: 'added 2fa' });
    expect(api.post).toHaveBeenCalledWith('/projects/proj/tasks/12/ai/commit-message', {
      diffSummary: 'added 2fa',
    });
    expect(res).toEqual({ content: [{ type: 'text', text: 'feat: thing — PROJ-12' }] });
  });

  it('generate_pr_description: forwards optional diffStats and returns description text', async () => {
    api.post.mockResolvedValue({ description: 'PR body' });
    const res = await tools
      .get('generate_pr_description')!
      .handler({ projectSlug: 'proj', taskNumber: 5, diffStats: '3 files' });
    expect(api.post).toHaveBeenCalledWith('/projects/proj/tasks/5/ai/pr-description', {
      diffStats: '3 files',
    });
    expect(res).toEqual({ content: [{ type: 'text', text: 'PR body' }] });
  });

  it('generate_pr_description: diffStats is optional', async () => {
    api.post.mockResolvedValue({ description: 'PR body' });
    await tools
      .get('generate_pr_description')!
      .handler({ projectSlug: 'proj', taskNumber: 5 });
    expect(api.post).toHaveBeenCalledWith('/projects/proj/tasks/5/ai/pr-description', {
      diffStats: undefined,
    });
  });

  it('rejects invalid args', async () => {
    await expect(
      tools.get('generate_commit_message')!.handler({ projectSlug: 'proj', taskNumber: 1 }),
    ).rejects.toThrow();
  });
});

describe('bug tools', () => {
  let api: MockApi;
  let tools: ReturnType<typeof collectTools>;
  beforeEach(() => {
    api = mockApi();
    tools = collectTools(registerBugTools, api);
  });

  it('registers report_bug', () => {
    expect([...tools.keys()]).toEqual(['report_bug']);
  });

  it('report_bug: POSTs the parsed payload with default priority HIGH', async () => {
    api.post.mockResolvedValue({ id: 'bug1', number: 9 });
    const res = await tools.get('report_bug')!.handler({
      projectSlug: 'proj',
      title: 'crash',
      description: 'it crashes',
    });
    expect(api.post).toHaveBeenCalledWith('/projects/proj/bugs', {
      projectSlug: 'proj',
      title: 'crash',
      description: 'it crashes',
      priority: 'HIGH',
    });
    expect(parseText(res)).toEqual({ id: 'bug1', number: 9 });
  });

  it('report_bug: rejects missing description', async () => {
    await expect(
      tools.get('report_bug')!.handler({ projectSlug: 'proj', title: 'x' }),
    ).rejects.toThrow();
  });
});
