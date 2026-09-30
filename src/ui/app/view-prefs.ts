import type { EstimateColumn, TopNumber } from '../route/rows';
import type { RowDensity } from '../route/virtual';

/**
 * The shell's per-browser preferences (docs/research/ui-refresh.md §4.1, §4.3; D-048): the route
 * rows' density and numbers (View), the side panels' widths, which panels are collapsed, and map
 * focus. They are view settings, not project data: not in the project file, not exported, not
 * undone. They live in one `localStorage` key in the pattern of the theme and the map style (the
 * settings store the drawer's record will join, map-presentation.md §25.3.7). Every access is
 * guarded: a private window, blocked storage or a quota error keeps the choice for this page load
 * only, and an absent or unreadable record gives the defaults, field by field.
 */

export const SHELL_PREFS_KEY = 'forever-route-lab:shell';

/** What the preferences need of `Storage`. */
export interface PrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ShellPrefs {
  /** Two-line rows (default, D-048 A) or one-line rows. */
  readonly density: RowDensity;
  /** Two-line rows: XP gained (default) or the step time over the level after. */
  readonly topNumber: TopNumber;
  /** One-line rows: the one estimate shown (default the level after). */
  readonly column: EstimateColumn;
  /** Side panel widths in px; null for the default. */
  readonly leftWidth: number | null;
  readonly rightWidth: number | null;
  /** A side panel put away from its handle or separator. */
  readonly leftCollapsed: boolean;
  readonly rightCollapsed: boolean;
  /** Map focus: both side panels hidden, the collapse flags kept for its end. */
  readonly mapFocus: boolean;
}

export const DEFAULT_SHELL_PREFS: ShellPrefs = {
  density: 'two-line',
  topNumber: 'xp',
  column: 'level',
  leftWidth: null,
  rightWidth: null,
  leftCollapsed: false,
  rightCollapsed: false,
  mapFocus: false,
};

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const flag = (value: unknown): boolean => value === true;
const width = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** The stored preferences, each field checked on its own; the defaults for what is absent or unreadable. */
export function readShellPrefs(storage: () => PrefsStorage | null): ShellPrefs {
  let raw: unknown;
  try {
    const text = storage()?.getItem(SHELL_PREFS_KEY) ?? null;
    raw = text === null ? null : JSON.parse(text);
  } catch {
    raw = null;
  }
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SHELL_PREFS;
  const r = raw as Partial<Record<keyof ShellPrefs, unknown>>;
  const d = DEFAULT_SHELL_PREFS;
  return {
    density: pick(r.density, ['two-line', 'one-line'], d.density),
    topNumber: pick(r.topNumber, ['xp', 'time'], d.topNumber),
    column: pick(r.column, ['level', 'xp', 'time'], d.column),
    leftWidth: width(r.leftWidth),
    rightWidth: width(r.rightWidth),
    leftCollapsed: flag(r.leftCollapsed),
    rightCollapsed: flag(r.rightCollapsed),
    mapFocus: flag(r.mapFocus),
  };
}

/** Stores the preferences; a storage that refuses keeps them for this page load. */
export function writeShellPrefs(storage: () => PrefsStorage | null, prefs: ShellPrefs): void {
  try {
    storage()?.setItem(SHELL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Not stored: the choice holds for this page load.
  }
}

/** The browser's `localStorage`, or null where there is none (tests without a window). */
export function browserStorage(): PrefsStorage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}
