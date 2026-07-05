import { beforeEach, describe, expect, it } from 'vitest';
import { registerRepoTools } from '../src/tools/repos.js';
import { collectTools, mockApi, type MockApi } from './helpers.js';

let api: MockApi;
let tools: ReturnType<typeof collectTools>;

beforeEach(() => {
  api = mockApi();
  tools = collectTools(registerRepoTools, api);
});

describe('repo tools', () => {
  it('registra list_repos + link_repo', () => {
    expect([...tools.keys()].sort()).toEqual(['link_repo', 'list_repos']);
  });

  it('list_repos consulta el endpoint', async () => {
    api.get.mockResolvedValue({ repos: [] });
    await tools.get('list_repos')!.handler({ projectSlug: 'forgeia' });
    expect(api.get).toHaveBeenCalledWith('/projects/forgeia/repos');
  });

  it('link_repo postea name+url (+kind)', async () => {
    api.post.mockResolvedValue({ ok: true });
    await tools.get('link_repo')!.handler({
      projectSlug: 'forgeia',
      name: 'idea-forge-backend',
      url: 'https://github.com/fusionsoftlabsops/idea-forge-backend',
      kind: 'backend',
    });
    expect(api.post).toHaveBeenCalledWith('/projects/forgeia/repos', {
      name: 'idea-forge-backend',
      url: 'https://github.com/fusionsoftlabsops/idea-forge-backend',
      kind: 'backend',
    });
  });
});
