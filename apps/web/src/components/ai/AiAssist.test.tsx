import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ invokeAiAction: vi.fn() }));
vi.mock('@/lib/actions/ai', () => ({ invokeAiAction: h.invokeAiAction }));
vi.mock('@/lib/i18n/i18n', () => ({
  useI18n: () => ({ t: (_es: unknown, en: unknown) => en }),
}));

import { AiAssist } from './AiAssist';

describe('AiAssist', () => {
  beforeEach(() => h.invokeAiAction.mockReset());

  it('renders a labelled button per purpose', () => {
    render(<AiAssist projectSlug="p" purposes={['task.draft', 'task.summarize']} context="hello" />);
    expect(screen.getByRole('button', { name: /Draft description/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Summarize/ })).toBeInTheDocument();
  });

  it('disables buttons when context is empty/whitespace', () => {
    render(<AiAssist projectSlug="p" purposes={['task.draft']} context="   " />);
    expect(screen.getByRole('button', { name: /Draft description/ })).toBeDisabled();
  });

  it('invokes the action, shows output + meta and calls onResult', async () => {
    h.invokeAiAction.mockResolvedValue({
      ok: true,
      output: 'generated text',
      model: 'claude-x',
      estimatedCostUsd: 0.0012,
    });
    const onResult = vi.fn();
    const user = userEvent.setup();
    render(<AiAssist projectSlug="proj" purposes={['task.draft']} context="ctx" onResult={onResult} />);
    await user.click(screen.getByRole('button', { name: /Draft description/ }));

    expect(h.invokeAiAction).toHaveBeenCalledWith('proj', { purpose: 'task.draft', context: 'ctx' });
    expect(await screen.findByText('generated text')).toBeInTheDocument();
    expect(screen.getByText(/claude-x/)).toHaveTextContent('0.00120');
    expect(onResult).toHaveBeenCalledWith('generated text');
  });

  it('shows the error message when the action fails', async () => {
    h.invokeAiAction.mockResolvedValue({ ok: false, error: 'boom' });
    const user = userEvent.setup();
    render(<AiAssist projectSlug="p" purposes={['task.draft']} context="ctx" />);
    await user.click(screen.getByRole('button', { name: /Draft description/ }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.queryByText('generated text')).not.toBeInTheDocument();
  });

  it('shows a thinking indicator while pending', async () => {
    let resolve!: (v: unknown) => void;
    h.invokeAiAction.mockReturnValue(new Promise((r) => { resolve = r; }));
    const user = userEvent.setup();
    render(<AiAssist projectSlug="p" purposes={['task.draft']} context="ctx" />);
    await user.click(screen.getByRole('button', { name: /Draft description/ }));
    expect(await screen.findByText('Thinking…')).toBeInTheDocument();
    resolve({ ok: true, output: 'done', model: 'm', estimatedCostUsd: 0 });
    expect(await screen.findByText('done')).toBeInTheDocument();
  });
});
