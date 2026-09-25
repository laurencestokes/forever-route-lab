import type { ProjectV1 } from '../domain';
import type { Selection } from './selection';

/**
 * Undo/redo history (docs/ARCHITECTURE.md §12.2): immutable project snapshots with structural
 * sharing, so a snapshot costs only what its neighbour does not share. Every function here returns
 * a new History and never mutates its input.
 */

/** A project plus the selection that went with it, restored together by undo and redo. */
export interface Snapshot {
  readonly project: ProjectV1;
  readonly selection: Selection;
}

export interface HistoryEntry extends Snapshot {
  /** Label of the command between this snapshot and its neighbour ("Undo <label>"). */
  readonly label: string;
  /** Approximate bytes this snapshot keeps alive beyond its neighbour (estimateRetainedBytes). */
  readonly bytes: number;
}

export interface History {
  /** Oldest first; the last entry is what undo restores. */
  readonly past: readonly HistoryEntry[];
  /** Furthest first; the last entry is what redo restores. */
  readonly future: readonly HistoryEntry[];
  /**
   * The open coalescing group: the key of the last recorded command and when it ran. Any history
   * event other than a matching command closes it.
   */
  readonly coalesce: { readonly key: string; readonly atMs: number | null } | null;
}

export interface HistoryLimits {
  /** Maximum number of undo entries. 0 disables undo. */
  readonly maxEntries: number;
  /**
   * Approximate bound on the bytes the undo entries retain (see estimateRetainedBytes). The most
   * recent entry is always kept, even when it alone exceeds the bound.
   */
  readonly maxBytes: number;
  /**
   * Commands with the same coalesce key merge while each follows the previous one within this
   * many milliseconds (a sliding window). null: no time limit, only the key and adjacency count.
   */
  readonly coalesceWindowMs: number | null;
}

/**
 * 200 entries (§12.2). 32 MiB: a 3,000-step route costs about 24 KiB per snapshot when only the
 * step array changes, so ordinary edits never reach the bound; it only bites on repeated bulk
 * changes (imports, whole-route rewrites) that each replace megabytes. 1 s coalesces typing
 * bursts and held-key moves while a pause starts a new undo step.
 */
export const DEFAULT_HISTORY_LIMITS: HistoryLimits = {
  maxEntries: 200,
  maxBytes: 32 * 1024 * 1024,
  coalesceWindowMs: 1000,
};

export const EMPTY_HISTORY: History = { past: [], future: [], coalesce: null };

// Size estimate --------------------------------------------------------------------------------

/**
 * Rough V8 costs (64-bit, pointer compression off): an object or array header, one property or
 * element slot, a string header plus two bytes per UTF-16 code unit. Numbers, booleans and null
 * are counted in their slot; property names are interned and cost nothing per object. The
 * absolute value is approximate; what matters is that it scales with the memory a snapshot
 * actually pins.
 */
const OBJECT_BYTES = 32;
const SLOT_BYTES = 8;
const STRING_BYTES = 16;

/**
 * Approximate bytes reachable from `value` that are not shared with `other` (by identity).
 * Arrays match elements by identity first, so an insertion or a move does not count the shifted
 * elements as new; an unmatched element is compared with the element at the same index, which
 * finds sharing inside an edited step (its location, origin, condition).
 */
function retainedBytes(value: unknown, other: unknown): number {
  if (value === other) return 0;
  if (typeof value === 'string') return STRING_BYTES + 2 * value.length;
  if (typeof value !== 'object' || value === null) return 0;
  if (Array.isArray(value)) {
    const peers: readonly unknown[] = Array.isArray(other) ? other : [];
    const shared = new Set<unknown>(peers);
    let bytes = OBJECT_BYTES + SLOT_BYTES * value.length;
    value.forEach((element: unknown, i) => {
      if (!shared.has(element)) bytes += retainedBytes(element, peers[i]);
    });
    return bytes;
  }
  const peer = typeof other === 'object' && other !== null && !Array.isArray(other) ? (other as Record<string, unknown>) : null;
  let bytes = OBJECT_BYTES;
  for (const [key, child] of Object.entries(value)) {
    // Own keys only: an id-keyed record may use a key such as `toString` that the peer lacks.
    bytes += SLOT_BYTES + retainedBytes(child, peer !== null && Object.hasOwn(peer, key) ? peer[key] : undefined);
  }
  return bytes;
}

