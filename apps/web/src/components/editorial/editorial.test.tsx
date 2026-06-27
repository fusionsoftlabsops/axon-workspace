import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DropCap } from './DropCap';
import { Marginalia } from './Marginalia';
import { Masthead } from './Masthead';
import { PullQuote } from './PullQuote';
import * as editorialIndex from './index';

describe('DropCap', () => {
  it('renders children wrapped when no letter is given', () => {
    render(<DropCap><p>Hello world</p></DropCap>);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders only the first character in standalone letter mode', () => {
    render(<DropCap letter="Axon" />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.queryByText('Axon')).not.toBeInTheDocument();
  });
});

describe('Marginalia', () => {
  it('renders body and optional label', () => {
    render(<Marginalia label="note">side text</Marginalia>);
    expect(screen.getByText('note')).toBeInTheDocument();
    expect(screen.getByText('side text')).toBeInTheDocument();
  });

  it('renders without a label and with the inline variant', () => {
    const { container } = render(<Marginalia variant="inline">just body</Marginalia>);
    expect(screen.getByText('just body')).toBeInTheDocument();
    expect(container.querySelector('aside')).toBeInTheDocument();
  });
});

describe('Masthead', () => {
  it('renders title only by default with rule', () => {
    const { container } = render(<Masthead>The Title</Masthead>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The Title');
    // rule div present by default
    expect(container.querySelector('header')?.lastElementChild?.tagName).toBe('DIV');
  });

  it('renders eyebrow, deck and respects rule=false / size / align', () => {
    const { container } = render(
      <Masthead eyebrow="EB" deck="the deck" size="xl" align="center" rule={false}>
        Title
      </Masthead>,
    );
    expect(screen.getByText('EB')).toBeInTheDocument();
    expect(screen.getByText('the deck')).toBeInTheDocument();
    // no rule div: header's last child is the deck <p>
    expect(container.querySelector('header')?.lastElementChild?.tagName).toBe('P');
  });
});

describe('PullQuote', () => {
  it('renders body without cite by default', () => {
    render(<PullQuote>quoted text</PullQuote>);
    expect(screen.getByText('quoted text')).toBeInTheDocument();
    expect(document.querySelector('cite')).toBeNull();
  });

  it('renders cite and align variant', () => {
    render(<PullQuote cite="Author" align="right">body</PullQuote>);
    expect(screen.getByText('— Author')).toBeInTheDocument();
  });
});

describe('editorial index', () => {
  it('re-exports the primitives', () => {
    expect(editorialIndex.Masthead).toBeTypeOf('function');
    expect(editorialIndex.DropCap).toBeTypeOf('function');
    expect(editorialIndex.PullQuote).toBeTypeOf('function');
    expect(editorialIndex.Marginalia).toBeTypeOf('function');
  });
});
