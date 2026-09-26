/**
 * When to save (docs/ARCHITECTURE.md §12.3). A change starts a quiet period; each further change
 * restarts it, so a burst of edits (typing, a held key) is one save. When the period ends, the save
 * waits for an idle moment (`requestIdleCallback`, at most `idleTimeoutMs`), so it never competes
 * with the edit that caused it. Edits that never pause still save every `maxWaitMs`. `flush` saves
 * at once: the page calls it when it is hidden or unloaded (`visibilitychange`, `pagehide`).
 * Nothing here knows what a save is: the session passes `save`.
 */

export interface AutosaveTiming {
  /** How long the project must stay unchanged before a save is requested. */
  readonly quietMs: number;
  /** The idle callback's timeout: the longest a requested save waits for an idle moment. */
  readonly idleTimeoutMs: number;
  /** The longest the project stays unsaved while edits keep coming. */
  readonly maxWaitMs: number;
}

export const DEFAULT_AUTOSAVE_TIMING: AutosaveTiming = { quietMs: 750, idleTimeoutMs: 2000, maxWaitMs: 10_000 };

/** The timers autosave runs on; each returns its cancel function. */
export interface AutosaveHost {
  readonly setTimer: (callback: () => void, ms: number) => () => void;
  readonly requestIdle: (callback: () => void, timeoutMs: number) => () => void;
  /** Monotonic milliseconds. */
  readonly now: () => number;
}

interface IdleWindow {
  requestIdleCallback?: (callback: () => void, options: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

/** The browser's timers; `requestIdleCallback` where it exists (Safari lacks it), else a short timeout. */
export function browserAutosaveHost(): AutosaveHost {
  const idle = globalThis as IdleWindow;
  return {
    setTimer(callback, ms) {
      const handle = setTimeout(callback, ms);
      return () => {
        clearTimeout(handle);
      };
    },
    requestIdle(callback, timeoutMs) {
      const request = idle.requestIdleCallback;
      const cancel = idle.cancelIdleCallback;
      if (request !== undefined && cancel !== undefined) {
        const handle = request.call(globalThis, callback, { timeout: timeoutMs });
        return () => {
          cancel.call(globalThis, handle);
        };
      }
      const handle = setTimeout(callback, Math.min(timeoutMs, 50));
      return () => {
        clearTimeout(handle);
      };
    },
    now: () => performance.now(),
  };
}

export interface Autosave {
  /** The project changed: save once it has been quiet (or has waited `maxWaitMs`). */
  readonly notify: () => void;
  /** Cancels anything scheduled and saves now. */
  readonly flush: () => void;
  /** Cancels anything scheduled without saving. */
  readonly cancel: () => void;
  /** Whether a save is scheduled. */
  readonly pending: () => boolean;
}

export function createAutosave(save: () => void, host: AutosaveHost, timing: AutosaveTiming = DEFAULT_AUTOSAVE_TIMING): Autosave {
  let dirtySince: number | null = null;
  let cancelQuiet: (() => void) | null = null;
  let cancelIdle: (() => void) | null = null;

  const clear = () => {
    cancelQuiet?.();
    cancelIdle?.();
    cancelQuiet = null;
    cancelIdle = null;
    dirtySince = null;
  };

  const fire = () => {
    clear();
    save();
  };

  const requestSave = () => {
    cancelQuiet?.();
    cancelQuiet = null;
    cancelIdle ??= host.requestIdle(fire, timing.idleTimeoutMs);
  };

  return {
    notify() {
      const now = host.now();
      dirtySince ??= now;
      // Already waiting for an idle moment: that save will take this change too.
      if (cancelIdle !== null) return;
      if (now - dirtySince >= timing.maxWaitMs) {
        requestSave();
        return;
      }
      cancelQuiet?.();
      cancelQuiet = host.setTimer(requestSave, Math.min(timing.quietMs, timing.maxWaitMs - (now - dirtySince)));
    },
    flush: fire,
    cancel: clear,
    pending: () => cancelQuiet !== null || cancelIdle !== null,
  };
}
