/** Light/dark theme — explicit, persistent toggle (not just prefers-color-scheme).
 *  The value lives in a cookie so the server can render `<html data-theme>` and
 *  avoid a flash; the client ThemeToggle keeps it in sync. */
export type Theme = 'light' | 'dark';

export const THEME_COOKIE = 'theme';
