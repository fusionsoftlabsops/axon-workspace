import { beforeEach, describe, expect, it } from 'vitest';
import { registerTeamTools } from '../src/tools/team.js';
import { collectTools, mockApi, parseText, type MockApi } from './helpers.js';

let api: MockApi;
let tools: ReturnType<typeof collectTools>;

beforeEach(() => {
  api = mockApi();
  tools = collectTools(registerTeamTools, api);
});

describe('team tools (integración de consola)', () => {
  it('registra las 4 tools del modo híbrido', () => {
    expect([...tools.keys()].sort()).toEqual(
      ['generate_impl_plan', 'get_team_chat', 'list_dev_queue', 'post_team_chat'].sort(),
    );
  });

  it('get_team_chat lista con limit', async () => {
    api.get.mockResolvedValue({ messages: [{ body: '🤖 QA rechazó la HU #7' }] });
    const res = await tools.get('get_team_chat')!.handler({ projectSlug: 'axon', limit: 5 });
    expect(api.get).toHaveBeenCalledWith('/projects/axon/team-chat?limit=5');
    expect(parseText(res)).toMatchObject({ messages: [{ body: expect.stringContaining('QA rechazó') }] });
  });

  it('post_team_chat publica con storyNumber opcional', async () => {
    api.post.mockResolvedValue({ message: { id: 'm1' } });
    await tools.get('post_team_chat')!.handler({ projectSlug: 'axon', body: 'Tomo la HU #7 desde mi consola', storyNumber: 7 });
    expect(api.post).toHaveBeenCalledWith('/projects/axon/team-chat', {
      body: 'Tomo la HU #7 desde mi consola',
      storyNumber: 7,
    });
  });

  it('list_dev_queue filtra las HUs EN CURSO', async () => {
    api.get.mockResolvedValue({
      tasks: [
        { number: 7, title: 'A', state: 'Desarrollo', stateCategory: 'IN_PROGRESS', assignee: null },
        { number: 8, title: 'B', state: 'Preparación', stateCategory: 'TODO', assignee: null },
      ],
    });
    const res = await tools.get('list_dev_queue')!.handler({ projectSlug: 'axon' });
    expect(parseText(res)).toMatchObject({ count: 1, queue: [{ number: 7 }] });
  });

  it('generate_impl_plan pega al endpoint impl-plan', async () => {
    api.post.mockResolvedValue({ ok: true, implPlan: '# Plan' });
    const res = await tools.get('generate_impl_plan')!.handler({ projectSlug: 'axon', taskNumber: 7 });
    expect(api.post).toHaveBeenCalledWith('/projects/axon/tasks/7/impl-plan', { lang: 'es' });
    expect(parseText(res)).toMatchObject({ implPlan: '# Plan' });
  });
});
