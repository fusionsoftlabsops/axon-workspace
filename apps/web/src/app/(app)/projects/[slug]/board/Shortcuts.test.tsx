import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { BoardShortcuts } from './Shortcuts';

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('BoardShortcuts', () => {
  it('renders nothing', () => {
    const { container } = render(<BoardShortcuts />);
    expect(container).toBeEmptyDOMElement();
  });

  it('clicks the new-task affordance when "c" is pressed', () => {
    const onClick = vi.fn();
    const btn = document.createElement('button');
    btn.setAttribute('data-shortcut', 'new-task');
    btn.addEventListener('click', onClick);
    document.body.appendChild(btn);

    render(<BoardShortcuts />);
    fireEvent.keyDown(window, { key: 'c' });
    expect(onClick).toHaveBeenCalled();
  });

  it('does nothing for "c" when there is no affordance', () => {
    render(<BoardShortcuts />);
    // should not throw
    fireEvent.keyDown(window, { key: 'c' });
    expect(true).toBe(true);
  });

  it('ignores shortcuts while typing in an editable element', () => {
    const onClick = vi.fn();
    const btn = document.createElement('button');
    btn.setAttribute('data-shortcut', 'new-task');
    btn.addEventListener('click', onClick);
    document.body.appendChild(btn);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    render(<BoardShortcuts />);
    fireEvent.keyDown(input, { key: 'c', target: input });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('blurs the active element on Escape', () => {
    const input = document.createElement('div');
    input.setAttribute('tabindex', '0');
    document.body.appendChild(input);
    input.focus();
    const blur = vi.spyOn(input, 'blur');

    render(<BoardShortcuts />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(blur).toHaveBeenCalled();
  });

  it('removes the listener on unmount', () => {
    const onClick = vi.fn();
    const btn = document.createElement('button');
    btn.setAttribute('data-shortcut', 'new-task');
    btn.addEventListener('click', onClick);
    document.body.appendChild(btn);

    const { unmount } = render(<BoardShortcuts />);
    unmount();
    fireEvent.keyDown(window, { key: 'c' });
    expect(onClick).not.toHaveBeenCalled();
  });
});
