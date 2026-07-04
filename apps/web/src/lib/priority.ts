/**
 * Visual metadata for HU priority levels, used by the board's TaskCard to
 * render a consistent priority indicator (icon + color) across all cards.
 * Purely presentational: does not affect priority assignment logic.
 */

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface PriorityMeta {
  level: Priority;
  color: string; // distinctive text/border color
  icon: string; // glyph used in the badge (icon-first, color-second)
  label: string; // canonical (Spanish) label; components may localize further
  order: number;
}

export const PRIORITY_META: Record<Priority, PriorityMeta> = {
  LOW: { level: 'LOW', color: '#5B6B7B', icon: '▽', label: 'Baja', order: 0 },
  MEDIUM: { level: 'MEDIUM', color: '#B7791F', icon: '=', label: 'Media', order: 1 },
  HIGH: { level: 'HIGH', color: '#C2410C', icon: '△', label: 'Alta', order: 2 },
  URGENT: { level: 'URGENT', color: '#DC2626', icon: '⚑', label: 'Urgente', order: 3 },
};

const VALID_PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

/** Normalizes any incoming value (case-insensitive) to a known Priority, defaulting to MEDIUM. */
export function normalizePriority(value: string | null | undefined): Priority {
  const v = (value ?? '').toUpperCase();
  return (VALID_PRIORITIES as string[]).includes(v) ? (v as Priority) : 'MEDIUM';
}

/** Metadata (icon, color, label, order) for a given (possibly unknown) priority value. */
export function priorityMeta(value: string | null | undefined): PriorityMeta {
  return PRIORITY_META[normalizePriority(value)];
}
