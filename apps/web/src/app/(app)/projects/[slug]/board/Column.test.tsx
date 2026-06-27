import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Column } from './Column';
import type { StateView } from './BoardClient';

const state: StateView = {
  id: 's1',
  name: 'To Do',
  color: '#ff0000',
  category: 'TODO',
  order: 0,
};

describe('Column', () => {
  it('renders the state name, count and children', () => {
    render(
      <Column state={state} count={4}>
        <div data-testid="child">body</div>
      </Column>,
    );
    expect(screen.getByRole('heading', { name: /To Do/ })).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });
});
