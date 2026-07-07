import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: string, en: string) => en }));
// LoginForm is rendered inside <Suspense> but never mounted in these element-tree
// assertions; stub it so importing the page stays cheap and isolated.
vi.mock('./LoginForm', () => ({ LoginForm: () => <div data-testid="login-form" /> }));
vi.mock('@/lib/auth/oidc', () => ({ isOidcConfigured: () => true }));

import LoginPage from './page';

type El = { type: unknown; props: unknown };

describe('LoginPage', () => {
  it('renders the sign-in heading and the SSO-only note', async () => {
    const tree = (await LoginPage()) as { props: { children: El[] } };
    // Render only the static (host) children; the <Suspense> wrapper cannot mount
    // under a client-side RTL render.
    const statics = tree.props.children.flat().filter((c) => typeof c?.type === 'string');
    render(<>{statics as React.ReactNode}</>);
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/managed with your corporate account/)).toBeInTheDocument();
  });
});
