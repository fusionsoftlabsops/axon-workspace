import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/i18n/server', () => ({ getServerT: async () => (_es: string, en: string) => en }));
// LoginForm is rendered inside <Suspense> but never mounted in these element-tree
// assertions; stub it so importing the page stays cheap and isolated.
vi.mock('./LoginForm', () => ({ LoginForm: () => <div data-testid="login-form" /> }));

import LoginPage from './page';

type El = { type: unknown; props: { searchParams?: unknown } };

async function resolveFlash(searchParams: Record<string, string>) {
  const tree = (await LoginPage({ searchParams: Promise.resolve(searchParams) })) as {
    props: { children: El[] };
  };
  const flash = tree.props.children
    .flat()
    .find((c) => typeof c?.type === 'function' && c.props?.searchParams) as El & {
    type: (p: unknown) => Promise<React.ReactNode>;
  };
  return flash.type(flash.props);
}

describe('LoginPage', () => {
  it('renders the sign-in heading and invite-only note', async () => {
    const tree = (await LoginPage({ searchParams: Promise.resolve({}) })) as {
      props: { children: El[] };
    };
    // Render only the static (host) children; the async <AwaitedFlash> and the
    // <Suspense> wrapper cannot mount under a client-side RTL render.
    const statics = tree.props.children.flat().filter((c) => typeof c?.type === 'string');
    render(<>{statics as React.ReactNode}</>);
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/Access is invite-only/)).toBeInTheDocument();
  });

  it('shows the account-created flash when signed_up=1', async () => {
    const out = await resolveFlash({ signed_up: '1' });
    render(<>{out}</>);
    expect(screen.getByText('Account created. Sign in.')).toBeInTheDocument();
  });

  it('renders no flash otherwise', async () => {
    const out = await resolveFlash({});
    expect(out).toBeNull();
  });
});
