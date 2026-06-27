import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
const act = vi.hoisted(() => ({
  publishMemoryAction: vi.fn(),
  deprecateMemoryAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: nav.refresh, push: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/actions/brain', () => act);

import { MemoryCard, type MemoryView } from './MemoryCard';

function makeMemory(over: Partial<MemoryView> = {}): MemoryView {
  return {
    id: 'm1',
    scope: 'LOCAL',
    type: 'DECISION',
    title: 'My memory',
    body: '# Heading\n\n**bold** and `code` and [link](http://x) text\n\n```\nblock\n```\n- bullet',
    tags: ['auth', 'deploy'],
    status: 'ACTIVE',
    authorName: 'Alice',
    ownerUserId: 'u1',
    sourceTaskNumber: 42,
    citationCount: 1,
    lastCitedAt: null,
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

const baseProps = (over: Partial<React.ComponentProps<typeof MemoryCard>> = {}) => ({
  projectSlug: 'proj',
  memory: makeMemory(),
  currentUserId: 'u1',
  isOwner: false,
  onTagClick: vi.fn(),
  index: 0,
  ...over,
});

describe('MemoryCard', () => {
  beforeEach(() => {
    nav.refresh.mockReset();
    act.publishMemoryAction.mockReset();
    act.deprecateMemoryAction.mockReset();
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  it('renders title, preview (stripped markdown), tags and singular citation', () => {
    render(<MemoryCard {...baseProps()} />);
    expect(screen.getByRole('heading', { name: 'My memory' })).toBeInTheDocument();
    expect(screen.getByText(/citation$/)).toBeInTheDocument();
    expect(screen.getByText('#42')).toBeInTheDocument();
  });

  it('publishes a memory (success path)', async () => {
    act.publishMemoryAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<MemoryCard {...baseProps({ currentUserId: 'u1' })} />);
    await user.click(screen.getByRole('button', { name: /Publish/ }));
    expect(act.publishMemoryAction).toHaveBeenCalledWith('m1');
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('alerts when publish fails', async () => {
    act.publishMemoryAction.mockResolvedValue({ ok: false, error: 'nope' });
    const user = userEvent.setup();
    render(<MemoryCard {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: /Publish/ }));
    expect(window.alert).toHaveBeenCalledWith('nope');
  });

  it('deprecates after confirm (success)', async () => {
    act.deprecateMemoryAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<MemoryCard {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: 'Deprecate' }));
    expect(act.deprecateMemoryAction).toHaveBeenCalledWith('m1');
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('alerts when deprecate fails', async () => {
    act.deprecateMemoryAction.mockResolvedValue({ ok: false, error: 'fail' });
    const user = userEvent.setup();
    render(<MemoryCard {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: 'Deprecate' }));
    expect(window.alert).toHaveBeenCalledWith('fail');
  });

  it('does not deprecate when confirm is cancelled', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const user = userEvent.setup();
    render(<MemoryCard {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: 'Deprecate' }));
    expect(act.deprecateMemoryAction).not.toHaveBeenCalled();
  });

  it('fires onTagClick when a tag is clicked', async () => {
    const onTagClick = vi.fn();
    const user = userEvent.setup();
    render(<MemoryCard {...baseProps({ onTagClick })} />);
    await user.click(screen.getByText('auth'));
    expect(onTagClick).toHaveBeenCalledWith('auth');
  });

  it('shows a stale stamp for old project memories', () => {
    render(
      <MemoryCard
        {...baseProps({
          memory: makeMemory({
            scope: 'PROJECT',
            ownerUserId: null,
            updatedAt: new Date('2000-01-01').toISOString(),
            lastCitedAt: null,
            citationCount: 5,
          }),
        })}
      />,
    );
    expect(screen.getByText('Stale')).toBeInTheDocument();
    // plural citations branch
    expect(screen.getByText(/citations$/)).toBeInTheDocument();
  });

  it('shows deprecated stamp and dimmed card without action buttons', () => {
    render(
      <MemoryCard
        {...baseProps({ memory: makeMemory({ status: 'DEPRECATED', citationCount: 0, sourceTaskNumber: null, tags: [] }) })}
      />,
    );
    expect(screen.getByText('Deprecated')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deprecate' })).not.toBeInTheDocument();
  });

  it('shows superseded stamp', () => {
    render(<MemoryCard {...baseProps({ memory: makeMemory({ status: 'SUPERSEDED' }) })} />);
    expect(screen.getByText('Superseded')).toBeInTheDocument();
  });

  it('owner can act on other users memories', () => {
    render(
      <MemoryCard {...baseProps({ currentUserId: 'other', isOwner: true })} />,
    );
    expect(screen.getByRole('button', { name: /Publish/ })).toBeInTheDocument();
  });
});
