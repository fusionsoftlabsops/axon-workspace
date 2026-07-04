import { beforeEach, describe, expect, it } from 'vitest';
import { registerPortfolioTools } from '../src/tools/portfolio.js';
import { collectTools, mockApi, parseText, type MockApi } from './helpers.js';

let api: MockApi;
let tools: ReturnType<typeof collectTools>;

beforeEach(() => {
  api = mockApi();
  tools = collectTools(registerPortfolioTools, api);
});

describe('portfolio tools (cartera multi-proyecto)', () => {
  it('registra las 5 tools', () => {
    expect([...tools.keys()].sort()).toEqual(
      ['get_plan', 'get_plan_chat', 'list_project_tasks', 'list_projects', 'post_plan_chat'].sort(),
    );
  });

  it('list_projects consulta /projects', async () => {
    api.get.mockResolvedValue({ projects: [{ slug: 'axon', role: 'OWNER' }] });
    const res = await tools.get('list_projects')!.handler({});
    expect(api.get).toHaveBeenCalledWith('/projects');
    expect(parseText(res)).toMatchObject({ projects: [{ slug: 'axon' }] });
  });

  it('list_project_tasks pasa project y state', async () => {
    api.get.mockResolvedValue({ tasks: [] });
    await tools.get('list_project_tasks')!.handler({ projectSlug: 'axon', state: 'Desarrollo' });
    expect(api.get).toHaveBeenCalledWith('/tasks?project=axon&state=Desarrollo');
    await tools.get('list_project_tasks')!.handler({ projectSlug: 'axon' });
    expect(api.get).toHaveBeenCalledWith('/tasks?project=axon');
  });

  it('get_plan y get_plan_chat pegan al endpoint del plan', async () => {
    api.get.mockResolvedValue({ status: 'PUBLISHED', messages: [] });
    await tools.get('get_plan')!.handler({ projectSlug: 'axon' });
    expect(api.get).toHaveBeenCalledWith('/projects/axon/plan/chat');
    await tools.get('get_plan_chat')!.handler({ projectSlug: 'axon', limit: 10 });
    expect(api.get).toHaveBeenCalledWith('/projects/axon/plan/chat?limit=10');
  });

  it('post_plan_chat envía el mensaje', async () => {
    api.post.mockResolvedValue({ ok: true, reply: { role: 'assistant', content: 'hola' } });
    await tools.get('post_plan_chat')!.handler({ projectSlug: 'axon', message: '@dax revisá la arquitectura' });
    expect(api.post).toHaveBeenCalledWith('/projects/axon/plan/chat', { message: '@dax revisá la arquitectura' });
  });
});
