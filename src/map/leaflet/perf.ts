/**
 * User Timing marks around the map's hot paths, for the ARCHITECTURE §14 budgets ("moveend redraw
 * at the LOD cap ≤ 16 ms, one route edit applied ≤ 8 ms", measured with Playwright in Milestone 9;
 * docs/MAPS.md §7.2). No Leaflet import.
 *
 * Measure names (each with a `detail` object where the browser supports it):
 * - `frl:map:set-layer` — one `setLayer` call: diff and apply (`detail.layer`, `added`, `removed`,
 *   `changed`, `skipped`);
 * - `frl:map:update-paths` — the canvas renderer's full update on `moveend`/`zoomend`: re-project
 *   every path and redraw;
 * - `frl:map:redraw` — one canvas redraw (the whole canvas or a dirty rectangle).
 *
 * Start and end marks are cleared after each measure, and a name's measures are cleared once it
 * has `maxMeasuresPerName`, so a long session does not grow the timeline without bound.
 */

/** The part of `Performance` the timer uses. */
export interface PerformanceLike {
  mark(name: string): unknown;
  measure(name: string, options: { readonly start: string; readonly end: string; readonly detail?: unknown }): unknown;
  clearMarks(name?: string): void;
  clearMeasures(name?: string): void;
}

export interface MapPerf {
  /** Runs `fn` between two marks and records a measure named `name`. `detail` is computed after `fn` returns. */
  time<T>(name: string, fn: () => T, detail?: (result: T) => Readonly<Record<string, unknown>>): T;
}

export const NO_PERF: MapPerf = { time: (_name, fn) => fn() };

export function createMapPerf(performance: PerformanceLike | null, maxMeasuresPerName = 500): MapPerf {
  if (performance === null) return NO_PERF;
  let serial = 0;
  const counts = new Map<string, number>();
  return {
    time(name, fn, detail) {
      serial += 1;
      const start = `${name}:start:${String(serial)}`;
      const end = `${name}:end:${String(serial)}`;
      performance.mark(start);
      let result: ReturnType<typeof fn>;
      try {
        result = fn();
      } catch (error) {
        performance.clearMarks(start);
        throw error;
      }
      try {
        performance.mark(end);
        const count = (counts.get(name) ?? 0) + 1;
        if (count > maxMeasuresPerName) {
          performance.clearMeasures(name);
          counts.set(name, 1);
        } else counts.set(name, count);
        performance.measure(name, detail === undefined ? { start, end } : { start, end, detail: detail(result) });
      } catch {
        // A timeline that refuses a mark or measure (an old engine, a full buffer) must not break the map.
      } finally {
        performance.clearMarks(start);
        performance.clearMarks(end);
      }
      return result;
    },
  };
}

/** The page's `performance`, or null where User Timing is missing. */
export function pagePerformance(): PerformanceLike | null {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function' || typeof performance.measure !== 'function') return null;
  return performance;
}
