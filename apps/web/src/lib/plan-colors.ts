/**
 * Per-user chat colors for the planning chat. A stable default palette assigns
 * each member a distinct color; explicit overrides (stored per project) win.
 */

// Distinct, reasonably readable bubble colors.
export const CHAT_PALETTE = [
  '#3b82f6', // blue
  '#f97316', // orange
  '#22c55e', // green
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#eab308', // amber
  '#ef4444', // red
  '#06b6d4', // cyan
  '#a855f7', // purple
  '#84cc16', // lime
  '#f43f5e', // rose
];

/** Stable default color for a user, by their position in the member list. */
export function defaultColorFor(userId: string | undefined, members: { userId: string }[]): string {
  if (!userId) return CHAT_PALETTE[0]!;
  const idx = members.findIndex((m) => m.userId === userId);
  const i = idx >= 0 ? idx : hashIndex(userId, CHAT_PALETTE.length);
  return CHAT_PALETTE[i % CHAT_PALETTE.length]!;
}

/** The color to actually use: explicit override, else the stable default. */
export function effectiveColor(
  userId: string | undefined,
  colors: Record<string, string>,
  members: { userId: string }[],
): string {
  if (userId && colors[userId]) return colors[userId]!;
  return defaultColorFor(userId, members);
}

/** Black or white text for readability over a given hex background. */
export function contrastText(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return '#ffffff';
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // Perceived luminance (sRGB approximation).
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#111111' : '#ffffff';
}

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Deterministic index from a string (fallback when a user isn't in the list). */
function hashIndex(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % mod;
}
