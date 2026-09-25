import { describe, expect, it } from 'vitest';
import type { ProjectV1 } from '../domain';
import {
  closeCoalescing,
  DEFAULT_HISTORY_LIMITS,
  EMPTY_HISTORY,
  estimateRetainedBytes,
  type History,
  type HistoryLimits,
  historyBytes,
  recordChange,
  redoHistory,
  undoHistory,
} from './history';
import { EMPTY_SELECTION } from './selection';
import { notes, notesProject } from './test-helpers';

const NO_WINDOW: HistoryLimits = { ...DEFAULT_HISTORY_LIMITS, coalesceWindowMs: null };

function rename(project: ProjectV1, name: string): ProjectV1 {
  return { ...project, route: { ...project.route, name } };
}

/** Records `project → next` with the given key; returns the new history. */
function record(
  history: History,
  project: ProjectV1,
  next: ProjectV1,
  opts: { key?: string | null; atMs?: number | null; limits?: HistoryLimits; label?: string } = {},
): History {
  return recordChange(
    history,
    {
      before: { project, selection: EMPTY_SELECTION },
      after: next,
      label: opts.label ?? 'Edit',
      coalesceKey: opts.key ?? null,
      atMs: opts.atMs ?? 0,
    },
    opts.limits ?? NO_WINDOW,
  );
}

describe('recordChange', () => {
  it('pushes the previous snapshot and clears the redo stack', () => {
    const p0 = notesProject('ab');
    const p1 = rename(p0, 'one');
    const h1 = record(EMPTY_HISTORY, p0, p1, { label: 'Rename' });
    expect(h1.past.map((e) => [e.project, e.label])).toEqual([[p0, 'Rename']]);
    const undone = undoHistory(h1, { project: p1, selection: EMPTY_SELECTION });
    expect(undone?.history.future).toHaveLength(1);
    const h2 = record(undone?.history ?? EMPTY_HISTORY, p0, rename(p0, 'two'));
    expect(h2.future).toEqual([]);
  });

  it('coalesces consecutive commands with the same key into the first entry', () => {
    const p0 = notesProject('ab');
    const p1 = rename(p0, 'a');
    const p2 = rename(p0, 'ab');
    let h = record(EMPTY_HISTORY, p0, p1, { key: 'name' });
    h = record(h, p1, p2, { key: 'name' });
    expect(h.past).toHaveLength(1);
    expect(h.past[0]?.project).toBe(p0);
  });

  it('does not coalesce different keys, keyless commands, or across a closed group', () => {
    const p0 = notesProject('ab');
    const p1 = rename(p0, '1');
    const p2 = rename(p0, '2');
    expect(record(record(EMPTY_HISTORY, p0, p1, { key: 'a' }), p1, p2, { key: 'b' }).past).toHaveLength(2);
    expect(record(record(EMPTY_HISTORY, p0, p1), p1, p2).past).toHaveLength(2);
    expect(record(closeCoalescing(record(EMPTY_HISTORY, p0, p1, { key: 'a' })), p1, p2, { key: 'a' }).past).toHaveLength(2);
  });

  it('coalesces only within the sliding time window', () => {
    const limits: HistoryLimits = { ...DEFAULT_HISTORY_LIMITS, coalesceWindowMs: 1000 };
    const p = [0, 1, 2, 3].map((n) => rename(notesProject('a'), String(n)));
    const [p0, p1, p2, p3] = p as [ProjectV1, ProjectV1, ProjectV1, ProjectV1];
    let h = record(EMPTY_HISTORY, p0, p1, { key: 'k', atMs: 0, limits });
    h = record(h, p1, p2, { key: 'k', atMs: 900, limits });
    h = record(h, p2, p3, { key: 'k', atMs: 1800, limits }); // 900 ms after the previous one: still one group
    expect(h.past).toHaveLength(1);
    h = record(h, p3, p0, { key: 'k', atMs: 2801, limits });
    expect(h.past).toHaveLength(2);
    // An unreadable clock or one that went backwards starts a new group.
    expect(record(h, p0, p1, { key: 'k', atMs: null, limits }).past).toHaveLength(3);
    expect(record(h, p0, p1, { key: 'k', atMs: 100, limits }).past).toHaveLength(3);
  });

  it('caps the number of entries, dropping the oldest', () => {
    const limits: HistoryLimits = { ...NO_WINDOW, maxEntries: 3 };
    let h = EMPTY_HISTORY;
    const projects = [0, 1, 2, 3, 4, 5].map((n) => rename(notesProject('a'), String(n)));
    for (let i = 1; i < projects.length; i += 1) {
      h = record(h, projects[i - 1] as ProjectV1, projects[i] as ProjectV1, { limits, label: `step ${i}` });
    }
    expect(h.past.map((e) => e.label)).toEqual(['step 3', 'step 4', 'step 5']);
  });

  it('maxEntries 0 keeps no history', () => {
    const p0 = notesProject('a');
    expect(record(EMPTY_HISTORY, p0, rename(p0, 'x'), { limits: { ...NO_WINDOW, maxEntries: 0 } })).toEqual(EMPTY_HISTORY);
  });

  it('bounds the approximate size, always keeping the most recent entry', () => {
    const big = (tag: string): ProjectV1 => ({ ...notesProject('a'), ext: { blob: tag.repeat(10_000) } });
    const [p0, p1, p2, p3] = ['w', 'x', 'y', 'z'].map(big) as [ProjectV1, ProjectV1, ProjectV1, ProjectV1];
    const entryBytes = estimateRetainedBytes(p0, p1);
    expect(entryBytes).toBeGreaterThan(20_000);
    const limits: HistoryLimits = { ...NO_WINDOW, maxBytes: entryBytes * 2.5 };
    let h = record(EMPTY_HISTORY, p0, p1, { limits });
    h = record(h, p1, p2, { limits });
    h = record(h, p2, p3, { limits });
    expect(h.past.map((e) => e.project)).toEqual([p1, p2]);
    expect(historyBytes(h)).toBeLessThanOrEqual(limits.maxBytes);
    const tiny: HistoryLimits = { ...NO_WINDOW, maxBytes: 1 };
    expect(record(record(EMPTY_HISTORY, p0, p1, { limits: tiny }), p1, p2, { limits: tiny }).past.map((e) => e.project)).toEqual([p1]);
  });
});

