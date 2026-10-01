/**
 * The browser harness's pure parts (tests/bench/browser/README.md): how an interaction's window is
 * read (the frame that draws the work), the click order, the frame statistics, the first view's
 * bytes, the audit's entry line and the statistics. No browser and no Playwright: the harness's
 * browser side is exercised by running it.
 */
import { describe, expect, it } from 'vitest';
import { analyseFirstView, analyseInteraction, classifyMapImage, clickOrder, frameStats, paintedAt, type ResourceRow } from './cases';
import { checkProbeSyntax, PROBE_GLOBAL, probeCall, type ProbeFrame, type ProbeMeasure, type ProbeSince } from './probe';
import { entryGzipKbOf } from './server';
import { median, quantile, spread, summary } from './stats';

const frames = (...called: number[]): ProbeFrame[] => called.map((time) => ({ raf: time - 1, called: time }));
const measure = (name: string, start: number, duration: number, inFrame = false): ProbeMeasure => ({ name, start, duration, inFrame });

describe('the frame that draws the work (paintedAt)', () => {
  it('is the end of work done inside a frame callback, and the next frame for work done in a task', () => {
    const recorded = frames(105, 121.7, 138.3);
    expect(paintedAt(recorded, measure('frl:map:labels', 120, 10, true))).toBe(130);
    expect(paintedAt(recorded, measure('frl:map:sync', 100, 10))).toBe(121.7);
    expect(paintedAt(recorded, measure('frl:map:sync', 100, 5))).toBe(105);
  });

  it('is unknown when no frame came after the work', () => {
    expect(paintedAt(frames(105), measure('frl:map:sync', 110, 5))).toBeNull();
  });
});

describe('one interaction (analyseInteraction)', () => {
  const recorded: ProbeSince = {
    measures: [
      measure('frl:map:sync', 90, 3),
      measure('frl:map:sync', 101, 9),
      measure('frl:derived', 100, 30),
      measure('frl:map:set-layer', 140, 4),
      measure('frl:map:labels', 150, 6, true),
    ],
    longTasks: [{ start: 101, duration: 60 }],
    inputs: [{ type: 'pointerdown', time: 100, key: null }],
    frames: frames(116.7, 133.3, 150, 166.7),
    now: 200,
  };

  it('times the first sync and the last map work to their frames, from the input, and leaves out earlier work', () => {
    const result = analyseInteraction(recorded, { type: 'pointerdown', time: 100, key: null }, false);
    expect(result.toFirstPaintMs).toBe(16.7);
    expect(result.toLastPaintMs).toBe(56);
    expect(result.lastMapCallMs).toBe(56);
    expect(result.mapCalls).toBe(3);
    expect(result.mapCallsByName).toEqual({ 'frl:map:sync': 1, 'frl:map:set-layer': 1, 'frl:map:labels': 1 });
    expect(result.derivedMs).toEqual([30]);
    expect(result.maxLongTaskMs).toBe(60);
  });

  it('reports no map work as no figure (F-10: such a click fails the run)', () => {
    const result = analyseInteraction({ ...recorded, measures: [measure('frl:derived', 100, 30)] }, { type: 'pointerdown', time: 100, key: null }, true);
    expect(result.mapCalls).toBe(0);
    expect(result.toFirstPaintMs).toBeNull();
    expect(result.toLastPaintMs).toBeNull();
    expect(result.timedOut).toBe(true);
  });
});

describe('the click order', () => {
  it('takes every other row, then the ones between, and never the same row twice in a row', () => {
    expect(clickOrder(5, 8)).toEqual([0, 2, 4, 1, 3, 0, 2, 4]);
    expect(clickOrder(2, 5)).toEqual([0, 1, 0, 1, 0]);
    const order = clickOrder(9, 15);
    expect(order.every((row, i) => i === 0 || row !== order[i - 1])).toBe(true);
  });

  it('needs two rows on screen', () => {
    expect(() => clickOrder(1, 3)).toThrow(/fewer than two/);
  });
});

describe('frame statistics', () => {
  it('reads the intervals between frames, by nearest rank, with the long ones counted', () => {
    const stats = frameStats([0, 16, 32, 57, 73, 123].map((raf) => ({ raf, called: raf + 1 })));
    expect(stats.frames).toBe(5);
    expect(stats.p50).toBe(16);
    expect(stats.p99).toBe(50);
    expect(stats.max).toBe(50);
    expect(stats.over16).toBe(2);
    expect(stats.over33).toBe(1);
  });
});

