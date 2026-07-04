import { beforeEach, describe, expect, it } from 'vitest';
import { registerSupervisorTools } from '../src/tools/supervisor.js';
import { collectTools, mockApi, parseText, type MockApi } from './helpers.js';

let api: MockApi;
let tools: ReturnType<typeof collectTools>;

beforeEach(() => {
  api = mockApi();
  tools = collectTools(registerSupervisorTools, api);
});

describe('supervisor tools (orquestación desde consola)', () => {
  it('registra las 4 tools', () => {
    expect([...tools.keys()].sort()).toEqual(
      ['assign_task', 'list_agent_runs', 'retrigger_task', 'set_agent_enabled'].sort(),
    );
  });

  it('list_agent_runs consulta con limit y filtro de status', async () => {
    api.get.mockResolvedValue({ runs: [{ role: 'DEV', status: 'BUDGET_EXCEEDED', storyNumber: 28 }] });
    const res = await tools.get('list_agent_runs')!.handler({ projectSlug: 'axon', limit: 10, status: 'BUDGET_EXCEEDED' });
    expect(api.get).toHaveBeenCalledWith('/projects/axon/agent-runs-list?limit=10&status=BUDGET_EXCEEDED');
    expect(parseText(res)).toMatchObject({ runs: [{ status: 'BUDGET_EXCEEDED' }] });
  });

  it('assign_task redirecciona por rol, owner y/o estado', async () => {
    api.patch.mockResolvedValue({ ok: true });
    await tools.get('assign_task')!.handler({ projectSlug: 'axon', taskNumber: 28, toRole: 'QA', toState: 'Verificación' });
    expect(api.patch).toHaveBeenCalledWith('/projects/axon/tasks/28', {
      toState: 'Verificación',
      assignToAgentRole: 'QA',
    });
    await tools.get('assign_task')!.handler({ projectSlug: 'axon', taskNumber: 29, toOwner: true });
    expect(api.patch).toHaveBeenCalledWith('/projects/axon/tasks/29', { assignToOwner: true });
  });

  it('assign_task exige al menos un destino', async () => {
    await expect(tools.get('assign_task')!.handler({ projectSlug: 'axon', taskNumber: 1 })).rejects.toThrow();
  });

  it('retrigger_task pega al endpoint con force', async () => {
    api.post.mockResolvedValue({ ok: true, refired: 'story.created' });
    await tools.get('retrigger_task')!.handler({ projectSlug: 'axon', taskNumber: 26, force: true });
    expect(api.post).toHaveBeenCalledWith('/projects/axon/tasks/26/retrigger', { force: true });
  });

  it('set_agent_enabled apaga/prende por rol', async () => {
    api.patch.mockResolvedValue({ ok: true, role: 'DEV', enabled: false });
    const res = await tools.get('set_agent_enabled')!.handler({ projectSlug: 'axon', role: 'DEV', enabled: false });
    expect(api.patch).toHaveBeenCalledWith('/projects/axon/agents', { role: 'DEV', enabled: false });
    expect(parseText(res)).toMatchObject({ enabled: false });
  });
});
