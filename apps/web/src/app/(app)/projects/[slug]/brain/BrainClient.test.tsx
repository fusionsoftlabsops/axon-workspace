import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/actions/brain', () => ({
  publishMemoryAction: vi.fn(),
  deprecateMemoryAction: vi.fn(),
  captureMemoryAction: vi.fn(),
}));

import { BrainClient } from './BrainClient';
import type { MemoryView } from './MemoryCard';

function makeMemory(over: Partial<MemoryView> = {}): MemoryView {
  return {
    id: 'm1',
    scope: 'PROJECT',
    type: 'DECISION',
    title: 'A decision',
    body: 'Some body text',
    tags: ['auth'],
    status: 'ACTIVE',
    authorName: 'Alice',
    ownerUserId: 'u1',
    sourceTaskNumber: 7,
    citationCount: 2,
    lastCitedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function baseProps(over: Partial<React.ComponentProps<typeof BrainClient>> = {}) {
  return {
    projectSlug: 'proj',
    isOwner: true,
    currentUserId: 'u1',
    activeTab: 'project' as const,
    query: '',
    typeFilter: null,
    tagFilter: null,
    memories: [makeMemory()],
    stats: {
      project: 5,
      local: 3,
      topCited: [
        { id: 'm1', title: 'X'.repeat(60), citationCount: 9 },
        { id: 'm2', title: 'short', citationCount: 1 },
      ],
      stale: 2,
      orphans: 1,
    },
    staleActive: false,
    orphansActive: false,
    auditByAuthor: null,
    ...over,
  };
}

describe('BrainClient', () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.refresh.mockReset();
  });

  it('renders header, stats and memory list', () => {
    render(<BrainClient {...baseProps()} />);
    expect(screen.getByRole('heading', { name: 'The brain' })).toBeInTheDocument();
    expect(screen.getByText('Most cited')).toBeInTheDocument();
    // topCited slice + ellipsis branch
    expect(screen.getByText('×9')).toBeInTheDocument();
    expect(screen.getByText('A decision')).toBeInTheDocument();
  });

  it('toggles the new-memory form', async () => {
    const user = userEvent.setup();
    render(<BrainClient {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: '+ New entry' }));
    expect(screen.getByRole('heading', { name: 'New memory' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'New memory' })).not.toBeInTheDocument();
  });

  it('navigates on stale and orphans stat clicks', async () => {
    const user = userEvent.setup();
    render(<BrainClient {...baseProps()} />);
    await user.click(screen.getByText('stale (>6 months)'));
    await user.click(screen.getByText('orphans'));
    expect(nav.push).toHaveBeenCalledWith(expect.stringContaining('stale=1'));
    expect(nav.push).toHaveBeenCalledWith(expect.stringContaining('orphans=1'));
  });

  it('toggles active stat off (null branch)', async () => {
    const user = userEvent.setup();
    render(<BrainClient {...baseProps({ staleActive: true, orphansActive: true })} />);
    await user.click(screen.getByText('stale (>6 months)'));
    // when active, clicking deletes param -> push without stale=1
    expect(nav.push).toHaveBeenCalledWith(expect.not.stringContaining('stale=1'));
  });

  it('switches tabs', async () => {
    const user = userEvent.setup();
    render(<BrainClient {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: /My local/ }));
    expect(nav.push).toHaveBeenCalledWith(expect.stringContaining('tab=local'));
    await user.click(screen.getByRole('button', { name: /Main/ }));
    expect(nav.push).toHaveBeenCalledWith(expect.stringContaining('tab=project'));
  });

  it('hides audit tab for non owners', () => {
    render(<BrainClient {...baseProps({ isOwner: false })} />);
    expect(screen.queryByRole('button', { name: /Audit/ })).not.toBeInTheDocument();
  });

  it('renders the audit table on the audit tab', () => {
    render(
      <BrainClient
        {...baseProps({
          activeTab: 'audit',
          auditByAuthor: [
            {
              userId: 'u1',
              name: 'Alice',
              email: 'alice@x.com',
              role: 'OWNER',
              local: 1,
              project: 2,
              cited: 3,
              stale: 4,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('Contribution by member')).toBeInTheDocument();
    expect(screen.getByText('alice@x.com')).toBeInTheDocument();
  });

  it('submits the search form', async () => {
    const user = userEvent.setup();
    render(<BrainClient {...baseProps()} />);
    const input = screen.getByPlaceholderText('Search the notebook…');
    await user.type(input, '  hello  ');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(nav.push).toHaveBeenCalledWith(expect.stringContaining('q=hello'));
  });

  it('submitting an empty search clears the query', async () => {
    const user = userEvent.setup();
    render(<BrainClient {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(nav.push).toHaveBeenCalled();
  });

  it('changes the type filter', async () => {
    const user = userEvent.setup();
    render(<BrainClient {...baseProps()} />);
    await user.selectOptions(screen.getByRole('combobox'), 'PATTERN');
    expect(nav.push).toHaveBeenCalledWith(expect.stringContaining('type=PATTERN'));
  });

  it('removes a tag filter', async () => {
    const user = userEvent.setup();
    render(<BrainClient {...baseProps({ tagFilter: 'auth' })} />);
    await user.click(screen.getByRole('button', { name: 'Remove filter' }));
    expect(nav.push).toHaveBeenCalled();
  });

  it('renders the empty state when there are no memories', () => {
    render(<BrainClient {...baseProps({ memories: [], stats: { project: 0, local: 0, topCited: [], stale: 0, orphans: 0 } })} />);
    expect(screen.getByText(/The notebook awaits/)).toBeInTheDocument();
  });
});