describe('undoHistory / redoHistory', () => {
  it('walks back and forth, carrying labels and selections', () => {
    const p0 = notesProject('ab');
    const p1 = rename(p0, 'one');
    const p2 = rename(p1, 'two');
    const selection = { ...EMPTY_SELECTION, focus: null };
    let h = recordChange(
      EMPTY_HISTORY,
      { before: { project: p0, selection }, after: p1, label: 'First', coalesceKey: null, atMs: 0 },
      NO_WINDOW,
    );
    h = record(h, p1, p2, { label: 'Second' });

    const u1 = undoHistory(h, { project: p2, selection: EMPTY_SELECTION });
    expect(u1?.restored.project).toBe(p1);
    expect(u1?.label).toBe('Second');
    const u2 = undoHistory(u1?.history ?? EMPTY_HISTORY, { project: p1, selection: EMPTY_SELECTION });
    expect(u2?.restored).toEqual({ project: p0, selection });
    expect(u2?.label).toBe('First');
    expect(undoHistory(u2?.history ?? EMPTY_HISTORY, { project: p0, selection })).toBeNull();

    const r1 = redoHistory(u2?.history ?? EMPTY_HISTORY, { project: p0, selection });
    expect(r1?.restored.project).toBe(p1);
    expect(r1?.label).toBe('First');
    const r2 = redoHistory(r1?.history ?? EMPTY_HISTORY, { project: p1, selection: EMPTY_SELECTION });
    expect(r2?.restored.project).toBe(p2);
    expect(r2?.label).toBe('Second');
    expect(redoHistory(r2?.history ?? EMPTY_HISTORY, { project: p2, selection: EMPTY_SELECTION })).toBeNull();
    expect(r2?.history.past.map((e) => e.label)).toEqual(['First', 'Second']);
  });

  it('closes the coalescing group', () => {
    const p0 = notesProject('a');
    const p1 = rename(p0, 'x');
    const h = record(EMPTY_HISTORY, p0, p1, { key: 'k' });
    expect(undoHistory(h, { project: p1, selection: EMPTY_SELECTION })?.history.coalesce).toBeNull();
  });
});

describe('estimateRetainedBytes', () => {
  it('is zero for the same snapshot and small for a rename', () => {
    const p0 = notesProject('abcdef');
    expect(estimateRetainedBytes(p0, p0)).toBe(0);
    const renamed = rename(p0, 'x');
    const bytes = estimateRetainedBytes(p0, renamed);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(1000);
  });

  it('counts the step array but not steps shared by identity, even when shifted', () => {
    const p0 = notesProject('abcdefghij');
    const [extra] = notes('z');
    const inserted: ProjectV1 = { ...p0, route: { ...p0.route, steps: [extra, ...p0.route.steps] as ProjectV1['route']['steps'] } };
    const shiftCost = estimateRetainedBytes(p0, inserted);
    const reversed: ProjectV1 = { ...p0, route: { ...p0.route, steps: [...p0.route.steps].reverse() } };
    expect(estimateRetainedBytes(p0, reversed)).toBe(shiftCost);
    // A route with every step replaced retains far more.
    const replaced: ProjectV1 = { ...p0, route: { ...p0.route, steps: notes('abcdefghij') } };
    expect(estimateRetainedBytes(p0, replaced)).toBeGreaterThan(shiftCost * 5);
  });

  it('scales with changed string content', () => {
    const p0 = notesProject('a');
    const small = estimateRetainedBytes({ ...p0, ext: { s: 'x' } }, p0);
    const large = estimateRetainedBytes({ ...p0, ext: { s: 'x'.repeat(1000) } }, p0);
    expect(large - small).toBe(2 * 999);
  });

  it('keeps the default limits from the architecture', () => {
    expect(DEFAULT_HISTORY_LIMITS.maxEntries).toBe(200);
  });
});
