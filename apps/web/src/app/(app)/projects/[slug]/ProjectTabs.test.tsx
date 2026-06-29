import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ pathname: '/projects/demo/plan' }));

vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }));
vi.mock('next/link', () => ({
  default: ({ children, href, className, ...rest }: any) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));

import { ProjectTabs } from './ProjectTabs';

const TABS = [
  { href: '/projects/demo/plan', label: 'Plan' },
  { href: '/projects/demo/board', label: 'Board' },
  { href: '/projects/demo/brain', label: 'Brain' },
  { href: '/projects/demo/settings', label: 'Settings' },
  { href: '/projects/demo/settings/audit', label: 'Audit' },
];

function activeLabel(): string | null {
  const el = document.querySelector('[aria-current="page"]');
  return el ? el.textContent : null;
}

describe('ProjectTabs', () => {
  it('renders every tab', () => {
    state.pathname = '/projects/demo/plan';
    render(<ProjectTabs tabs={TABS} />);
    for (const t of TABS) expect(screen.getByText(t.label)).toBeInTheDocument();
  });

  it('marks the current tab active (aria-current=page)', () => {
    state.pathname = '/projects/demo/board';
    render(<ProjectTabs tabs={TABS} />);
    expect(activeLabel()).toBe('Board');
  });

  it('keeps the parent tab active on a nested route', () => {
    state.pathname = '/projects/demo/brain/mem_123';
    render(<ProjectTabs tabs={TABS} />);
    expect(activeLabel()).toBe('Brain');
  });

  it('lights the longest match: audit, not settings', () => {
    state.pathname = '/projects/demo/settings/audit';
    render(<ProjectTabs tabs={TABS} />);
    expect(activeLabel()).toBe('Audit');
  });

  it('lights settings on its own route', () => {
    state.pathname = '/projects/demo/settings';
    render(<ProjectTabs tabs={TABS} />);
    expect(activeLabel()).toBe('Settings');
  });

  it('marks nothing active when no tab matches', () => {
    state.pathname = '/projects/other/plan';
    render(<ProjectTabs tabs={TABS} />);
    expect(activeLabel()).toBeNull();
  });
});
