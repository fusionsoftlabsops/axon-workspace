import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

function Hello({ name }: { name: string }) {
  return <h1>Hola {name}</h1>;
}

describe('axon web test infra smoke', () => {
  it('renders a component under jsdom + RTL', () => {
    render(<Hello name="axon" />);
    expect(screen.getByRole('heading')).toHaveTextContent('Hola axon');
  });
});
