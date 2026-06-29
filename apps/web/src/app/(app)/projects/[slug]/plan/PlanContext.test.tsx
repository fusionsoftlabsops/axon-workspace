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
  it('offers both graph options and shows a live connection when the code graph is ready', async () => {
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view() });
    render(<PlanContext slug="p" canWrite contextGraph={null} onChange={() => {}} />);

    expect(await screen.findByRole('radio', { name: /Code graph/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /No context/i })).not.toBeChecked();
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

    await user.click(await screen.findByRole('radio', { name: /No context/i }));
    expect(h.setPlanContextGraphAction).toHaveBeenCalledWith('p', 'NONE');
    expect(onChange).toHaveBeenCalledWith({ contextGraph: 'NONE' });
  });

  it('surfaces an error when saving the choice fails', async () => {
    const user = userEvent.setup();
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view() });
    h.setPlanContextGraphAction.mockResolvedValue({ ok: false, error: 'no perms' });
    render(<PlanContext slug="p" canWrite contextGraph="CODE_GRAPH" onChange={() => {}} />);

    await user.click(await screen.findByRole('radio', { name: /No context/i }));
    expect(await screen.findByText('no perms')).toBeInTheDocument();
  });

  it('shows the "no graph yet" hint when no analysis exists', async () => {
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view({ status: 'NONE', stats: {} }) });
    render(<PlanContext slug="p" canWrite contextGraph={null} onChange={() => {}} />);
    expect(await screen.findByText(/No graph yet/i)).toBeInTheDocument();
  });

  it('renders only the panel (no chooser) when graphify is not configured', async () => {
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view({ configured: false }) });
    render(<PlanContext slug="p" canWrite contextGraph={null} onChange={() => {}} />);
    expect(await screen.findByTestId('analysis-panel')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('disables the radios for viewers', async () => {
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view() });
    render(<PlanContext slug="p" canWrite={false} contextGraph={null} onChange={() => {}} />);
    expect(await screen.findByRole('radio', { name: /Code graph/i })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /No context/i })).toBeDisabled();
  });
});
