import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ setChatColorAction: vi.fn() }));
vi.mock('@/lib/actions/planning', () => ({ setChatColorAction: h.setChatColorAction }));

import { ChatColors } from './ChatColors';

const members = [
  { userId: 'u1', name: 'Ana' },
  { userId: 'u2', name: 'Beto' },
];

beforeEach(() => {
  h.setChatColorAction.mockReset();
  h.setChatColorAction.mockResolvedValue({ ok: true, data: { u1: '#ff0000' } });
});

describe('ChatColors', () => {
  it('renders nothing without members', () => {
    const { container } = render(<ChatColors slug="p" members={[]} colors={{}} onColorsChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists a color swatch per member with its effective color', () => {
    render(<ChatColors slug="p" members={members} colors={{ u1: '#123456' }} onColorsChange={vi.fn()} />);
    const ana = screen.getByLabelText(/Ana/i) as HTMLInputElement;
    expect(ana.value).toBe('#123456'); // explicit override
    const beto = screen.getByLabelText(/Beto/i) as HTMLInputElement;
    expect(beto.value).toMatch(/^#[0-9a-f]{6}$/i); // default palette
  });

  it('changing a swatch updates optimistically and calls the action', async () => {
    const onChange = vi.fn();
    render(<ChatColors slug="p" members={members} colors={{}} onColorsChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Ana/i), { target: { value: '#ff0000' } });
    // optimistic local update
    expect(onChange).toHaveBeenCalledWith({ u1: '#ff0000' });
    await waitFor(() => expect(h.setChatColorAction).toHaveBeenCalledWith('p', 'u1', '#ff0000'));
  });

  it('reverts on action failure', async () => {
    h.setChatColorAction.mockResolvedValue({ ok: false, error: 'Color inválido' });
    const onChange = vi.fn();
    render(<ChatColors slug="p" members={members} colors={{ u1: '#000000' }} onColorsChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Ana/i), { target: { value: '#ff0000' } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ u1: '#000000' })); // reverted
  });
});
