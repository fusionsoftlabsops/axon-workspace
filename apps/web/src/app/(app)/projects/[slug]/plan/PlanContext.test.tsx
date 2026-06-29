import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/i18n/i18n', () => ({ useI18n: () => ({ t: (_es: unknown, en: unknown) => en }) }));

const h = vi.hoisted(() => ({
  getAnalysisAction: vi.fn(),
  analyzeProjectAction: vi.fn(),
  setPlanContextGraphAction: vi.fn(),
}));

vi.mock('@/lib/actions/analysis', () => ({
  getAnalysisAction: h.getAnalysisAction,
  analyzeProjectAction: h.analyzeProjectAction,
}));
vi.mock('@/lib/actions/planning', () => ({ setPlanContextGraphAction: h.setPlanContextGraphAction }));
vi.mock('./AnalysisPanel', () => ({
  AnalysisPanelView: () => <div data-testid="analysis-panel" />,
}));

import { PlanContext } from './PlanContext';

type View = Record<string, unknown>;
function view(over: View = {}): View {
  return { configured: true, status: 'READY', stats: { nodes: 10, edges: 20, communities: 3 }, godNodes: [], analyzableRepoCount: 1, ...over };
}

beforeEach(() => {
  h.getAnalysisAction.mockReset();
  h.analyzeProjectAction.mockReset();
  h.setPlanContextGraphAction.mockReset();
});

describe('PlanContext', () => {
  // The two radios both contain "code graph" in their accessible name, so match
  // on a phrase unique to each option's description.
  const codeRadio = () => screen.getByRole('radio', { name: /knowledge graph/i });
  const noneRadio = () => screen.getByRole('radio', { name: /context files still apply/i });

  it('offers both graph options and shows a live connection when the code graph is ready', async () => {
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view() });
    render(<PlanContext slug="p" canWrite contextGraph={null} onChange={() => {}} />);

    expect(await screen.findByRole('radiogroup')).toBeInTheDocument();
    expect(codeRadio()).toBeChecked();
    expect(noneRadio()).not.toBeChecked();
    // null contextGraph defaults to the code graph → connected + stats.
    expect(screen.getByText(/Connected/)).toBeInTheDocument();
    expect(screen.getByText(/10 nodes · 20 edges · 3 areas/)).toBeInTheDocument();
    expect(screen.getByTestId('analysis-panel')).toBeInTheDocument();
  });

  it('switches the grounding graph and propagates the updated plan', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view() });
    h.setPlanContextGraphAction.mockResolvedValue({ ok: true, data: { contextGraph: 'NONE' } });
    render(<PlanContext slug="p" canWrite contextGraph={null} onChange={onChange} />);

    await screen.findByRole('radiogroup');
    await user.click(noneRadio());
    expect(h.setPlanContextGraphAction).toHaveBeenCalledWith('p', 'NONE');
    expect(onChange).toHaveBeenCalledWith({ contextGraph: 'NONE' });
  });

  it('surfaces an error when saving the choice fails', async () => {
    const user = userEvent.setup();
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view() });
    h.setPlanContextGraphAction.mockResolvedValue({ ok: false, error: 'no perms' });
    render(<PlanContext slug="p" canWrite contextGraph="CODE_GRAPH" onChange={() => {}} />);

    await screen.findByRole('radiogroup');
    await user.click(noneRadio());
    expect(await screen.findByText('no perms')).toBeInTheDocument();
  });

  it('shows how many project files feed the plan and links to Files', async () => {
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view() });
    render(<PlanContext slug="p" canWrite contextGraph={null} contextFileCount={3} onChange={() => {}} />);
    expect(await screen.findByText(/3 context files feed this plan/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Manage in Files/i })).toHaveAttribute('href', '/projects/p/files');
  });

  it('shows the "no graph yet" hint when no analysis exists', async () => {
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view({ status: 'NONE', stats: {} }) });
    render(<PlanContext slug="p" canWrite contextGraph={null} onChange={() => {}} />);
    expect(await screen.findByText(/No graph yet/i)).toBeInTheDocument();
  });

  it('hides the graph chooser (but keeps the file-context line + panel) when graphify is not configured', async () => {
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view({ configured: false }) });
    render(<PlanContext slug="p" canWrite contextGraph={null} onChange={() => {}} />);
    // Wait for the settled section (its file-context line is unique to it).
    expect(await screen.findByText(/context files/i)).toBeInTheDocument();
    expect(screen.getByTestId('analysis-panel')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('disables the radios for viewers', async () => {
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view() });
    render(<PlanContext slug="p" canWrite={false} contextGraph={null} onChange={() => {}} />);
    await screen.findByRole('radiogroup');
    expect(codeRadio()).toBeDisabled();
    expect(noneRadio()).toBeDisabled();
  });
});
