import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';

describe('Modal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <Modal open={false} onClose={() => {}}>body</Modal>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a dialog with title and body when open', () => {
    render(
      <Modal open onClose={() => {}} title="Heads up">the body</Modal>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Heads up' })).toBeInTheDocument();
    expect(screen.getByText('the body')).toBeInTheDocument();
  });

  it('renders without a title (placeholder span)', () => {
    render(<Modal open onClose={() => {}}>x</Modal>);
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('closes on the close button, backdrop click and Escape, but not on card click', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Modal open onClose={onClose} title="T">content</Modal>);

    // card (dialog) click should NOT close (stopPropagation)
    await user.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();

    // close button
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    // backdrop click
    await user.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledTimes(2);

    // Escape key
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('removes the key listener when toggled closed', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Modal open onClose={onClose}>c</Modal>);
    rerender(<Modal open={false} onClose={onClose}>c</Modal>);
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});
