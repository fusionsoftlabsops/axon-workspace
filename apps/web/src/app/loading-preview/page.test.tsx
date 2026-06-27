import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../loading', () => ({ default: () => <div data-testid="loading-skeleton" /> }));

import LoadingPreview from './page';

describe('LoadingPreview', () => {
  it('renders the loading skeleton', () => {
    render(<LoadingPreview />);
    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
  });
});
