import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  provisionAgentAction: vi.fn(),
  setAgentEnabledAction: vi.fn(),
  updateAgentAction: vi.fn(),
}));
vi.mock('@/lib/actions/agents', () => ({ ...h }));

import { AgentsClient } from './AgentsClient';
import type { AgentRunView, AgentView } from '@/lib/actions/agents';

const DEV: AgentView = {
  id: 'ag-dev',
  role: 'DEV',
  name: 'Kai',
  displayName: 'Kai · DEV',
  llmModel: 'qwen3-coder-next',
  tokenBudget: 200000,
  enabled: false,
  tokenPrefix: 'ad_pk_dev123',
  createdAt: '2026-07-03T00:00:00Z',
};

const RUN: AgentRunView = {
  id: 'r1',
  role: 'DEV',
  storyNumber: 13,
  storyTitle: 'HU 13',
  status: 'SUCCEEDED',
  promptTokens: 1000,
  completionTokens: 500,
  costUsd: '0.01',
  error: null,
  startedAt: '2026-07-03T10:00:00Z',
  finishedAt: '2026-07-03T10:05:00Z',
};

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
});

describe('AgentsClient', () => {
  it('lista agentes existentes, roles faltantes y corridas', () => {
    render(<AgentsClient slug="axon" canManage initialAgents={[DEV]} initialRuns={[RUN]} />);
    expect(screen.getByText('Kai · DEV')).toBeInTheDocument();
    expect(screen.getByTestId('provision-SM')).toBeInTheDocument();
    expect(screen.getByTestId('provision-QA')).toBeInTheDocument();
    expect(screen.queryByTestId('provision-DEV')).toBeNull();
    expect(screen.getByText('#13')).toBeInTheDocument();
    expect(screen.getByText('1500')).toBeInTheDocument();
  });

  it('aprovisiona un rol y muestra el token UNA vez', async () => {
    const user = userEvent.setup();
    h.provisionAgentAction.mockResolvedValue({
      ok: true,
      data: { agents: [DEV], tokenPlain: 'ad_pk_NUEVO_TOKEN' },
    });
    render(<AgentsClient slug="axon" canManage initialAgents={[]} initialRuns={[]} />);
    await user.click(screen.getByTestId('provision-DEV'));
    expect(h.provisionAgentAction).toHaveBeenCalledWith('axon', { role: 'DEV', llmModel: 'qwen3-coder-next' });
    expect(screen.getByTestId('minted-token')).toHaveTextContent('ad_pk_NUEVO_TOKEN');
    await user.click(screen.getByRole('button', { name: /Entendido|Got it/ }));
    expect(screen.queryByTestId('minted-token')).toBeNull();
  });

  it('activa/desactiva (kill-switch) y guarda config', async () => {
    const user = userEvent.setup();
    h.setAgentEnabledAction.mockResolvedValue({ ok: true, data: [{ ...DEV, enabled: true }] });
    h.updateAgentAction.mockResolvedValue({ ok: true, data: [{ ...DEV, tokenBudget: 50000 }] });
    render(<AgentsClient slug="axon" canManage initialAgents={[DEV]} initialRuns={[]} />);

    await user.click(screen.getByTestId('toggle-DEV'));
    expect(h.setAgentEnabledAction).toHaveBeenCalledWith('axon', 'ag-dev', true);

    const budget = screen.getByLabelText('budget-DEV');
    await user.clear(budget);
    await user.type(budget, '50000');
    await user.click(screen.getByRole('button', { name: /Guardar|Save/ }));
    expect(h.updateAgentAction).toHaveBeenCalledWith('axon', 'ag-dev', {
      llmModel: 'qwen3-coder-next',
      tokenBudget: 50000,
      displayName: 'Kai',
    });
  });

  it('muestra errores de las acciones y oculta gestión sin permisos', async () => {
    const user = userEvent.setup();
    h.provisionAgentAction.mockResolvedValue({ ok: false, error: 'Solo OWNER/ADMIN' });
    const { rerender } = render(<AgentsClient slug="axon" canManage initialAgents={[]} initialRuns={[]} />);
    await user.click(screen.getByTestId('provision-SM'));
    expect(screen.getByText('Solo OWNER/ADMIN')).toBeInTheDocument();

    rerender(<AgentsClient slug="axon" canManage={false} initialAgents={[DEV]} initialRuns={[]} />);
    expect(screen.queryByTestId('provision-SM')).toBeNull();
    expect(screen.queryByTestId('toggle-DEV')).toBeNull();
  });
});
