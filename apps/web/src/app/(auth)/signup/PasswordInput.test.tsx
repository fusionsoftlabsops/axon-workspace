import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasswordInput } from './PasswordInput';

describe('PasswordInput', () => {
  it('renders as a password input by default and toggles to text', async () => {
    const user = userEvent.setup();
    const { container } = render(<PasswordInput value="secret" onChange={() => {}} />);
    const input = container.querySelector('input')!;
    expect(input).toHaveAttribute('type', 'password');

    const toggle = screen.getByRole('button', { name: 'Show' });
    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('forwards arbitrary input props', () => {
    const { container } = render(<PasswordInput placeholder="pw" required />);
    const input = container.querySelector('input')!;
    expect(input).toHaveAttribute('placeholder', 'pw');
    expect(input).toBeRequired();
  });
});
