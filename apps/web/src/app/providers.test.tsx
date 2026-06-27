import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// next/navigation is used by the I18nProvider (via useRouter).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
// The vault context imports @/lib/actions/me, which transitively pulls in
// next-auth (not loadable under the test runtime). Stub it to break the chain.
vi.mock('@/lib/actions/me', () => ({ getSelfKeyMaterial: vi.fn() }));

import { Providers } from './providers';

describe('Providers', () => {
  it('mounts the provider stack and renders its children', () => {
    render(
      <Providers>
        <div data-testid="child">hello</div>
      </Providers>,
    );
    expect(screen.getByTestId('child')).toHaveTextContent('hello');
  });
});
