import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
const act = vi.hoisted(() => ({
  publishMemoryAction: vi.fn(),
  deprecateMemoryAction: vi.fn(),
  supersedeMemoryAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: nav.refresh, push: nav.push }),
}));
vi.mock('@/lib/actions/brain', () => act);

import { MemoryActions } from './MemoryActions';

const baseProps = (over: Partial<React.ComponentProps<typeof MemoryActions>> = {}) => ({
  projectSlug: 'proj',
  memoryId: 'm1',
  scope: 'LOCAL' as const,
  currentBody: 'old body',
  currentTitle: 'old title',
  currentType: 'NOTE' as const,
  currentTags: ['a', 'b'],
  ...over,
});

describe('MemoryActions', () => {
  beforeEach(() => {
    nav.refresh.mockReset();
    nav.push.mockReset();
    act.publishMemoryAction.mockReset();
    act.deprecateMemoryAction.mockReset();
    act.supersedeMemoryAction.mockReset();
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  it('publishes a local memory (success)', async () => {
    act.publishMemoryAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<MemoryActions {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: /Publish to the main brain/ }));
    expect(act.publishMemoryAction).toHaveBeenCalledWith('m1');
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('shows error when publish fails', async () => {
    act.publishMemoryAction.mockResolvedValue({ ok: false, error: 'pub-err' });
    const user = userEvent.setup();
    render(<MemoryActions {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: /Publish to the main brain/ }));
    expect(await screen.findByText('pub-err')).toBeInTheDocument();
  });

  it('hides publish for project-scoped memories', () => {
    render(<MemoryActions {...baseProps({ scope: 'PROJECT' })} />);
    expect(screen.queryByRole('button', { name: /Publish to the main brain/ })).not.toBeInTheDocument();
  });

  it('deprecates after confirm', async () => {
    act.deprecateMemoryAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<MemoryActions {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: 'Deprecate' }));
    expect(act.deprecateMemoryAction).toHaveBeenCalledWith('m1');
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('shows error when deprecate fails', async () => {
    act.deprecateMemoryAction.mockResolvedValue({ ok: false, error: 'dep-err' });
    const user = userEvent.setup();
    render(<MemoryActions {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: 'Deprecate' }));
    expect(await screen.findByText('dep-err')).toBeInTheDocument();
  });

  it('does not deprecate when confirm is cancelled', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const user = userEvent.setup();
    render(<MemoryActions {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: 'Deprecate' }));
    expect(act.deprecateMemoryAction).not.toHaveBeenCalled();
  });

  it('toggles the supersede form and submits a replacement (changed title + type)', async () => {
    act.supersedeMemoryAction.mockResolvedValue({ ok: true, data: { newMemoryId: 'm2' } });
    const user = userEvent.setup();
    render(<MemoryActions {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: /Replace with new version/ }));

    const title = screen.getByLabelText('New title');
    await user.clear(title);
    await user.type(title, 'new title');
    await user.selectOptions(screen.getByLabelText('Type'), 'DECISION');
    const tags = screen.getByLabelText(/Tags/);
    await user.clear(tags);
    await user.type(tags, 'x, y');
    await user.click(screen.getByRole('button', { name: 'Create replacement' }));

    expect(act.supersedeMemoryAction).toHaveBeenCalledWith('m1', {
      title: 'new title',
      body: 'old body',
      type: 'DECISION',
      tags: ['x', 'y'],
    });
    expect(nav.push).toHaveBeenCalledWith('/projects/proj/brain/m2');
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('submits supersede leaving title and type unchanged', async () => {
    act.supersedeMemoryAction.mockResolvedValue({ ok: true, data: {} });
    const user = userEvent.setup();
    render(<MemoryActions {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: /Replace with new version/ }));
    await user.click(screen.getByRole('button', { name: 'Create replacement' }));
    expect(act.supersedeMemoryAction).toHaveBeenCalledWith('m1', {
      title: undefined,
      body: 'old body',
      type: undefined,
      tags: ['a', 'b'],
    });
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('shows an error when supersede fails', async () => {
    act.supersedeMemoryAction.mockResolvedValue({ ok: false, error: 'sup-err' });
    const user = userEvent.setup();
    render(<MemoryActions {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: /Replace with new version/ }));
    await user.click(screen.getByRole('button', { name: 'Create replacement' }));
    expect(await screen.findByText('sup-err')).toBeInTheDocument();
  });
});
