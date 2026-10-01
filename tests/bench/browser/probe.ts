/**
 * The in-page side of the browser harness (tests/bench/browser/README.md): a script installed in
 * every page before the app's own scripts (`addInitScript`), which records what the measurements
 * need. It changes nothing the app sees, and adds no work to a frame:
 *
 * - **User Timing:** every `frl:*` measure the app records (`frl:map:sync`, `frl:map:set-layer`,
 *   `frl:map:update-paths`, `frl:map:redraw`, `frl:map:labels`, `frl:derived`). `performance.measure`
 *   is wrapped (it calls the original and records the entry it returns), so the app clearing its own
 *   measures loses nothing here, and each measure says whether it was taken inside an animation-frame
 *   callback (`inFrame`): `requestAnimationFrame` is wrapped to count the callbacks running.
 * - **Long tasks** (`longtask` entries) and the **input** the harness sends (each `pointerdown` and
 *   `keydown`, with its `event.timeStamp`, captured before the app's listeners).
 * - **Frames**, only while recording: each frame's time and when the recorder's callback ran (the
 *   recorder's callback is the first of its frame: it asks for the next frame before anything else
 *   can). Nothing on screen changes, so a frame with no other work stays as cheap as without it.
 *
 * A first version marked each frame's rendering with a ResizeObserver on a 1 px element resized every
 * frame. On this kind of machine (software rendering) that cost about 3 ms of main-thread work per
 * frame, 12 ms at 4×, which delayed the app's own tasks; it was dropped.
 *
 * The script is plain JavaScript in a string, not a serialised function: the harness runs under
 * tsx, which wraps functions in a `__name` helper the page does not have. `checkProbeSyntax`
 * compiles it in Node before any browser starts.
 */

/** The page global the probe installs. */
export const PROBE_GLOBAL = '__frlBench';

export const PROBE_SOURCE = String.raw`(() => {
  if (window.__frlBench !== undefined) return;
  const now = () => performance.now();
  const bench = {
    measures: [],
    longTasks: [],
    inputs: [],
    frames: [],
    recording: false,
    errors: [],
  };
  window.__frlBench = bench;

  // Animation-frame callbacks running now.
  let inFrame = 0;
  const nativeRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => nativeRaf((time) => {
    inFrame += 1;
    try {
      return callback(time);
    } finally {
      inFrame -= 1;
    }
  });

  const nativeMeasure = performance.measure.bind(performance);
  performance.measure = (...args) => {
    const entry = nativeMeasure(...args);
    try {
      if (entry !== undefined && typeof entry.name === 'string' && entry.name.startsWith('frl:')) {
        bench.measures.push({ name: entry.name, start: entry.startTime, duration: entry.duration, inFrame: inFrame > 0 });
      }
    } catch (error) {
      bench.errors.push('measure: ' + String(error));
    }
    return entry;
  };

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) bench.longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch (error) {
    bench.errors.push('longtask observer: ' + String(error));
  }
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, (event) => {
      bench.inputs.push({ type, time: event.timeStamp, key: typeof event.key === 'string' ? event.key : null });
    }, { capture: true });
  }

  let generation = 0;
  const loop = (mine) => (time) => {
    if (!bench.recording || mine !== generation) return;
    // Asked for first, so the recorder's callback is the first of the next frame.
    nativeRaf(loop(mine));
    bench.frames.push({ raf: time, called: now() });
  };
  /** Starts recording frames (clearing the earlier ones); one recorder at a time. */
  bench.startFrames = () => {
    bench.frames = [];
    bench.recording = true;
    generation += 1;
    nativeRaf(loop(generation));
  };
  bench.stopFrames = () => {
    bench.recording = false;
    generation += 1;
  };
  /** Counts, to take a slice of what comes after them. */
  bench.mark = () => ({ measures: bench.measures.length, longTasks: bench.longTasks.length, inputs: bench.inputs.length, time: now() });
  /**
   * Resolves once no frl:map or frl:derived measure has ended for quietMs (and at least minMs have
   * passed since since), or after maxMs; with the last activity's end and whether it timed out.
   */
  bench.waitQuiet = (fromMeasure, since, quietMs, minMs, maxMs) => new Promise((resolve) => {
    const started = now();
    const tick = () => {
      let last = since;
      for (let i = fromMeasure; i < bench.measures.length; i += 1) {
        const m = bench.measures[i];
        if (!(m.name.startsWith('frl:map:') || m.name === 'frl:derived')) continue;
        const end = m.start + m.duration;
        if (end > last) last = end;
      }
      const t = now();
      if (t - started >= maxMs) {
        resolve({ last, timedOut: true, waitedMs: t - started });
        return;
      }
      if (t - last >= quietMs && t - since >= minMs) {
        resolve({ last, timedOut: false, waitedMs: t - started });
        return;
      }
      setTimeout(tick, 25);
    };
    setTimeout(tick, 25);
  });
  /** What was recorded since a mark (frames are the current recording). */
  bench.since = (mark) => ({
    measures: bench.measures.slice(mark.measures),
    longTasks: bench.longTasks.slice(mark.longTasks),
    inputs: bench.inputs.slice(mark.inputs),
    frames: bench.frames.slice(),
    now: now(),
  });
})();`;

/** Compiles the probe in Node (it is never run here), so a syntax error stops the harness before any browser starts. */
export function checkProbeSyntax(): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- compiling (not running) our own constant, as a syntax check
  new Function(PROBE_SOURCE);
}

export interface ProbeMeasure {
  readonly name: string;
  readonly start: number;
  readonly duration: number;
  /** Taken inside an animation-frame callback: drawn in that frame. */
  readonly inFrame: boolean;
}

export interface ProbeTask {
  readonly start: number;
  readonly duration: number;
}

export interface ProbeInput {
  readonly type: 'pointerdown' | 'keydown';
  readonly time: number;
  readonly key: string | null;
}

export interface ProbeFrame {
  /** The frame's time (the rAF callback's argument). */
  readonly raf: number;
  /** performance.now() in the recorder's callback, the first of the frame. */
  readonly called: number;
}

export interface ProbeMark {
  readonly measures: number;
  readonly longTasks: number;
  readonly inputs: number;
  readonly time: number;
}

export interface ProbeSince {
  readonly measures: readonly ProbeMeasure[];
  readonly longTasks: readonly ProbeTask[];
  readonly inputs: readonly ProbeInput[];
  readonly frames: readonly ProbeFrame[];
  readonly now: number;
}

export interface QuietResult {
  readonly last: number;
  readonly timedOut: boolean;
  readonly waitedMs: number;
}

/** A JavaScript expression calling the probe (the harness evaluates expressions, never functions). */
export function probeCall(method: 'mark' | 'startFrames' | 'stopFrames' | 'waitQuiet' | 'since', ...args: readonly unknown[]): string {
  return `window.${PROBE_GLOBAL}.${method}(${args.map((arg) => JSON.stringify(arg)).join(', ')})`;
}
