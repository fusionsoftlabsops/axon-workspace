import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  getAnalysisAction: vi.fn(),
  analyzeProjectAction: vi.fn(),
}));

vi.mock('@/lib/actions/analysis', () => ({
  getAnalysisAction: h.getAnalysisAction,
  analyzeProjectAction: h.analyzeProjectAction,
}));

import { AnalysisPanel } from './AnalysisPanel';

type View = Record<string, unknown>;

function view(over: View = {}): View {
  return {
    configured: true,
    status: 'IDLE',
    stats: {},
    analyzableRepoCount: 1,
    godNodes: [],
    ...over,
  };
}

beforeEach(() => {
  h.getAnalysisAction.mockReset();
  h.analyzeProjectAction.mockReset();
});

describe('AnalysisPanel', () => {
  it('renders nothing when there is no view', async () => {
    h.getAnalysisAction.mockResolvedValue({ ok: false });
    const { container } = render(<AnalysisPanel slug="p" canWrite />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the quiet hint when graphify is not configured', async () => {
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view({ configured: false }) });
    render(<AnalysisPanel slug="p" canWrite />);
    expect(await screen.findByText(/not configured on this instance/i)).toBeInTheDocument();
  });

  it('renders the idle state with an action button and the link-repos hint', async () => {
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view({ analyzableRepoCount: 0 }) });
    render(<AnalysisPanel slug="p" canWrite />);
    expect(await screen.findByRole('button', { name: /Analyze existing project/i })).toBeDisabled();
    expect(screen.getByText(/Link at least one repo/i)).toBeInTheDocument();
  });

  it('hides the action button when canWrite is false', async () => {
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view() });
    render(<AnalysisPanel slug="p" canWrite={false} />);
    await screen.findByText('Code analysis');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders ready state with stats, summary, backend and key concepts', async () => {
    h.getAnalysisAction.mockResolvedValue({
      ok: true,
      data: view({
        status: 'READY',
        backend: 'neo4j',
        summary: 'A summary',
        stats: { nodes: 10, edges: 20, communities: 3 },
        godNodes: [{ label: 'Auth' }, { label: 'DB' }],
      }),
    });
    render(<AnalysisPanel slug="p" canWrite />);
    expect(await screen.findByText(/Plan grounded in real code/i)).toBeInTheDocument();
    expect(screen.getByText(/neo4j/)).toBeInTheDocument();
    expect(screen.getByText('A summary')).toBeInTheDocument();
    expect(screen.getByText(/Auth · DB/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Re-analyze/i })).toBeEnabled();
  });

  it('renders ready state with fallback stats and no optional sections', async () => {
    h.getAnalysisAction.mockResolvedValue({
      ok: true,
      data: view({ status: 'READY', stats: {}, godNodes: [] }),
    });
    render(<AnalysisPanel slug="p" canWrite />);
    expect(await screen.findByText(/\? nodes/)).toBeInTheDocument();
  });

  it('renders failed state with the error message', async () => {
    h.getAnalysisAction.mockResolvedValue({
      ok: true,
      data: view({ status: 'FAILED', error: 'kaboom' }),
    });
    render(<AnalysisPanel slug="p" canWrite />);
    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('kaboom')).toBeInTheDocument();
  });

  it.each([
    ['cloning', /Cloning repos/i],
    ['extracting', /Extracting & analyzing/i],
    ['building', /Building the graph/i],
    ['unknown', /Analyzing…/],
  ])('renders analyzing progress for phase %s', async (phase, re) => {
    h.getAnalysisAction.mockResolvedValue({
      ok: true,
      data: view({
        status: 'ANALYZING',
        stats: { phase, percent: 42, chunksTotal: 8, chunksDone: 2, repo: 'svc' },
      }),
    });
    render(<AnalysisPanel slug="p" canWrite />);
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getAllByText(re).length).toBeGreaterThan(0);
    expect(screen.getByText(/\(2\/8\)/)).toBeInTheDocument();
  });

  it('renders analyzing progress with no percent and clamps nothing', async () => {
    h.getAnalysisAction.mockResolvedValue({
      ok: true,
      data: view({ status: 'ANALYZING', stats: { phase: 'building' } }),
    });
    render(<AnalysisPanel slug="p" canWrite />);
    const bar = await screen.findByRole('progressbar');
    expect(bar).not.toHaveAttribute('aria-valuenow');
  });

  it('polls again while analyzing', async () => {
    vi.useFakeTimers();
    h.getAnalysisAction.mockResolvedValue({
      ok: true,
      data: view({ status: 'ANALYZING', stats: { phase: 'cloning' }, updatedAt: 1 }),
    });
    render(<AnalysisPanel slug="p" canWrite />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.getAnalysisAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(h.getAnalysisAction).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('runs analysis successfully and updates the view', async () => {
    const user = userEvent.setup();
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view() });
    h.analyzeProjectAction.mockResolvedValue({
      ok: true,
      data: view({ status: 'ANALYZING', stats: { phase: 'cloning' } }),
    });
    render(<AnalysisPanel slug="p" canWrite />);
    await user.click(await screen.findByRole('button', { name: /Analyze existing project/i }));
    expect(h.analyzeProjectAction).toHaveBeenCalledWith('p');
    expect(await screen.findByText('Analyzing…', { selector: 'span' })).toBeInTheDocument();
  });

  it('shows an error when running analysis fails', async () => {
    const user = userEvent.setup();
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view() });
    h.analyzeProjectAction.mockResolvedValue({ ok: false, error: 'no repos' });
    render(<AnalysisPanel slug="p" canWrite />);
    await user.click(await screen.findByRole('button', { name: /Analyze existing project/i }));
    expect(await screen.findByText('no repos')).toBeInTheDocument();
  });
});
