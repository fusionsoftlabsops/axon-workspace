import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ getLogin: vi.fn() }));
vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: string, en: string) => en }));
vi.mock('@/lib/actions/me', () => ({ getMyGithubLogin: h.getLogin }));
vi.mock('./GithubHandlePanel', () => ({
  GithubHandlePanel: ({ initial }: { initial: string | null }) => (
    <div data-testid="panel">{initial ?? 'null'}</div>
  ),
}));

import GithubSettingsPage from './page';

beforeEach(() => vi.clearAllMocks());

describe('GithubSettingsPage', () => {
  it('renders the panel seeded with the current github login', async () => {
    h.getLogin.mockResolvedValue('octocat');
    render(await GithubSettingsPage());
    expect(screen.getByRole('heading', { name: 'GitHub username' })).toBeInTheDocument();
    expect(screen.getByTestId('panel')).toHaveTextContent('octocat');
  });

  it('passes null when there is no github login', async () => {
    h.getLogin.mockResolvedValue(null);
    render(await GithubSettingsPage());
    expect(screen.getByTestId('panel')).toHaveTextContent('null');
  });
});
