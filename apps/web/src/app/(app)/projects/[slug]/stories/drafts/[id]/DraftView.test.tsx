import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DraftView } from './DraftView';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="md">{children}</div>,
}));
vi.mock('remark-gfm', () => ({ default: () => null }));

const { publishStoryDraftAsTaskAction } = vi.hoisted(() => ({
  publishStoryDraftAsTaskAction: vi.fn(),
}));
vi.mock('@/lib/actions/stories', () => ({ publishStoryDraftAsTaskAction }));

const baseDraft = {
  id: 'd1',
  status: 'READY' as const,
  errorMessage: null,
  rawInput: 'raw',
  summary: 'A summary',
  acceptanceCriteria: 'AC',
  technicalContext: 'TC',
  subtaskBreakdown: null,
  filesToTouch: null,
  risks: 'R',
  inputTokens: 100,
  outputTokens: 50,
  estimatedCostUsd: '0.12',
  durationMs: 3400,
  taskId: null,
  citedMemoryIds: [] as string[],
};

const states = [
  { id: 's1', name: 'Todo', color: '#fff' },
  { id: 's2', name: 'Doing', color: '#000' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DraftView', () => {
  it('renders READY draft with tokens, cost, time, and publish controls', () => {
    render(<DraftView projectSlug="p" initialDraft={baseDraft} states={states} canPublish />);
    expect(screen.getByText('✓ ready')).toBeInTheDocument();
    expect(screen.getByText(/↓ 100/)).toBeInTheDocument();
    expect(screen.getByText('$0.12')).toBeInTheDocument();
    expect(screen.getByText('3.4s')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish as task' })).toBeInTheDocument();
    expect(screen.getByLabelText('Publish to column')).toBeInTheDocument();
  });

  it('renders summary markdown and placeholder for empty sections', () => {
    const draft = { ...baseDraft, technicalContext: null };
    render(<DraftView projectSlug="p" initialDraft={draft} states={states} canPublish />);
    expect(screen.getByText('A summary')).toBeInTheDocument();
    // placeholder shown for null section
    expect(screen.getAllByText('generating…').length).toBeGreaterThan(0);
  });

  it('renders subtasks with priority tag + description and toggles them', async () => {
    const user = userEvent.setup();
    const draft = {
      ...baseDraft,
      subtaskBreakdown: [
        { title: 'High task', description: 'desc1', priority: 'HIGH' as const },
        { title: 'Medium task', priority: 'MEDIUM' as const },
      ],
    };
    render(<DraftView projectSlug="p" initialDraft={draft} states={states} canPublish />);
    expect(screen.getByText('High task')).toBeInTheDocument();
    expect(screen.getByText('· HIGH')).toBeInTheDocument();
    expect(screen.getByText('desc1')).toBeInTheDocument();
    // MEDIUM priority does not render a tag
    expect(screen.queryByText('· MEDIUM')).not.toBeInTheDocument();

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toBeChecked();
    await user.click(checkboxes[0]);
    expect(checkboxes[0]).not.toBeChecked();
    await user.click(checkboxes[0]);
    expect(checkboxes[0]).toBeChecked();
  });

  it('renders filesToTouch list', () => {
    const draft = {
      ...baseDraft,
      filesToTouch: [{ path: 'src/a.ts', reason: 'edit' }],
    };
    render(<DraftView projectSlug="p" initialDraft={draft} states={states} canPublish />);
    expect(screen.getByText('src/a.ts')).toBeInTheDocument();
    expect(screen.getByText('— edit')).toBeInTheDocument();
  });

  it('publishes successfully and navigates to board', async () => {
    const user = userEvent.setup();
    publishStoryDraftAsTaskAction.mockResolvedValue({ ok: true });
    render(<DraftView projectSlug="p" initialDraft={baseDraft} states={states} canPublish />);
    await user.click(screen.getByRole('button', { name: 'Publish as task' }));
    await waitFor(() =>
      expect(publishStoryDraftAsTaskAction).toHaveBeenCalledWith('d1', {
        stateId: 's1',
        includeSubtasks: [],
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/p/board'));
  });

  it('shows publish error when action fails', async () => {
    const user = userEvent.setup();
    publishStoryDraftAsTaskAction.mockResolvedValue({ ok: false, error: 'boom' });
    render(<DraftView projectSlug="p" initialDraft={baseDraft} states={states} canPublish />);
    await user.click(screen.getByRole('button', { name: 'Publish as task' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('changes the publish column select', async () => {
    const user = userEvent.setup();
    publishStoryDraftAsTaskAction.mockResolvedValue({ ok: true });
    render(<DraftView projectSlug="p" initialDraft={baseDraft} states={states} canPublish />);
    await user.selectOptions(screen.getByLabelText('Publish to column'), 's2');
    await user.click(screen.getByRole('button', { name: 'Publish as task' }));
    await waitFor(() =>
      expect(publishStoryDraftAsTaskAction).toHaveBeenCalledWith('d1', {
        stateId: 's2',
        includeSubtasks: [],
      }),
    );
  });

  it('hides publish controls when canPublish is false', () => {
    render(<DraftView projectSlug="p" initialDraft={baseDraft} states={states} canPublish={false} />);
    expect(screen.queryByRole('button', { name: 'Publish as task' })).not.toBeInTheDocument();
  });

  it('shows error message and published task notice', () => {
    const draft = {
      ...baseDraft,
      status: 'PUBLISHED' as const,
      errorMessage: 'an error',
      taskId: 't1',
      citedMemoryIds: ['abcdef123456', 'zzz'],
    };
    render(<DraftView projectSlug="p" initialDraft={draft} states={states} canPublish />);
    expect(screen.getByText('◆ published')).toBeInTheDocument();
    expect(screen.getByText('an error')).toBeInTheDocument();
    expect(screen.getByText('✓ Published as task')).toBeInTheDocument();
    expect(screen.getByText('M-abcdef12')).toBeInTheDocument();
    expect(screen.getByText(/Cited memories \(2\)/)).toBeInTheDocument();
  });

  it('shows ERRORED status', () => {
    render(
      <DraftView
        projectSlug="p"
        initialDraft={{ ...baseDraft, status: 'ERRORED' }}
        states={states}
        canPublish
      />,
    );
    expect(screen.getByText('✕ error')).toBeInTheDocument();
  });

  it('polls while GENERATING and updates on response', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'READY',
        errorMessage: null,
        summary: 'polled summary',
        acceptanceCriteria: 'ac',
        technicalContext: 'tc',
        subtaskBreakdown: null,
        filesToTouch: null,
        risks: 'r',
        inputTokens: 5,
        outputTokens: 6,
        estimatedCostUsd: '0.99',
        durationMs: 1000,
        taskId: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <DraftView
        projectSlug="p"
        initialDraft={{ ...baseDraft, status: 'GENERATING', summary: null }}
        states={states}
        canPublish
      />,
    );
    expect(screen.getByText('◌ generating…')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(1600);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/p/stories/drafts/d1',
      { credentials: 'include' },
    );
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText('polled summary')).toBeInTheDocument());
    vi.unstubAllGlobals();
  });

  it('swallows polling fetch errors and !ok responses', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockRejectedValueOnce(new Error('net'));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <DraftView
        projectSlug="p"
        initialDraft={{ ...baseDraft, status: 'GENERATING' }}
        states={states}
        canPublish
      />,
    );
    await vi.advanceTimersByTimeAsync(1600);
    await vi.advanceTimersByTimeAsync(1600);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