describe('the first view', () => {
  const row = (path: string, responseEnd: number, bytes: number): ResourceRow => ({
    name: `http://127.0.0.1:4173${path}`,
    initiatorType: 'img',
    startTime: responseEnd - 50,
    responseEnd,
    encodedBodySize: bytes,
    transferSize: bytes + 300,
  });

  it('knows the map images by their paths', () => {
    expect(classifyMapImage('http://h/maps/atlas/t/-2/3/4.webp')).toEqual({ kind: 'atlas', level: -2 });
    expect(classifyMapImage('http://h/base/maps/minimap/t/-6/0/0.webp')).toEqual({ kind: 'minimap', level: -6 });
    expect(classifyMapImage('http://h/maps/art/durotar.webp')).toEqual({ kind: 'art' });
    expect(classifyMapImage('http://h/maps/terrain/1411/relief.png')).toEqual({ kind: 'relief' });
    expect(classifyMapImage('http://h/maps/atlas/index.json')).toBeNull();
  });

  it('counts the tiles at the view’s level and the index, after the map chunk', () => {
    const view = analyseFirstView(
      [
        row('/assets/leaflet-AbC123_x.js', 900, 77_000),
        row('/maps/atlas/index.json', 950, 1_300),
        row('/maps/atlas/t/-5/0/0.webp', 1_000, 7_000),
        row('/maps/atlas/t/-2/1/1.webp', 1_100, 9_000),
        row('/maps/atlas/t/-2/1/2.webp', 1_200, 10_000),
        row('/maps/atlas/t/-3/0/1.webp', 1_150, 11_000),
      ],
      800,
      { selectedSteps: [55], mapChip: null },
    );
    expect(view.viewLevel).toBe(-2);
    expect(view.tilesInView).toBe(2);
    expect(view.firstViewBytes).toBe(9_000 + 10_000 + 1_300);
    expect(view.firstViewTransferBytes).toBe(9_300 + 10_300 + 1_600);
    expect(view.byLevel['atlas:-5']).toEqual({ n: 1, bytes: 7_000, transferBytes: 7_300 });
    expect(view.allMapImageBytes).toBe(37_000);
    expect(view.firstArtAfterChunkMs).toBe(100);
    expect(view.firstTileRequestMs).toBe(950);
  });

  it('counts the painted art images before the atlas, and the relief apart', () => {
    const view = analyseFirstView([row('/assets/leaflet-x1.js', 900, 70_000), row('/maps/art/durotar.webp', 1_400, 183_000), row('/maps/terrain/1411/relief.png', 1_300, 218_000)], null, { selectedSteps: [], mapChip: null });
    expect(view.viewLevel).toBeNull();
    expect(view.firstViewBytes).toBe(183_000);
    expect(view.reliefImages).toEqual({ n: 1, bytes: 218_000 });
    expect(view.allMapImageBytes).toBe(401_000);
    expect(view.firstArtAfterChunkMs).toBe(500);
  });
});

describe('the build’s entry chunk', () => {
  it('is read from the dist audit’s entry block', () => {
    const log = [
      'Entry "index.html" + static imports (budget 250.00 kB gzip):',
      '    assets/index-BwkDShrP.js                          756.43 kB  gzip  235.43 kB',
      '    total                                                        gzip  247.51 kB',
      '  CSS loaded by the entry (not gated):',
    ].join('\n');
    expect(entryGzipKbOf(log)).toBe(247.51);
    expect(entryGzipKbOf('no audit here')).toBeNull();
  });
});

describe('statistics and the probe', () => {
  it('takes nearest-rank quantiles and medians, and summarises rounds as a median with its spread', () => {
    expect(quantile([5, 1, 4, 2, 3], 0.9)).toBe(5);
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(summary([10.04, 20, Number.NaN, 30])).toEqual({ n: 3, median: 20, p90: 30, min: 10, max: 30 });
    expect(spread([3, 1, 2])).toEqual({ n: 3, median: 2, min: 1, max: 3, values: [3, 1, 2] });
    expect(summary([]).n).toBe(0);
  });

  it('compiles, and is called by expressions only', () => {
    expect(() => {
      checkProbeSyntax();
    }).not.toThrow();
    expect(probeCall('waitQuiet', 3, 12.5, 500, 0, 6000)).toBe(`window.${PROBE_GLOBAL}.waitQuiet(3, 12.5, 500, 0, 6000)`);
  });
});
