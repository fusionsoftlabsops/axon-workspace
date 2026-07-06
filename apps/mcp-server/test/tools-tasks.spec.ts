import { beforeEach, describe, expect, it } from 'vitest';
import { registerTaskTools } from '../src/tools/tasks.js';
import { collectTools, mockApi, parseText, type MockApi } from './helpers.js';

let api: MockApi;
let tools: ReturnType<typeof collectTools>;

beforeEach(() => {
  api = mockApi();
  tools = collectTools(registerTaskTools, api);
});

describe('task tools', () => {
  it('registers all task tools', () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        'add_comment',
        'create_task',
        'get_task',
        'list_my_tasks',
        'set_story_content',
        'submit_qa_review',
        'update_task_status',
      ].sort(),
    );
  });

  it('list_my_tasks: assignedToMe only when no filters', async () => {
    api.get.mockResolvedValue([{ id: 1 }]);
    const res = await tools.get('list_my_tasks')!.handler({});
    expect(api.get).toHaveBeenCalledWith('/tasks?assignedToMe=true');
    expect(parseText(res)).toEqual([{ id: 1 }]);
  });

  it('list_my_tasks: adds project and state query params', async () => {
    api.get.mockResolvedValue([]);
    await tools.get('list_my_tasks')!.handler({ projectSlug: 'proj', state: 'Done' });
    expect(api.get).toHaveBeenCalledWith('/tasks?assignedToMe=true&project=proj&state=Done');
  });

  it('list_my_tasks: tolerates undefined args', async () => {
    api.get.mockResolvedValue([]);
    await tools.get('list_my_tasks')!.handler(undefined);
    expect(api.get).toHaveBeenCalledWith('/tasks?assignedToMe=true');
  });

  it('get_task: builds the project/task path', async () => {
    api.get.mockResolvedValue({ number: 42 });
    const res = await tools.get('get_task')!.handler({ projectSlug: 'proj', taskNumber: 42 });
    expect(api.get).toHaveBeenCalledWith('/projects/proj/tasks/42');
    expect(parseText(res)).toEqual({ number: 42 });
  });

  it('get_task: rejects invalid args via zod', async () => {
    await expect(
      tools.get('get_task')!.handler({ projectSlug: 'proj', taskNumber: -1 }),
    ).rejects.toThrow();
  });

  it('update_task_status: PATCHes toState', async () => {
    api.patch.mockResolvedValue({ ok: true });
    await tools
      .get('update_task_status')!
      .handler({ projectSlug: 'proj', taskNumber: 7, toState: 'Dev' });
    expect(api.patch).toHaveBeenCalledWith('/projects/proj/tasks/7', { toState: 'Dev' });
  });

  it('create_task: POSTs the parsed input with default priority', async () => {
    api.post.mockResolvedValue({ id: 'x' });
    await tools.get('create_task')!.handler({ projectSlug: 'proj', title: 'Do it' });
    expect(api.post).toHaveBeenCalledWith('/projects/proj/tasks', {
      projectSlug: 'proj',
      title: 'Do it',
      priority: 'MEDIUM',
    });
  });

  it('create_task: rejects an empty title', async () => {
    await expect(
      tools.get('create_task')!.handler({ projectSlug: 'proj', title: '' }),
    ).rejects.toThrow();
  });

  it('add_comment: POSTs the comment body', async () => {
    api.post.mockResolvedValue({ id: 'c1' });
    await tools
      .get('add_comment')!
      .handler({ projectSlug: 'proj', taskNumber: 3, body: 'progress note' });
    expect(api.post).toHaveBeenCalledWith('/projects/proj/tasks/3/comments', {
      body: 'progress note',
    });
  });

  it('submit_qa_review: POSTs the handoff to the qa-review endpoint', async () => {
    api.post.mockResolvedValue({ ok: true, movedToVerification: true });
    await tools.get('submit_qa_review')!.handler({
      projectSlug: 'proj',
      taskNumber: 9,
      criteria: [{ text: 'works', met: true }],
      suggestedTests: ['login ok'],
      executedTasks: ['form', 'endpoint'],
      notes: 'context',
    });
    expect(api.post).toHaveBeenCalledWith('/projects/proj/tasks/9/qa-review', {
      criteria: [{ text: 'works', met: true }],
      suggestedTests: ['login ok'],
      executedTasks: ['form', 'endpoint'],
      notes: 'context',
    });
  });

  it('submit_qa_review: rejects an invalid criterion', async () => {
    await expect(
      tools.get('submit_qa_review')!.handler({
        projectSlug: 'proj',
        taskNumber: 9,
        criteria: [{ text: 'x' }],
      }),
    ).rejects.toThrow();
  });
});
