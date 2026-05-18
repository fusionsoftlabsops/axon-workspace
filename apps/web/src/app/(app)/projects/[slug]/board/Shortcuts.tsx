'use client';

import { useEffect } from 'react';

/**
 * Board keyboard shortcuts:
 *  - `c`   open new-task affordance (clicks the first .addBtn on the page)
 *  - `?`   focus the search input if present
 *  - `esc` cancel inline editors / blur
 */
export function BoardShortcuts() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore when typing in any editable element.
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return;
      }

      if (e.key === 'c') {
        const btn = document.querySelector<HTMLButtonElement>('[data-shortcut="new-task"]');
        if (btn) {
          e.preventDefault();
          btn.click();
        }
      } else if (e.key === 'Escape') {
        (document.activeElement as HTMLElement | null)?.blur();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return null;
}
