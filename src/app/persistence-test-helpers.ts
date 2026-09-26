import type { IdSource, ProjectV1 } from '../domain';
import {
  announcingChanges,
  broadcastChanges,
  createMemoryProjectStorage,
  type ProjectLocks,
  type ProjectStorage,
  type StorageChangeChannel,
  webLocks,
} from '../infra/persistence';
import { fakeChannelHub, fakeLockManager } from '../infra/persistence/test-doubles';
import type { AutosaveHost, AutosaveTiming } from './autosave';
import { manualClock, type ManualClock } from './clock';
import type { DatasetSource } from './dataset-source';
import { randomIdSource } from './ids';
import { createProjectSession, type LifecycleSource, type ProjectSession, restoreStartupProject, type StartupProject } from './persistence';
import { createProjectLibrary, type ProjectLibrary } from './project-library';
import { createEditorStore, type EditorStore } from './store';

/**
 * Test fixtures for project storage and the session: a manual autosave host and a session over
 * memory storage (the ui tests may not import infra themselves, ARCHITECTURE §4). Not exported from
 * the app index; only tests import this file.
 */

export { createMemoryProjectStorage, fakeChannelHub, fakeLockManager };

export interface ManualAutosaveHost {
  readonly host: AutosaveHost;
  /** Moves time on, firing due timers in order. */
  advance(ms: number): void;
  /** Runs the idle callbacks requested so far (the browser found an idle moment). */
  idle(): void;
  /** Timers and idle callbacks waiting. */
  pendingCount(): number;
}

export function manualAutosaveHost(): ManualAutosaveHost {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { readonly at: number; readonly callback: () => void }>();
  const idles = new Map<number, { readonly deadline: number; readonly callback: () => void }>();
  const host: AutosaveHost = {
    setTimer(callback, ms) {
      const id = (seq += 1);
      timers.set(id, { at: now + ms, callback });
      return () => {
        timers.delete(id);
      };
    },
    requestIdle(callback, timeoutMs) {
      const id = (seq += 1);
      idles.set(id, { deadline: now + timeoutMs, callback });
      return () => {
        idles.delete(id);
      };
    },
    now: () => now,
  };
  const runDue = () => {
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      const overdue = [...idles].filter(([, t]) => t.deadline <= now).sort((a, b) => a[1].deadline - b[1].deadline || a[0] - b[0])[0];
      const next = due ?? overdue;
      if (next === undefined) return;
      timers.delete(next[0]);
      idles.delete(next[0]);
      next[1].callback();
    }
  };
  return {
    host,
    advance(ms) {
      now += ms;
      runDue();
    },
    idle() {
      for (const [id, entry] of [...idles]) {
        idles.delete(id);
        entry.callback();
      }
    },
    pendingCount: () => timers.size + idles.size,
  };
}

/** A lifecycle source the test fires by hand. */
export function manualLifecycle(): LifecycleSource & { hide(): void; wouldAskBeforeClosing(): boolean } {
  const flushes = new Set<() => void>();
  const guards = new Set<() => boolean>();
  return {
    onHide(flush) {
      flushes.add(flush);
      return () => {
        flushes.delete(flush);
      };
    },
    onBeforeUnload(unkept) {
      guards.add(unkept);
      return () => {
        guards.delete(unkept);
      };
    },
    hide() {
      for (const flush of [...flushes]) flush();
    },
    /** Whether closing the page now would bring up the browser's "Leave site?" question. */
    wouldAskBeforeClosing: () => [...guards].some((unkept) => unkept()),
  };
}

/** What one test "tab" shares with the others: the locks and a channel of its own. */
export interface TestTabs {
  readonly locks: ProjectLocks;
  readonly channel: StorageChangeChannel;
}

/** Tabs sharing one lock manager and one channel hub: `tab()` makes the links of one more tab. */
export function testTabs(): { readonly manager: ReturnType<typeof fakeLockManager>; tab(): TestTabs } {
  const manager = fakeLockManager();
  const hub = fakeChannelHub();
  return {
    manager,
    tab: () => ({ locks: webLocks(manager), channel: broadcastChanges(hub.connect()) }),
  };
}

export const TEST_AUTOSAVE_TIMING: AutosaveTiming = { quietMs: 100, idleTimeoutMs: 1000, maxWaitMs: 1000 };

export interface TestSessionOptions {
  readonly data: DatasetSource;
  readonly createSample: (nowIso: string) => ProjectV1;
  readonly storage?: ProjectStorage | undefined;
  readonly clock?: ManualClock | undefined;
  readonly ids?: IdSource | undefined;
  /** Makes the session behave as when the browser refuses storage (with memory storage). */
  readonly unavailable?: string | null | undefined;
  readonly timing?: AutosaveTiming | undefined;
  readonly sampleName?: string | undefined;
  /** This tab's links to the other tabs of the test (`testTabs().tab()`); omitted: none. */
  readonly tabs?: TestTabs | undefined;
}

export interface TestSession {
  readonly session: ProjectSession;
  readonly store: EditorStore;
  readonly library: ProjectLibrary;
  readonly storage: ProjectStorage;
  readonly startup: StartupProject;
  readonly host: ManualAutosaveHost;
  readonly lifecycle: ReturnType<typeof manualLifecycle>;
  readonly clock: ManualClock;
}

/** A start over `storage` (memory by default): restore, store, session. */
export async function createTestSession(opts: TestSessionOptions): Promise<TestSession> {
  const tabs = opts.tabs ?? null;
  const base = opts.storage ?? createMemoryProjectStorage();
  // As openProjectStorage does: the tab's storage tells the others about its changes.
  const storage = tabs === null ? base : announcingChanges(base, tabs.channel);
  const clock = opts.clock ?? manualClock('2026-09-25T12:00:00.000Z');
  const ids = opts.ids ?? randomIdSource();
  const library = createProjectLibrary({ storage, clock, ids });
  const sampleName = opts.sampleName ?? 'Sample project';
  const createSample = () => opts.createSample(clock.nowIso());
  const startup = await restoreStartupProject({ library, data: opts.data, clock, ids, createSample, sampleName, locks: tabs?.locks ?? null });
  const store = createEditorStore({ project: startup.project, ids, clock });
  const host = manualAutosaveHost();
  const lifecycle = manualLifecycle();
  const session = createProjectSession({
    store,
    library,
    data: opts.data,
    startup,
    clock,
    ids,
    unavailable: opts.unavailable ?? null,
    createSample,
    sampleName,
    host: host.host,
    timing: opts.timing ?? TEST_AUTOSAVE_TIMING,
    lifecycle,
    locks: tabs?.locks ?? null,
    channel: tabs?.channel ?? null,
  });
  await session.refresh();
  return { session, store, library, storage, startup, host, lifecycle, clock };
}

/** Lets storage answers and the callbacks waiting on them run (a few macrotasks). */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}
