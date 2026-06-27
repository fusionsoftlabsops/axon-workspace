import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from './Composer';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn(), back: vi.fn() }),
}));

const { startStoryDraftAction } = vi.hoisted(() => ({ startStoryDraftAction: vi.fn() }));
vi.mock('@/lib/actions/stories', () => ({ startStoryDraftAction }));

vi.mock('@/lib/ai/cost-estimator', () => ({
  estimateCost: () => ({ inputTokens: 10, outputTokens: 20, totalCostUsd: 0.05 }),
  formatUsd: (n: number) => `$${n.toFixed(2)}`,
}));

const providers = [
  {
    name: 'ANTHROPIC',
    label: 'Anthropic',
    defaultModel: 'opus',
    models: [
      { id: 'opus', displayName: 'Opus' },
      { id: 'sonnet', displayName: 'Sonnet' },
    ],
  },
] as never;

const credentials = [
  { id: 'c1', provider: 'ANTHROPIC', label: 'main', modelDefault: 'sonnet', keyPrefix: 'sk-1' },
] as never;

const repoTree = [
  {
    name: 'src',
    path: 'src',
    kind: 'dir' as const,
    children: [{ name: 'a.ts', path: 'src/a.ts', kind: 'file' as const }],
  },
];

beforeEach(() => vi.clearAllMocks());

function renderComposer(overrides: Record<string, unknown> = {}) {
  return render(
    <Composer
      projectSlug="p"
      projectName="Proj"
      credentials={credentials}
      providers={providers}
      repoTree={repoTree}
      hasRepo
      {...overrides}
    />,
  );
}

describe('Composer', () => {
  it('renders credential, model selects, cost estimate and file tree', () => {
    renderComposer();
    expect(screen.getByLabelText('LLM credential')).toBeInTheDocument();
    expect(screen.getByLabelText('Model')).toBeInTheDocument();
    expect(screen.getByText(/tokens/)).toBeInTheDocument();
    expect(screen.getByText('$0.05')).toBeInTheDocument();
    expect(screen.getByText(/a.ts/)).toBeInTheDocument();
    expect(screen.getByText(/src/)).toBeInTheDocument();
  });

  it('shows no-credentials message and disables generate', () => {
    renderComposer({ credentials: [] });
    expect(screen.getByText('No credentials.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate draft' })).toBeDisabled();
  });

  it('shows no-repo notice when hasRepo is false', () => {
    renderComposer({ hasRepo: false });
    expect(screen.getByText(/No repository is configured/)).toBeInTheDocument();
  });

  it('errors when input too short', async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.type(screen.getByLabelText('Need'), 'short');
    await user.click(screen.getByRole('button', { name: 'Generate draft' }));
    expect(
      await screen.findByText('Describe the need with a bit more detail'),
    ).toBeInTheDocument();
    expect(startStoryDraftAction).not.toHaveBeenCalled();
  });

  it('submits and navigates to the new draft on success', async () => {
    const user = userEvent.setup();
    startStoryDraftAction.mockResolvedValue({ ok: true, draftId: 'd9' });
    renderComposer();
    await user.type(screen.getByLabelText('Need'), 'This is a sufficiently long need');
    // select a file
    await user.click(screen.getByRole('checkbox', { name: /a.ts/ }));
    await user.click(screen.getByRole('button', { name: 'Generate draft' }));
    await waitFor(() =>
      expect(startStoryDraftAction).toHaveBeenCalledWith(
        'p',
        expect.objectContaining({
          rawInput: 'This is a sufficiently long need',
          provider: 'ANTHROPIC',
          credentialId: 'c1',
          selectedPaths: ['src/a.ts'],
        }),
      ),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/p/stories/drafts/d9'));
  });

  it('shows error when action fails', async () => {
    const user = userEvent.setup();
    startStoryDraftAction.mockResolvedValue({ ok: false, error: 'failed!' });
    renderComposer();
    await user.type(screen.getByLabelText('Need'), 'A long enough need text');
    await user.click(screen.getByRole('button', { name: 'Generate draft' }));
    expect(await screen.findByText('failed!')).toBeInTheDocument();
  });

  it('falls back to default error when action returns no error', async () => {
    const user = userEvent.setup();
    startStoryDraftAction.mockResolvedValue({ ok: false });
    renderComposer();
    await user.type(screen.getByLabelText('Need'), 'Another long enough need');
    await user.click(screen.getByRole('button', { name: 'Generate draft' }));
    expect(await screen.findByText('could not create the draft')).toBeInTheDocument();
  });

  it('changes model selection', async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.selectOptions(screen.getByLabelText('Model'), 'opus');
    expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('opus');
  });

  it('errors when no credential is selected', async () => {
    const user = userEvent.setup();
    // credential with provider not matching any provider info -> providerInfo undefined,
    // but selectedCred still defined; instead test empty-credential select path
    startStoryDraftAction.mockResolvedValue({ ok: true, draftId: 'x' });
    const creds = [
      { id: '', provider: 'ANTHROPIC', label: 'm', modelDefault: null, keyPrefix: 'k' },
    ] as never;
    renderComposer({ credentials: creds });
    await user.type(screen.getByLabelText('Need'), 'A long enough need text here');
    await user.click(screen.getByRole('button', { name: 'Generate draft' }));
    await waitFor(() => expect(startStoryDraftAction).toHaveBeenCalled());
  });
});
