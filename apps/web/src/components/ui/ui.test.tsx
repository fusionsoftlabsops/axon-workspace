import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Badge } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { EmptyState } from './EmptyState';
import { Eyebrow } from './Eyebrow';
import { PageHeader } from './PageHeader';
import { RuleDivider } from './RuleDivider';
import { SearchInput } from './SearchInput';
import { Stat } from './Stat';
import { Tag } from './Tag';
import { Toolbar } from './Toolbar';
import * as uiIndex from './index';

describe('Badge', () => {
  it('renders children and a dot when requested', () => {
    const { container } = render(<Badge tone="ok" dot>Live</Badge>);
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(container.querySelector('span > span')).toBeInTheDocument();
  });
  it('renders without a dot by default', () => {
    const { container } = render(<Badge>Plain</Badge>);
    expect(container.querySelector('span > span')).toBeNull();
  });
});

describe('Button', () => {
  it('renders with defaults and fires onClick', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Go</Button>);
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalled();
  });
  it('honours variant, size, fullWidth, className and type', () => {
    render(
      <Button variant="primary" size="sm" fullWidth className="x" type="submit">
        Send
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Send' });
    expect(btn).toHaveAttribute('type', 'submit');
    expect(btn.className).toContain('x');
  });
});

describe('Card', () => {
  it('renders children with defaults', () => {
    render(<Card>content</Card>);
    expect(screen.getByText('content')).toBeInTheDocument();
  });
  it('honours interactive, padded=false, className and passthrough props', () => {
    render(
      <Card interactive padded={false} className="y" data-testid="card" aria-label="lbl">
        c
      </Card>,
    );
    const el = screen.getByTestId('card');
    expect(el.className).toContain('y');
    expect(el).toHaveAttribute('aria-label', 'lbl');
  });
});

describe('EmptyState', () => {
  it('renders title only', () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });
  it('renders hint, action and compact variant', () => {
    render(
      <EmptyState title="t" hint="do this" action={<button>Add</button>} compact />,
    );
    expect(screen.getByText('do this')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });
});

describe('Eyebrow', () => {
  it('renders as a span by default', () => {
    render(<Eyebrow>label</Eyebrow>);
    expect(screen.getByText('label')).toBeInTheDocument();
  });
  it('renders each ornament and custom element/tone', () => {
    const ornaments = [
      ['asterism', '⁂'],
      ['section', '§'],
      ['reference', '※'],
      ['pilcrow', '¶'],
    ] as const;
    for (const [orn, glyph] of ornaments) {
      const { unmount } = render(
        <Eyebrow as="div" tone="accent" ornament={orn}>txt</Eyebrow>,
      );
      expect(screen.getByText(glyph)).toBeInTheDocument();
      unmount();
    }
  });
});

describe('PageHeader', () => {
  it('renders title only', () => {
    render(<PageHeader title="Page" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Page');
  });
  it('renders eyebrow, description and actions', () => {
    render(
      <PageHeader
        title="Page"
        eyebrow="Section"
        description="desc"
        actions={<button>act</button>}
      />,
    );
    expect(screen.getByText('Section')).toBeInTheDocument();
    expect(screen.getByText('desc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'act' })).toBeInTheDocument();
  });
});

describe('RuleDivider', () => {
  it('renders the ornament variant with a separator role', () => {
    render(<RuleDivider variant="ornament" spacing="lg" />);
    expect(screen.getByRole('separator')).toBeInTheDocument();
    expect(screen.getByText('⁂')).toBeInTheDocument();
  });
  it('renders an hr for single and double variants', () => {
    const { container, rerender } = render(<RuleDivider />);
    expect(container.querySelector('hr')).toBeInTheDocument();
    rerender(<RuleDivider variant="double" spacing="xl" />);
    expect(container.querySelector('hr')).toBeInTheDocument();
  });
});

describe('SearchInput', () => {
  it('renders a search input and accepts props', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SearchInput className="z" placeholder="find" onChange={onChange} />);
    const input = screen.getByPlaceholderText('find');
    expect(input).toHaveAttribute('type', 'search');
    await user.type(input, 'a');
    expect(onChange).toHaveBeenCalled();
  });
});

describe('Stat', () => {
  it('renders as a div without onClick', () => {
    render(<Stat value={42} label="Count" hint="info" />);
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('info')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('renders as a button when onClick is given and reflects active/trend', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Stat value={1} label="L" active trend="up" onClick={onClick} />);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
  });
});

describe('Tag', () => {
  it('renders as a span with a prefix by default', () => {
    render(<Tag>topic</Tag>);
    expect(screen.getByText('topic')).toBeInTheDocument();
    expect(screen.getByText('#')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('renders as a button when onClick is given; empty prefix is hidden', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Tag onClick={onClick} tone="accent" size="sm" prefix="">x</Tag>);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
    expect(screen.queryByText('#')).toBeNull();
  });
});

describe('Toolbar', () => {
  it('renders start only', () => {
    render(<Toolbar start={<span>left</span>} />);
    expect(screen.getByText('left')).toBeInTheDocument();
  });
  it('renders both start and end', () => {
    render(<Toolbar start={<span>left</span>} end={<span>right</span>} />);
    expect(screen.getByText('right')).toBeInTheDocument();
  });
});

describe('ui index', () => {
  it('re-exports the kit primitives', () => {
    expect(uiIndex.Button).toBeTypeOf('function');
    expect(uiIndex.Modal).toBeTypeOf('function');
    expect(uiIndex.RuleDivider).toBeTypeOf('function');
    expect(uiIndex.Eyebrow).toBeTypeOf('function');
  });
});
