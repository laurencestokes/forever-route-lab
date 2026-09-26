import { describe, expect, it } from 'vitest';
import { createMapPerf, NO_PERF, type PerformanceLike } from './perf';

function fakePerformance(): PerformanceLike & { readonly marks: Set<string>; readonly measures: { name: string; detail: unknown }[]; failMeasure: boolean } {
  const marks = new Set<string>();
  const measures: { name: string; detail: unknown }[] = [];
  const fake = {
    marks,
    measures,
    failMeasure: false,
    mark(name: string) {
      marks.add(name);
    },
    measure(name: string, options: { readonly start: string; readonly end: string; readonly detail?: unknown }) {
      if (fake.failMeasure) throw new Error('refused');
      if (!marks.has(options.start) || !marks.has(options.end)) throw new Error('missing mark');
      measures.push({ name, detail: options.detail });
    },
    clearMarks(name?: string) {
      if (name === undefined) marks.clear();
      else marks.delete(name);
    },
    clearMeasures(name?: string) {
      for (let i = measures.length - 1; i >= 0; i -= 1) if (name === undefined || measures[i]?.name === name) measures.splice(i, 1);
    },
  };
  return fake;
}

describe('createMapPerf', () => {
  it('records one measure per call, with the detail, and clears its marks', () => {
    const performance = fakePerformance();
    const perf = createMapPerf(performance);
    const result = perf.time('frl:map:set-layer', () => 42, (value) => ({ layer: 'route-steps', value }));
    expect(result).toBe(42);
    expect(performance.measures).toEqual([{ name: 'frl:map:set-layer', detail: { layer: 'route-steps', value: 42 } }]);
    expect(performance.marks.size).toBe(0);
    perf.time('frl:map:redraw', () => undefined);
    expect(performance.measures.map((m) => m.name)).toEqual(['frl:map:set-layer', 'frl:map:redraw']);
  });

  it('bounds the measures kept per name', () => {
    const performance = fakePerformance();
    const perf = createMapPerf(performance, 3);
    for (let i = 0; i < 7; i += 1) perf.time('frl:map:redraw', () => i);
    expect(performance.measures.length).toBeLessThanOrEqual(3);
    expect(performance.measures.length).toBeGreaterThan(0);
  });

  it('never lets the timeline break the map, and rethrows the work’s own errors', () => {
    const performance = fakePerformance();
    performance.failMeasure = true;
    const perf = createMapPerf(performance);
    expect(perf.time('x', () => 'ok')).toBe('ok');
    expect(performance.marks.size).toBe(0);
    performance.failMeasure = false;
    expect(() =>
      perf.time('y', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(performance.marks.size).toBe(0);
  });

  it('does nothing without a timeline', () => {
    expect(createMapPerf(null)).toBe(NO_PERF);
    expect(NO_PERF.time('x', () => 7)).toBe(7);
  });
});
