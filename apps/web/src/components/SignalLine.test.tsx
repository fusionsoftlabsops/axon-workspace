import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SignalLine } from './SignalLine';

describe('SignalLine', () => {
  it('defaults to idle and is aria-hidden', () => {
    const { getByTestId } = render(<SignalLine />);
    const el = getByTestId('signal-line');
    expect(el).toHaveAttribute('data-state', 'idle');
    expect(el).toHaveAttribute('aria-hidden', 'true');
  });

  it.each(['idle', 'active', 'live', 'failed'] as const)('renders state %s', (state) => {
    const { getByTestId } = render(<SignalLine state={state} />);
    expect(getByTestId('signal-line')).toHaveAttribute('data-state', state);
  });

  it('merges a custom className', () => {
    const { getByTestId } = render(<SignalLine className="extra" />);
    expect(getByTestId('signal-line').className).toContain('extra');
  });
});
