import { beforeEach, describe, expect, it } from 'vitest';
import { registerProvisioningTools } from '../src/tools/provisioning.js';
import { collectTools, mockApi, type MockApi } from './helpers.js';

let api: MockApi;
let tools: ReturnType<typeof collectTools>;

beforeEach(() => {
  api = mockApi();
  tools = collectTools(registerProvisioningTools, api);
});

describe('provisioning tools', () => {
  it('registra las 4 tools', () => {
    expect([...tools.keys()].sort()).toEqual(
      ['apply_team_preset', 'provision_agent', 'provision_default_team', 'set_agent_model'].sort(),
    );
  });

  it('provision_default_team pega al preset con AXON_DEFAULT', async () => {
    api.post.mockResolvedValue({ ok: true, provisioned: 9 });
    await tools.get('provision_default_team')!.handler({ projectSlug: 'forgeia' });
    expect(api.post).toHaveBeenCalledWith('/projects/forgeia/agents/preset', { preset: 'AXON_DEFAULT' });
  });

  it('apply_team_preset pasa el preset elegido', async () => {
    api.post.mockResolvedValue({ ok: true });
    await tools.get('apply_team_preset')!.handler({ projectSlug: 'forgeia', preset: 'BALANCED' });
    expect(api.post).toHaveBeenCalledWith('/projects/forgeia/agents/preset', { preset: 'BALANCED' });
  });

  it('provision_agent envía rol + enable (+ modelo opcional)', async () => {
    api.post.mockResolvedValue({ ok: true });
    await tools.get('provision_agent')!.handler({ projectSlug: 'forgeia', role: 'QA', llmModel: 'claude-opus-4-8' });
    expect(api.post).toHaveBeenCalledWith('/projects/forgeia/agents', {
      role: 'QA',
      llmModel: 'claude-opus-4-8',
      enable: true,
    });
  });

  it('set_agent_model hace PATCH con el modelo', async () => {
    api.patch.mockResolvedValue({ ok: true });
    await tools.get('set_agent_model')!.handler({ projectSlug: 'forgeia', role: 'QA', llmModel: 'claude-opus-4-8' });
    expect(api.patch).toHaveBeenCalledWith('/projects/forgeia/agents', { role: 'QA', llmModel: 'claude-opus-4-8' });
  });
});
