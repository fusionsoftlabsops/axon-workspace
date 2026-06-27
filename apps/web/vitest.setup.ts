import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom lacks these — stub so components that touch them render without throwing.
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as never;
  }
  window.scrollTo = vi.fn() as never;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  class Observer {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn(() => []);
  }
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = Observer as never;
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = Observer as never;
}
