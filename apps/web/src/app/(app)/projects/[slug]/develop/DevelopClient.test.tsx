import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ createToken: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ children, href }: any) => <a href={href}>{children}</a> }));
vi.mock('@/lib/actions/fusion-code', () => ({ createProjectAgentTokenAction: h.createToken }));

import { DevelopClient, type DevelopHU } from './DevelopClient';

const hus: DevelopHU[] = [
  { number: 1, title: 'Login', state: 'To Do', done: false, sprint: 'S1' },
  { number: 2, title: 'Dashboard', state: 'Done', done: true, sprint: 'S1' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

function renderClient(over: Partial<React.ComponentProps<typeof DevelopClient>> = {}) {
  return render(
    <DevelopClient
      slug="my-proj"
      canGenerate
      fusionBase="https://infra.test"
      mcpUrl="https://mcp-axon.test/mcp"
      hus={hus}
      {...over}
    />,
  );
}

describe('DevelopClient', () => {
  it('shows the install one-liner and toggles OS', async () => {
    const user = userEvent.setup();
    renderClient();
    expect(screen.getByText(/curl -fsSL https:\/\/infra.test\/api\/coding-tools\/install.sh \| sh/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Windows' }));
    expect(screen.getByText(/irm https:\/\/infra.test\/api\/coding-tools\/install.ps1 \| iex/)).toBeInTheDocument();
  });

  it('falls back to manual instructions without a fusion base', () => {
    renderClient({ fusionBase: null });
    expect(screen.getByText(/Install Fusion Code from the platform/i)).toBeInTheDocument();
  });

  it('documents pulling the implementation plan and closing the HU', () => {
    renderClient();
    expect(screen.getByText(/Pull the implementation plan into Qwen/i)).toBeInTheDocument();
    expect(screen.getByText(/Close the story \(QA handoff\)/i)).toBeInTheDocument();
    // The close command + the MCP tool it calls are shown.
    expect(screen.getByText(/\/cerrar-hu 1/)).toBeInTheDocument();
    expect(screen.getAllByText(/submit_qa_review/).length).toBeGreaterThan(0);
  });

  it('generates a token and reveals the env line + config', async () => {
    const user = userEvent.setup();
    h.createToken.mockResolvedValue({
      ok: true,
      data: { plainToken: 'ad_pk_XYZ', mcpUrl: 'https://mcp-axon.test/mcp', projectSlug: 'my-proj' },
    });
    renderClient();
    await user.click(screen.getByRole('button', { name: /Generate project token/i }));
    expect(h.createToken).toHaveBeenCalledWith('my-proj');
    expect(await screen.findByText('AXON_API_TOKEN=ad_pk_XYZ')).toBeInTheDocument();
    expect(screen.getByText('{ "projectSlug": "my-proj" }')).toBeInTheDocument();
  });

  it('surfaces a token error', async () => {
    const user = userEvent.setup();
    h.createToken.mockResolvedValue({ ok: false, error: 'nope' });
    renderClient();
    await user.click(screen.getByRole('button', { name: /Generate project token/i }));
    expect(await screen.findByText('nope')).toBeInTheDocument();
  });

  it('lists HUs with their /task command per row', () => {
    renderClient();
    const loginRow = screen.getByText('Login').closest('tr')!;
    expect(within(loginRow).getByText('/task 1')).toBeInTheDocument();
    expect(within(loginRow).getByRole('button', { name: /Copy \/task/i })).toBeInTheDocument();
    const dashRow = screen.getByText('Dashboard').closest('tr')!;
    expect(within(dashRow).getByText('/task 2')).toBeInTheDocument();
  });

  it('disables token generation for viewers', () => {
    renderClient({ canGenerate: false });
    expect(screen.getByRole('button', { name: /Generate project token/i })).toBeDisabled();
  });

  it('prompts to publish a plan when there are no HUs', () => {
    renderClient({ hus: [] });
    expect(screen.getByText(/No stories yet/i)).toBeInTheDocument();
  });
});
