import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// El botón usa un server action como `action` del <form>; en jsdom no se ejecuta,
// solo verificamos el render del botón SSO / el mensaje de no-configurado.
vi.mock('@/lib/actions/auth', () => ({ ssoLoginAction: vi.fn() }));

import { LoginForm } from './LoginForm';

describe('LoginForm', () => {
  it('muestra el botón de SSO cuando está habilitado', () => {
    render(<LoginForm ssoEnabled />);
    expect(screen.getByRole('button', { name: 'Sign in with SSO' })).toBeInTheDocument();
  });

  it('muestra un aviso cuando el SSO no está configurado', () => {
    render(<LoginForm ssoEnabled={false} />);
    expect(screen.getByText(/SSO access is not configured/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