/**
 * Approximate bytes `snapshot` keeps alive that `neighbour` does not share. Summed over the
 * history, this approximates the memory held beyond the present project. Cost is proportional to
 * what changed plus the length of any changed array (the step list), not the whole project.
 */
export function estimateRetainedBytes(snapshot: ProjectV1, neighbour: ProjectV1): number {
  return retainedBytes(snapshot, neighbour);
}

const totalBytes = (entries: readonly HistoryEntry[]): number => entries.reduce((sum, e) => sum + e.bytes, 0);

function trim(past: readonly HistoryEntry[], limits: HistoryLimits): readonly HistoryEntry[] {
  let out = past.length > limits.maxEntries ? past.slice(past.length - limits.maxEntries) : past;
  let bytes = totalBytes(out);
  let drop = 0;
  while (bytes > limits.maxBytes && out.length - drop > 1) {
    bytes -= out[drop]?.bytes ?? 0;
    drop += 1;
  }
  if (drop > 0) out = out.slice(drop);
  return out;
}

// Operations -----------------------------------------------------------------------------------

export interface RecordedChange {
  /** The present before the command. */
  readonly before: Snapshot;
  /** The project after the command (already stamped). */
  readonly after: ProjectV1;
  readonly label: string;
  readonly coalesceKey: string | null;
  /** When the command ran, for the coalescing window; null when the clock is unreadable. */
  readonly atMs: number | null;
}

function withinWindow(open: NonNullable<History['coalesce']>, atMs: number | null, windowMs: number | null): boolean {
  if (windowMs === null) return true;
  return atMs !== null && open.atMs !== null && atMs >= open.atMs && atMs - open.atMs <= windowMs;
}

/**
 * Records a command's change. The redo stack is cleared. When the command continues the open
 * coalescing group, the group's undo entry (the state before the group started) is kept and only
 * its size is refreshed, so one undo reverts the whole group.
 */
export function recordChange(history: History, change: RecordedChange, limits: HistoryLimits): History {
  const { before, after, label, coalesceKey, atMs } = change;
  const coalesce = coalesceKey === null ? null : { key: coalesceKey, atMs };
  const open = history.coalesce;
  const top = history.past.at(-1);
  if (
    coalesceKey !== null &&
    open !== null &&
    open.key === coalesceKey &&
    top !== undefined &&
    withinWindow(open, atMs, limits.coalesceWindowMs)
  ) {
    const merged: HistoryEntry = { ...top, bytes: estimateRetainedBytes(top.project, after) };
    return { past: trim([...history.past.slice(0, -1), merged], limits), future: [], coalesce };
  }
  if (limits.maxEntries === 0) return EMPTY_HISTORY;
  const entry: HistoryEntry = { ...before, label, bytes: estimateRetainedBytes(before.project, after) };
  return { past: trim([...history.past, entry], limits), future: [], coalesce };
}

export interface HistoryMove {
  readonly history: History;
  /** The snapshot to make present. */
  readonly restored: Snapshot;
  /** Label of the command undone or redone. */
  readonly label: string;
}

/** Steps back one entry; `present` moves to the redo stack. Null when there is nothing to undo. */
export function undoHistory(history: History, present: Snapshot): HistoryMove | null {
  const top = history.past.at(-1);
  if (top === undefined) return null;
  const entry: HistoryEntry = { ...present, label: top.label, bytes: estimateRetainedBytes(present.project, top.project) };
  return {
    history: { past: history.past.slice(0, -1), future: [...history.future, entry], coalesce: null },
    restored: { project: top.project, selection: top.selection },
    label: top.label,
  };
}

/** Steps forward one entry; `present` moves to the undo stack. Null when there is nothing to redo. */
export function redoHistory(history: History, present: Snapshot): HistoryMove | null {
  const top = history.future.at(-1);
  if (top === undefined) return null;
  const entry: HistoryEntry = { ...present, label: top.label, bytes: estimateRetainedBytes(present.project, top.project) };
  return {
    history: { past: [...history.past, entry], future: history.future.slice(0, -1), coalesce: null },
    restored: { project: top.project, selection: top.selection },
    label: top.label,
  };
}

/** Closes the open coalescing group, so the next command starts a new undo entry. */
export function closeCoalescing(history: History): History {
  return history.coalesce === null ? history : { ...history, coalesce: null };
}

/** Approximate bytes retained by all entries, undo and redo. */
export function historyBytes(history: History): number {
  return totalBytes(history.past) + totalBytes(history.future);
}
