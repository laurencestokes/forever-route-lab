/**
 * The browser harness's pure parts (tests/bench/browser/README.md): how an interaction's window is
 * read (the frame that draws the work), the click order, the frame statistics, the first view's
 * bytes, the audit's entry line, the statistics, and the readability measurement's counts and page
 * scripts. No browser and no Playwright: the harness's
 * browser side is exercised by running it.
 */
import { describe, expect, it } from 'vitest';
import { analyseFirstView, analyseInteraction, classifyMapImage, clickOrder, frameStats, paintedAt, rowsInView, scrollTopForStep, type ResourceRow, type RowBox } from './cases';
import { checkProbeSyntax, PROBE_GLOBAL, probeCall, type ProbeFrame, type ProbeMeasure, type ProbeSince } from './probe';
import { BPLUS_CSS, BPLUS_EXTRA, BPLUS_ROW, BPLUS_SCRIPT } from './bplus-mock';
import { PAGE_SOURCE } from './readability-page';
import { activeCounts, namesCarry, ofText, rowCounts, type RowRecord, type TextMeasure, type TextState } from './readability-summary';
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

describe('the rows clicked and the list placed under B+ (a grown active row, D-051)', () => {
  // A list from y 100 to 540 (440 px): step 1 above it, steps 2 to 11 wholly in it, step 12 below; out of order, as the DOM may be.
  const row = (step: number): RowBox => ({ step, x: 0, y: 100 + (step - 2) * 44, width: 300, height: 44 });
  const list = { rows: [row(12), row(1), ...Array.from({ length: 10 }, (_, i) => row(i + 2))], top: 100, bottom: 540, grow: 32 };

  it('takes the rows wholly in view, top to bottom, and with room only those that stay in view when a row above grows', () => {
    expect(rowsInView(list).map((r) => r.step)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // With 32 px to spare the last row (496 + 44 = 540) is left out: a click above it would push it out of view.
    expect(rowsInView(list, list.grow).map((r) => r.step)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Builds before B+ have no --frl-row-grow: no room is asked for and every row in view is clicked.
    expect(rowsInView({ ...list, grow: 0 }, 0)).toHaveLength(10);
  });

  it('adds the active row’s extra to the scroll position only when the active row is above the step', () => {
    expect(scrollTopForStep(5001, { rowHeight: 44, active: null })).toBe(5000 * 44);
    expect(scrollTopForStep(5001, { rowHeight: 44, active: { step: 12, height: 76 } })).toBe(5000 * 44 + 32);
    expect(scrollTopForStep(5001, { rowHeight: 44, active: { step: 5001, height: 76 } })).toBe(5000 * 44);
    expect(scrollTopForStep(5001, { rowHeight: 44, active: { step: 6000, height: 76 } })).toBe(5000 * 44);
    // One-line rows and builds before B+: the active row is as tall as the rest.
    expect(scrollTopForStep(10, { rowHeight: 28, active: { step: 2, height: 28 } })).toBe(9 * 28);
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

describe('the readability counts (readability-summary.ts)', () => {
  const text = (state: TextState, value = 'x'): TextMeasure => ({ state, text: value, needPx: 10, clipPx: 10, lines: 1 });
  const row = (step: number, parts: Partial<RowRecord> = {}): RowRecord => ({
    step,
    kind: 'accept',
    quest: true,
    selected: false,
    active: false,
    hovered: false,
    height: 44,
    carried: false,
    hasIssue: false,
    hasChain: false,
    title: text('whole'),
    chain: null,
    issue: null,
    lead: null,
    zone: null,
    buttons: false,
    name: `${String(step)}. Accept quest: Q. Quest level 3, Difficult (yellow).`,
    tooltip: 'Accept Q',
    ...parts,
  });

  it('counts cut titles, issue words, NPC names and hidden chains among the rows that have them', () => {
    const rows = [
      row(1, { quest: false, kind: 'note', title: text('cut') }),
      row(2, { title: text('cut'), hasIssue: true, issue: text('cut') }),
      row(3, { lead: text('cut'), zone: text('whole') }),
      row(4, { lead: text('whole'), zone: text('whole'), hasChain: true, chain: text('hidden') }),
      row(5, { hasIssue: true, issue: text('whole'), hasChain: true, chain: text('whole') }),
    ];
    const counts = rowCounts(rows);
    expect(counts.questTitlesCut).toEqual({ count: 1, of: 4, steps: [2] });
    expect(ofText(counts.titlesCut)).toBe('2 of 5');
    expect(ofText(counts.issueWordsCut)).toBe('1 of 2');
    expect(ofText(counts.npcNamesCut)).toBe('1 of 2');
    expect(ofText(counts.zonesCut)).toBe('0 of 2');
    expect(counts.noPlace.steps).toEqual([2, 5]);
    expect(counts.chainHidden.steps).toEqual([4]);
  });

  it('checks the active row: issue, place and the carried-work cue whole, the chain shown', () => {
    const rows = [
      row(7, { kind: 'turnin', carried: true, hasIssue: true, issue: text('whole'), lead: text('whole'), zone: text('whole'), height: 76 }),
      row(9, { kind: 'turnin', carried: true, hasIssue: true, issue: text('cut'), lead: text('absent'), zone: text('absent'), height: 76 }),
      row(8, { hasChain: true, chain: text('whole'), lead: text('whole'), zone: text('cut'), buttons: true, height: 76 }),
    ];
    const active = activeCounts(rows);
    expect(ofText(active.issueWhole)).toBe('1 of 2');
    expect(active.placeWhole.steps).toEqual([7]);
    expect(ofText(active.carriedCueShown)).toBe('2 of 2');
    expect(ofText(active.carriedCueWhole)).toBe('1 of 2');
    expect(ofText(active.chainShown)).toBe('1 of 1');
    expect(ofText(active.buttons)).toBe('1 of 3');
    expect(active.heightPx).toEqual([76, 76]);
  });

  it('finds the chain position and level in the name, and the chain in the tooltip', () => {
    const named = namesCarry([
      row(2, { hasChain: true, name: '2. Accept quest: Simple Parchment (2 of 2), Gornek, Durotar 42.06, 68.33. Quest level 1, Difficult (yellow).', tooltip: 'Accept Simple Parchment' }),
      row(3, { hasChain: true, name: '3. Turn in quest: Simple Parchment (2 of 2). Quest level 1, Difficult (yellow).', tooltip: 'Turn in Simple Parchment 2/2' }),
    ]);
    expect(ofText(named.chainInName)).toBe('2 of 2');
    expect(named.chainInTooltip.steps).toEqual([3]);
    expect(ofText(named.levelInName)).toBe('2 of 2');
  });

  it('has page scripts that compile', () => {
    for (const source of [PAGE_SOURCE, BPLUS_SCRIPT]) {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- compiling (not running) our own constant, as a syntax check
      expect(() => new Function(source)).not.toThrow();
    }
    expect(BPLUS_CSS).toContain(`height: ${String(BPLUS_ROW + BPLUS_EXTRA)}px`);
  });
});
