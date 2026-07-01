import { beforeEach, describe, expect, it } from 'vitest';
import { registerSkillTools } from '../src/tools/skills.js';
import { collectTools, mockApi, parseText, type MockApi } from './helpers.js';

let api: MockApi;
let tools: ReturnType<typeof collectTools>;

beforeEach(() => {
  api = mockApi();
  tools = collectTools(registerSkillTools, api);
});

describe('skill tools', () => {
  it('registers list_skills and submit_skill', () => {
    expect([...tools.keys()].sort()).toEqual(['list_skills', 'submit_skill']);
  });

  it('list_skills: GETs the global endpoint, no filter', async () => {
    api.get.mockResolvedValue({ count: 0, skills: [] });
    const res = await tools.get('list_skills')!.handler({});
    expect(api.get).toHaveBeenCalledWith('/skills');
    expect(parseText(res)).toEqual({ count: 0, skills: [] });
  });

  it('list_skills: adds the category filter', async () => {
    api.get.mockResolvedValue({ count: 1, skills: [] });
    await tools.get('list_skills')!.handler({ category: 'TESTING' });
    expect(api.get).toHaveBeenCalledWith('/skills?category=TESTING');
  });

  it('list_skills: tolerates undefined args', async () => {
    api.get.mockResolvedValue({});
    await tools.get('list_skills')!.handler(undefined);
    expect(api.get).toHaveBeenCalledWith('/skills');
  });

  it('list_skills: rejects an invalid category', async () => {
    await expect(tools.get('list_skills')!.handler({ category: 'NOPE' })).rejects.toThrow();
  });

  it('submit_skill: POSTs the parsed skill', async () => {
    api.post.mockResolvedValue({ id: 's1', slug: 'my-skill', status: 'PENDING' });
    await tools.get('submit_skill')!.handler({
      slug: 'my-skill',
      name: 'My skill',
      description: 'does a thing',
      body: '# body',
    });
    expect(api.post).toHaveBeenCalledWith('/skills', {
      slug: 'my-skill',
      name: 'My skill',
      description: 'does a thing',
      body: '# body',
    });
  });

  it('submit_skill: rejects a non-kebab slug', async () => {
    await expect(
      tools.get('submit_skill')!.handler({ slug: 'Bad Slug', name: 'x', description: 'y', body: 'z' }),
    ).rejects.toThrow();
  });
});
