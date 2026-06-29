import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/i18n/i18n', () => ({ useI18n: () => ({ t: (_es: unknown, en: unknown) => en }) }));

const h = vi.hoisted(() => ({
  getAnalysisAction: vi.fn(),
  analyzeProjectAction: vi.fn(),
  setPlanContextGraphAction: vi.fn(),
  setFileContextAction: vi.fn(),
}));

vi.mock('next/link', () => ({ default: ({ children, href }: any) => <a href={href}>{children}</a> }));
vi.mock('@/lib/actions/analysis', () => ({
  getAnalysisAction: h.getAnalysisAction,
  analyzeProjectAction: h.analyzeProjectAction,
}));
vi.mock('@/lib/actions/planning', () => ({ setPlanContextGraphAction: h.setPlanContextGraphAction }));
vi.mock('@/lib/actions/files', () => ({ setFileContextAction: h.setFileContextAction }));
vi.mock('./AnalysisPanel', () => ({
  AnalysisPanelView: () => <div data-testid="analysis-panel" />,
}));

const FILES = [
  { id: 'a', name: 'spec.pdf', category: 'PDF', isContext: true, contextStatus: 'READY' },
  { id: 'b', name: 'mockup.png', category: 'IMAGE', isContext: false, contextStatus: 'NONE' },
] as any;

import { PlanContext } from './PlanContext';

type View = Record<string, unknown>;
function view(over: View = {}): View {
  return { configured: true, status: 'READY', stats: { nodes: 10, edges: 20, communities: 3 }, godNodes: [], analyzableRepoCount: 1, ...over };
}

beforeEach(() => {
  h.getAnalysisAction.mockReset();
  h.analyzeProjectAction.mockReset();
  h.setPlanContextGraphAction.mockReset();
  h.setFileContextAction.mockReset();
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

  it('lists the project files inline with the marked ones checked, and links to Files', async () => {
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view() });
    render(<PlanContext slug="p" canWrite contextGraph={null} contextFiles={FILES} onChange={() => {}} />);
    await screen.findByText('spec.pdf');
    const specCheck = screen.getByText('spec.pdf').closest('label')!.querySelector('input')!;
    const mockCheck = screen.getByText('mockup.png').closest('label')!.querySelector('input')!;
    expect(specCheck).toBeChecked(); // isContext: true
    expect(mockCheck).not.toBeChecked();
    expect(screen.getByRole('link', { name: /view in Files/i })).toHaveAttribute('href', '/projects/p/files');
  });

  it('marks an uploaded file as context inline (optimistic + persisted)', async () => {
    const user = userEvent.setup();
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view() });
    h.setFileContextAction.mockResolvedValue({ ok: true, data: { id: 'b', isContext: true, hasContent: true } });
    render(<PlanContext slug="p" canWrite contextGraph={null} contextFiles={FILES} onChange={() => {}} />);
    await screen.findByText('mockup.png');
    const mockCheck = screen.getByText('mockup.png').closest('label')!.querySelector('input')!;
    await user.click(mockCheck);
    expect(h.setFileContextAction).toHaveBeenCalledWith('p', 'b', true);
    expect(mockCheck).toBeChecked();
  });

  it('reverts and shows an error when marking a file fails', async () => {
    const user = userEvent.setup();
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view() });
    h.setFileContextAction.mockResolvedValue({ ok: false, error: 'file-fail' });
    render(<PlanContext slug="p" canWrite contextGraph={null} contextFiles={FILES} onChange={() => {}} />);
    await screen.findByText('mockup.png');
    const mockCheck = screen.getByText('mockup.png').closest('label')!.querySelector('input')!;
    await user.click(mockCheck);
    expect(await screen.findByText('file-fail')).toBeInTheDocument();
    expect(mockCheck).not.toBeChecked(); // reverted
  });

  it('invites the user to upload when there are no files', async () => {
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view() });
    render(<PlanContext slug="p" canWrite contextGraph={null} contextFiles={[]} onChange={() => {}} />);
    expect(await screen.findByText(/No files uploaded yet/i)).toBeInTheDocument();
  });

  it('shows the "no graph yet" hint when no analysis exists', async () => {
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view({ status: 'NONE', stats: {} }) });
    render(<PlanContext slug="p" canWrite contextGraph={null} onChange={() => {}} />);
    expect(await screen.findByText(/No graph yet/i)).toBeInTheDocument();
  });

  it('hides the graph chooser (but keeps the file-context line + panel) when graphify is not configured', async () => {
    h.getAnalysisAction.mockResolvedValue({ ok: true, data: view({ configured: false }) });
    render(<PlanContext slug="p" canWrite contextGraph={null} onChange={() => {}} />);
    // Wait for the settled section (its "Project files" block is unique to it).
    expect(await screen.findByText(/Project files/i)).toBeInTheDocument();
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
