import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ create: vi.fn(), revoke: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock('@/lib/actions/llm-credentials', () => ({
  createLlmCredentialAction: h.create,
  revokeLlmCredentialAction: h.revoke,
}));

import { LlmCredentialsPanel } from './LlmCredentialsPanel';

type Cred = Parameters<typeof LlmCredentialsPanel>[0]['credentials'][number];
const cred = (over: Partial<Cred> = {}): Cred => ({
  id: 'c1',
  provider: 'ANTHROPIC',
  label: 'personal',
  keyPrefix: 'sk-ab',
  modelDefault: null,
  projectId: null,
  lastUsedAt: null,
  createdAt: new Date().toISOString(),
  revokedAt: null,
  ...over,
});

const projects = [{ id: 'p1', slug: 'proj', name: 'Proj One' }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('LlmCredentialsPanel', () => {
  it('shows the empty active state and updates the provider hint link', async () => {
    const user = userEvent.setup();
    render(<LlmCredentialsPanel credentials={[]} projects={projects} />);
    expect(screen.getByText('No active credentials yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'console.anthropic.com' })).toBeInTheDocument();
    // Switch provider -> hint link changes.
    await user.selectOptions(screen.getByDisplayValue('Anthropic (Claude)'), 'OPENAI');
    expect(screen.getByRole('link', { name: 'platform.openai.com' })).toBeInTheDocument();
  });

  it('renders active and revoked credentials', () => {
    render(
      <LlmCredentialsPanel
        credentials={[
          cred({ id: 'a', label: 'active-one', lastUsedAt: new Date().toISOString(), modelDefault: 'claude' }),
          cred({ id: 'r', label: 'revoked-one', revokedAt: new Date().toISOString() }),
        ]}
        projects={projects}
      />,
    );
    expect(screen.getByText('active-one')).toBeInTheDocument();
    expect(screen.getByText('claude')).toBeInTheDocument();
    expect(screen.getByText(/Revoked/)).toBeInTheDocument();
  });

  it('creates a credential and shows the success message', async () => {
    h.create.mockResolvedValue({ ok: true, id: 'new', keyPrefix: 'sk-zz' });
    const user = userEvent.setup();
    render(<LlmCredentialsPanel credentials={[]} projects={projects} />);
    await user.type(screen.getByPlaceholderText('e.g. personal account'), 'My key');
    await user.type(screen.getByPlaceholderText('sk-…'), 'sk-secret-value');
    await user.selectOptions(
      screen.getByDisplayValue('— Available in all my projects —'),
      'p1',
    );
    await user.click(screen.getByRole('button', { name: 'Save credential' }));
    await waitFor(() =>
      expect(h.create).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'ANTHROPIC', label: 'My key', plainKey: 'sk-secret-value', projectId: 'p1' }),
      ),
    );
    expect(await screen.findByText(/Credential saved/)).toBeInTheDocument();
    expect(h.refresh).toHaveBeenCalled();
  });

  it('surfaces a create error', async () => {
    h.create.mockResolvedValue({ ok: false, error: 'bad key' });
    const user = userEvent.setup();
    render(<LlmCredentialsPanel credentials={[]} projects={projects} />);
    await user.type(screen.getByPlaceholderText('e.g. personal account'), 'My key');
    await user.type(screen.getByPlaceholderText('sk-…'), 'sk-secret-value');
    await user.click(screen.getByRole('button', { name: 'Save credential' }));
    expect(await screen.findByText('bad key')).toBeInTheDocument();
  });

  it('revokes a credential after confirmation', async () => {
    h.revoke.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<LlmCredentialsPanel credentials={[cred()]} projects={projects} />);
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(h.revoke).toHaveBeenCalledWith('c1'));
    expect(h.refresh).toHaveBeenCalled();
  });

  it('does not revoke when confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<LlmCredentialsPanel credentials={[cred()]} projects={projects} />);
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(h.revoke).not.toHaveBeenCalled();
  });

  it('shows the error returned by a failed revoke', async () => {
    h.revoke.mockResolvedValue({ ok: false, error: 'revoke-fail' });
    const user = userEvent.setup();
    render(<LlmCredentialsPanel credentials={[cred()]} projects={projects} />);
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('revoke-fail')).toBeInTheDocument();
  });
});
