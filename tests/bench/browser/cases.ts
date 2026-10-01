/**
 * The browser harness's measurements (tests/bench/browser/README.md has the definitions and the
 * protocol). Each function drives one page of a served build through real input (CDP mouse and
 * keyboard events through Playwright) and the app's own controls, and reads the probe (probe.ts).
 * Nothing in the app is changed or reached into: the only page-side code is the probe.
 */
import type { Browser, BrowserContext, CdpSession, Page } from './playwright';
import { checkProbeSyntax, type ProbeFrame, type ProbeInput, type ProbeMark, type ProbeMeasure, type ProbeSince, type ProbeTask, PROBE_SOURCE, probeCall, type QuietResult } from './probe';
import { round1, summary, type Summary } from './stats';

/** The viewport of the earlier measurements (docs/measurements/map-atlas.json `atl9mm8.viewport`). */
export const VIEWPORT = { width: 1366, height: 768 } as const;
export const DEVICE_SCALE_FACTOR = 1.5;

/** The cold-load network of the earlier measurements: 50 Mbit/s down, 10 up, 20 ms round trip (map-atlas.json `atl9mm8.network`). */
export const NETWORK = { latencyMs: 20, downloadBitsPerSecond: 50e6, uploadBitsPerSecond: 10e6 } as const;

/**
 * The map style for every page: painted by default. The minimap tiles are a release-asset pack that
 * is not in git (D-049 O14), so without them the app falls back to the painted style after its
 * minimap tiles fail; choosing painted up front measures the painted style itself. `minimap` needs
 * the pack (`pnpm maps:minimap:fetch`); `app` leaves the app's own default. The key is the Map
 * layers record's (src/infra/maps/map-style-setting.ts); builds before the atlas ignore it.
 */
export type StyleChoice = 'painted' | 'minimap' | 'app';
export const MAP_LAYERS_KEY = 'forever-route-lab:map-layers';

function styleScript(style: StyleChoice): string {
  if (style === 'app') return '';
  return `try { if (localStorage.getItem(${JSON.stringify(MAP_LAYERS_KEY)}) === null) localStorage.setItem(${JSON.stringify(MAP_LAYERS_KEY)}, ${JSON.stringify(JSON.stringify({ version: 1, style }))}); } catch (error) { /* storage blocked: the app's default style applies */ }`;
}

export interface Session {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly cdp: CdpSession;
  readonly errors: string[];
}

export interface OpenOptions {
  /** CPU throttling from the first byte (first-art runs); interaction runs load at 1× and throttle later. */
  readonly throttleAtLoad?: number;
  /** The map style chosen before the app loads (default painted). */
  readonly style?: StyleChoice;
  /** Emulate the cold-load network (first-art and first-view runs). */
  readonly network?: boolean;
}

export async function setThrottle(session: Session, rate: number): Promise<void> {
  await session.cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

/**
 * The CPU probe of the earlier measurements (docs/measurements/map-m3.json, map-atlas.json
 * `cpuProbeMs`): a 2e7 square-root loop in the page, median of three, at the current throttle.
 * The reference machine took 38-40 ms at 1×.
 */
export async function cpuProbe(page: Page): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    times.push(await page.evaluate<number>('(() => { const start = performance.now(); let sink = 0; for (let i = 0; i < 2e7; i += 1) sink += Math.sqrt(i); return sink < 0 ? -1 : performance.now() - start; })()'));
  }
  return round1([...times].sort((a, b) => a - b)[1] ?? Number.NaN);
}

/** A fresh context (empty cache, storage and IndexedDB) with the probe and the painted style, at `url`, once the workspace is ready. */
export async function openSession(browser: Browser, url: string, options: OpenOptions = {}): Promise<Session> {
  checkProbeSyntax();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE_FACTOR });
  await context.addInitScript({ content: `${styleScript(options.style ?? 'painted')}\n${PROBE_SOURCE}` });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  const cdp = await context.newCDPSession(page);
  const session: Session = { context, page, cdp, errors };
  if (options.network === true) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: NETWORK.latencyMs,
      downloadThroughput: NETWORK.downloadBitsPerSecond / 8,
      uploadThroughput: NETWORK.uploadBitsPerSecond / 8,
    });
  }
  if (options.throttleAtLoad !== undefined && options.throttleAtLoad !== 1) await setThrottle(session, options.throttleAtLoad);
  await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForFunction("performance.getEntriesByName('frl:workspace-ready').length > 0 && document.querySelector('[role=listbox]') !== null", undefined, { timeout: 120_000, polling: 100 });
  return session;
}

export async function closeSession(session: Session): Promise<void> {
  await session.context.close();
}

/** Waits until no map or derived work has ended for `quietMs` (see probe.ts `waitQuiet`). */
export async function waitQuiet(page: Page, quietMs: number, maxMs: number, from: ProbeMark | null = null): Promise<QuietResult> {
  const mark = from ?? (await page.evaluate<ProbeMark>(probeCall('mark')));
  return page.evaluate<QuietResult>(probeCall('waitQuiet', mark.measures, mark.time, quietMs, 0, maxMs));
}

// =============================================================================================
// The app's controls

/** Imports a native project file through the top bar's Import dialog, as a user does. */
export async function importProject(page: Page, file: string, stepCount: number): Promise<void> {
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import' });
  await dialog.locator('input[type=file]').setInputFiles(file);
  await page.waitForFunction(`document.querySelector('[role=option][aria-setsize="${String(stepCount)}"]') !== null`, undefined, { timeout: 120_000, polling: 200 });
}

/** "Go to zone" in the top bar (every build since Milestone 3): the map fits the zone with that UiMap id. */
export async function goToZone(page: Page, uiMapId: number): Promise<void> {
  await page.locator('.frl-topbar__zone select').selectOption({ value: String(uiMapId) });
  await page.locator('.frl-topbar__zone-go').click();
}

export interface RowBox {
  /** aria-posinset: the step's number. */
  readonly step: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const VISIBLE_ROWS = `(() => {
  const list = document.querySelector('[role=listbox]');
  if (list === null) return [];
  const box = list.getBoundingClientRect();
  return [...list.querySelectorAll('[role=option][aria-posinset]')]
    .map((row) => { const r = row.getBoundingClientRect(); return { step: Number(row.getAttribute('aria-posinset')), x: r.x, y: r.y, width: r.width, height: r.height }; })
    .filter((r) => r.y >= box.top - 0.5 && r.y + r.height <= box.bottom + 0.5)
    .sort((a, b) => a.y - b.y);
})()`;

/** The route rows wholly inside the list's viewport, top to bottom (F-10: only these are clicked). */
export function visibleRows(page: Page): Promise<RowBox[]> {
  return page.evaluate<RowBox[]>(VISIBLE_ROWS);
}

/** Scrolls the route list so that step `step` is the first row (row height read from the rows themselves). */
export async function scrollListTo(page: Page, step: number): Promise<void> {
  await page.evaluate(`(() => {
    const list = document.querySelector('[role=listbox]');
    const rows = [...list.querySelectorAll('[role=option][aria-posinset]')].map((row) => ({ n: Number(row.getAttribute('aria-posinset')), top: row.offsetTop })).sort((a, b) => a.n - b.n);
    let height = 0;
    for (let i = 1; i < rows.length && height === 0; i += 1) if (rows[i].n === rows[i - 1].n + 1) height = rows[i].top - rows[i - 1].top;
    if (height <= 0) throw new Error('no two consecutive rows to measure the row height');
    list.scrollTop = (${String(step)} - 1) * height;
  })()`);
  await page.waitForFunction(`document.querySelector('[role=option][aria-posinset="${String(step)}"]') !== null`, undefined, { timeout: 10_000, polling: 'raf' });
}

/** Where a row is clicked: on its title line, clear of the number (the drag handle) and of the row buttons. */
export function rowPoint(row: RowBox): { readonly x: number; readonly y: number } {
  return { x: row.x + Math.min(150, row.width / 2), y: row.y + Math.min(10, row.height / 2) };
}

// =============================================================================================
// The windows the interactions run in

/** UiMap ids of the zones the harness shows ("Go to zone"). */
export const DUROTAR = 1411;
export const STRANGLETHORN = 1434;
/** The 10,000-step project's window: step 5,001 at the top of the list, mid-route (as UR.2b), in Stranglethorn Vale. */
export const TEN_K_FIRST_ROW = 5001;

/** The sample project (a first visit's): Durotar shown, the list at its top. */
export async function prepareSample(page: Page): Promise<void> {
  await waitQuiet(page, 1_500, 60_000);
  await goToZone(page, DUROTAR);
  await waitQuiet(page, 1_000, 30_000);
  await scrollListTo(page, 1);
  await waitQuiet(page, 500, 10_000);
}

/** The 10,000-step project imported, every walking leg computed, then `zone` shown. */
export async function prepareTenK(page: Page, projectFile: string, steps: number, zone: number): Promise<void> {
  await waitQuiet(page, 1_500, 60_000);
  await importProject(page, projectFile, steps);
  // Every walking leg of the new project is computed before anything is measured.
  await waitQuiet(page, 4_000, 600_000);
  await goToZone(page, zone);
  await waitQuiet(page, 1_500, 60_000);
}

/** The 10,000-step project's selection and edit window: Stranglethorn Vale, step 5,001 at the top of the list. */
export async function prepareTenKWindow(page: Page, projectFile: string, steps: number): Promise<void> {
  await prepareTenK(page, projectFile, steps, STRANGLETHORN);
  await scrollListTo(page, TEN_K_FIRST_ROW);
  await waitQuiet(page, 1_000, 30_000);
}

// =============================================================================================
// One interaction: input, then the map's work until the quiet period

export interface QuietPolicy {
  /** No frl:map or frl:derived measure ends for this long: the interaction's work is over. */
  readonly quietMs: number;
  readonly maxMs: number;
}

/** The quiet period scales with the throttle: 500 ms at 1×, 1,100 ms at 4×. */
export function quietPolicy(throttle: number): QuietPolicy {
  return { quietMs: 300 + 200 * throttle, maxMs: 4_000 + 2_000 * throttle };
}

export interface InteractionResult {
  /** From the input event's timestamp to the frame that draws the first frl:map:sync (`paintedAt`); null without a sync. */
  readonly toFirstPaintMs: number | null;
  /** The same for the last frl:map:* work (the definition of "to pins painted"); null without map work. */
  readonly toLastPaintMs: number | null;
  /** When the last frl:map:* measure ended, from the input. */
  readonly lastMapCallMs: number | null;
  readonly mapCalls: number;
  readonly mapCallsByName: Readonly<Record<string, number>>;
  /** frl:derived measures in the window (each from its store change to its publish). */
  readonly derivedMs: readonly number[];
  readonly maxLongTaskMs: number | null;
  readonly timedOut: boolean;
  /** With FRL_BENCH_TRACE=1: every measure, long task and frame of the window, in ms from the input. */
  readonly trace?: { readonly measures: readonly string[]; readonly longTasks: readonly string[]; readonly frames: readonly string[] };
}

const TRACE = process.env['FRL_BENCH_TRACE'] === '1';

/**
 * When a measured piece of map work reached the screen, as near as the page can tell without
 * adding work to its frames: work done inside an animation-frame callback (a canvas redraw, the
 * labels) is drawn by that frame, whose rendering follows at once, so its end; work done in a task
 * is drawn by the next frame, so the moment that frame's first callback ran (its rendering comes
 * after). Both leave out the frame's own style, layout and paint, the same in every build. Null when
 * no frame came after it (the recording ended too early).
 */
export function paintedAt(frames: readonly ProbeFrame[], measure: ProbeMeasure): number | null {
  const end = measure.start + measure.duration;
  if (measure.inFrame) return end;
  for (const frame of frames) if (frame.called >= end) return frame.called;
  return null;
}

/** Reads one interaction from what the probe recorded after its mark (pure, for tests). */
export function analyseInteraction(recorded: ProbeSince, input: ProbeInput, timedOut: boolean): InteractionResult {
  const t0 = input.time;
  const inWindow = (m: ProbeMeasure): boolean => m.start >= t0 - 0.5;
  const map = recorded.measures.filter((m) => m.name.startsWith('frl:map:') && inWindow(m));
  const byName: Record<string, number> = {};
  for (const m of map) byName[m.name] = (byName[m.name] ?? 0) + 1;
  const firstSync = map.find((m) => m.name === 'frl:map:sync');
  const lastEnd = map.length === 0 ? null : Math.max(...map.map((m) => m.start + m.duration));
  const firstPaint = firstSync === undefined ? null : paintedAt(recorded.frames, firstSync);
  const painted = map.map((m) => paintedAt(recorded.frames, m));
  const lastPaint = map.length === 0 || painted.includes(null) ? null : Math.max(...painted.map((time) => time ?? 0));
  const tasks = recorded.longTasks.filter((task: ProbeTask) => task.start + task.duration >= t0);
  return {
    toFirstPaintMs: firstPaint === null ? null : round1(firstPaint - t0),
    toLastPaintMs: lastPaint === null ? null : round1(lastPaint - t0),
    lastMapCallMs: lastEnd === null ? null : round1(lastEnd - t0),
    mapCalls: map.length,
    mapCallsByName: byName,
    derivedMs: recorded.measures.filter((m) => m.name === 'frl:derived' && m.start + m.duration >= t0).map((m) => round1(m.duration)),
    maxLongTaskMs: tasks.length === 0 ? null : round1(Math.max(...tasks.map((task) => task.duration))),
    timedOut,
    ...(TRACE
      ? {
          trace: {
            measures: recorded.measures.map((m) => `${String(round1(m.start - t0))}+${String(round1(m.duration))} ${m.name}${m.inFrame ? ' (frame)' : ''}`),
            longTasks: recorded.longTasks.map((task) => `${String(round1(task.start - t0))}+${String(round1(task.duration))}`),
            frames: recorded.frames.map((frame) => `${String(round1(frame.raf - t0))}/${String(round1(frame.called - t0))}`),
          },
        }
      : {}),
  };
}

/** Runs `act` (which sends one input), then waits for the quiet period and analyses the window. */
async function interaction(page: Page, policy: QuietPolicy, inputType: ProbeInput['type'], key: string | null, act: () => Promise<void>): Promise<InteractionResult> {
  const mark = await page.evaluate<ProbeMark>(probeCall('mark'));
  await page.evaluate(probeCall('startFrames'));
  await act();
  const quiet = await page.evaluate<QuietResult>(probeCall('waitQuiet', mark.measures, mark.time, policy.quietMs, policy.quietMs, policy.maxMs));
  // A frame or two more, so work at the very end of the quiet period has its frame.
  await page.waitForTimeout(50);
  const recorded = await page.evaluate<ProbeSince>(probeCall('since', mark));
  await page.evaluate(probeCall('stopFrames'));
  const input = recorded.inputs.find((candidate) => candidate.type === inputType && (key === null || candidate.key === key));
  if (input === undefined) throw new Error(`no ${inputType}${key === null ? '' : ` ${key}`} reached the page`);
  return analyseInteraction(recorded, input, quiet.timedOut);
}

export interface InteractionSet {
  readonly samples: readonly InteractionResult[];
  /** Interactions that produced no map work (F-10): left out of the figures, and a failed run when any. */
  readonly withoutMapWork: number;
  readonly steps: readonly number[];
  readonly toLastPaintMs: Summary;
  readonly toFirstPaintMs: Summary;
  readonly lastMapCallMs: Summary;
  readonly derivedMs: Summary;
  readonly maxLongTaskMs: number | null;
  readonly timedOut: number;
}

function summarise(samples: readonly InteractionResult[], steps: readonly number[]): InteractionSet {
  const withWork = samples.filter((sample) => sample.mapCalls > 0);
  const numbers = (pick: (sample: InteractionResult) => number | null): number[] => withWork.flatMap((sample) => {
    const value = pick(sample);
    return value === null ? [] : [value];
  });
  const tasks = withWork.flatMap((sample) => (sample.maxLongTaskMs === null ? [] : [sample.maxLongTaskMs]));
  return {
    samples,
    withoutMapWork: samples.length - withWork.length,
    steps,
    toLastPaintMs: summary(numbers((sample) => sample.toLastPaintMs)),
    toFirstPaintMs: summary(numbers((sample) => sample.toFirstPaintMs)),
    lastMapCallMs: summary(numbers((sample) => sample.lastMapCallMs)),
    derivedMs: summary(withWork.flatMap((sample) => sample.derivedMs)),
    maxLongTaskMs: tasks.length === 0 ? null : Math.max(...tasks),
    timedOut: samples.filter((sample) => sample.timedOut).length,
  };
}

/**
 * The order rows are clicked in: every other visible row top to bottom, then the ones between
 * (0, 2, 4, …, 1, 3, 5, …), repeated to `count`; no row twice in a row, so every click changes
 * the selection.
 */
export function clickOrder(visible: number, count: number): number[] {
  if (visible < 2) throw new Error('fewer than two route rows are visible');
  const cycle: number[] = [];
  for (let i = 0; i < visible; i += 2) cycle.push(i);
  for (let i = 1; i < visible; i += 2) cycle.push(i);
  const out: number[] = [];
  for (let k = 0; out.length < count; k += 1) {
    const next = cycle[k % cycle.length] ?? 0;
    if (out.length > 0 && out[out.length - 1] === next) continue;
    out.push(next);
  }
  return out;
}

/**
 * Selection to pins painted: `count` clicks on route rows that are on screen (F-10), after one
 * unmeasured click on the first of them. Each click must produce map work.
 */
export async function measureSelection(page: Page, throttle: number, count: number): Promise<InteractionSet> {
  const policy = quietPolicy(throttle);
  const rows = await visibleRows(page);
  if (rows.length < 2) throw new Error('fewer than two route rows are visible');
  const order = clickOrder(rows.length, count + 1);
  const samples: InteractionResult[] = [];
  const steps: number[] = [];
  for (const [i, index] of order.entries()) {
    const now = await visibleRows(page);
    const row = now.find((candidate) => candidate.step === rows[index]?.step);
    if (row === undefined) throw new Error(`step ${String(rows[index]?.step)} is no longer on screen`);
    const point = rowPoint(row);
    const result = await interaction(page, policy, 'pointerdown', null, () => page.mouse.click(point.x, point.y));
    if (i === 0) continue; // the unmeasured first click
    samples.push(result);
    steps.push(row.step);
  }
  return summarise(samples, steps);
}

/**
 * Edit to pins painted: the step at `rowIndex` of the visible rows is selected (unmeasured), then
 * moved down and up alternately with Alt+↓ and Alt+↑ in the focused route list (the list's own
 * move keys in every build; the step toolbar's Move buttons run the same action), `count` edits.
 */
export async function measureEdit(page: Page, throttle: number, count: number, rowIndex: number): Promise<InteractionSet> {
  const policy = quietPolicy(throttle);
  const rows = await visibleRows(page);
  const row = rows[Math.min(rowIndex, rows.length - 1)];
  if (row === undefined) throw new Error('no route row is visible');
  const point = rowPoint(row);
  await interaction(page, policy, 'pointerdown', null, () => page.mouse.click(point.x, point.y));
  await page.locator('[role=listbox]').focus();
  const samples: InteractionResult[] = [];
  for (let i = 0; i < count; i += 1) {
    const key = i % 2 === 0 ? 'ArrowDown' : 'ArrowUp';
    samples.push(await interaction(page, policy, 'keydown', key, () => page.keyboard.press(`Alt+${key}`)));
  }
  return summarise(samples, [row.step]);
}

// =============================================================================================
// Pans

export interface FrameStats {
  readonly frames: number;
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  /** Intervals over 16.7 ms (more than one frame at 60 Hz). */
  readonly over16: number;
  /** Intervals over 33.4 ms (more than two frames at 60 Hz). */
  readonly over33: number;
}

export function frameStats(frames: readonly ProbeFrame[]): FrameStats {
  const intervals: number[] = [];
  for (let i = 1; i < frames.length; i += 1) {
    const a = frames[i - 1];
    const b = frames[i];
    if (a !== undefined && b !== undefined) intervals.push(b.raf - a.raf);
  }
  const s = [...intervals].sort((x, y) => x - y);
  const at = (q: number): number => round1(s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] ?? Number.NaN);
  return {
    frames: intervals.length,
    p50: at(0.5),
    p90: at(0.9),
    p95: at(0.95),
    p99: at(0.99),
    max: round1(s[s.length - 1] ?? Number.NaN),
    over16: intervals.filter((v) => v > 16.7).length,
    over33: intervals.filter((v) => v > 33.4).length,
  };
}

export interface PanResult {
  readonly drags: FrameStats;
  readonly longDrag: FrameStats;
  readonly longTasks: { readonly count: number; readonly over50: number; readonly maxMs: number | null };
  readonly syncMs: Summary;
  readonly updatePathsMs: Summary;
  readonly timedOut: number;
}

async function mapCentre(page: Page): Promise<{ readonly x: number; readonly y: number }> {
  const box = await page.locator('.leaflet-container').first().boundingBox();
  if (box === null) throw new Error('the map is not shown');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** One drag at about 60 Hz along `path` (offsets from the map's centre), then the settle. */
async function drag(page: Page, path: readonly { readonly dx: number; readonly dy: number }[]): Promise<void> {
  const centre = await mapCentre(page);
  const first = path[0] ?? { dx: 0, dy: 0 };
  await page.mouse.move(centre.x + first.dx, centre.y + first.dy);
  await page.mouse.down();
  for (const point of path.slice(1)) {
    await page.mouse.move(centre.x + point.dx, centre.y + point.dy);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

function line(dx: number, dy: number, moves: number, from = { dx: 0, dy: 0 }): { dx: number; dy: number }[] {
  const out: { dx: number; dy: number }[] = [];
  for (let i = 0; i <= moves; i += 1) out.push({ dx: from.dx + (dx * i) / moves, dy: from.dy + (dy * i) / moves });
  return out;
}

/** The five drags (each about 0.5 s) and the long drag (about 3 s, a loop), as offsets from the map's centre. */
export const DRAGS: readonly (readonly { readonly dx: number; readonly dy: number }[])[] = [
  line(260, 0, 30, { dx: -130, dy: 0 }),
  line(0, 200, 30, { dx: 0, dy: -100 }),
  line(-260, 0, 30, { dx: 130, dy: 0 }),
  line(0, -200, 30, { dx: 0, dy: 100 }),
  line(200, 150, 30, { dx: -100, dy: -75 }),
];

export const LONG_DRAG: readonly { readonly dx: number; readonly dy: number }[] = Array.from({ length: 181 }, (_, i) => {
  const angle = (i / 180) * 2 * Math.PI;
  return { dx: 160 * Math.sin(angle), dy: 120 * (1 - Math.cos(angle)) - 60 };
});

/**
 * The pans (docs/measurements/rework-speed-d050.json `10k-x4`): five drags and one long drag at
 * the zone band, each followed by its settle (the map's sync after the drag lands in it). Frames are
 * recorded from the first press to the end of each settle.
 */
export async function measurePans(page: Page, throttle: number): Promise<PanResult> {
  const policy = quietPolicy(throttle);
  const mark = await page.evaluate<ProbeMark>(probeCall('mark'));
  let timedOut = 0;
  await page.evaluate(probeCall('startFrames'));
  for (const path of DRAGS) {
    await drag(page, path);
    const quiet = await waitQuiet(page, policy.quietMs, policy.maxMs);
    if (quiet.timedOut) timedOut += 1;
  }
  const drags = await page.evaluate<ProbeSince>(probeCall('since', mark));
  await page.evaluate(probeCall('startFrames'));
  await drag(page, LONG_DRAG);
  const quiet = await waitQuiet(page, policy.quietMs, policy.maxMs);
  if (quiet.timedOut) timedOut += 1;
  const all = await page.evaluate<ProbeSince>(probeCall('since', mark));
  await page.evaluate(probeCall('stopFrames'));
  const tasks = all.longTasks;
  const durations = (name: string): number[] => all.measures.filter((m) => m.name === name).map((m) => m.duration);
  return {
    drags: frameStats(drags.frames),
    longDrag: frameStats(all.frames),
    longTasks: { count: tasks.length, over50: tasks.filter((task) => task.duration > 50).length, maxMs: tasks.length === 0 ? null : round1(Math.max(...tasks.map((task) => task.duration))) },
    syncMs: summary(durations('frl:map:sync')),
    updatePathsMs: summary(durations('frl:map:update-paths')),
    timedOut,
  };
}

// =============================================================================================
// First art and first-view bytes

export interface ResourceRow {
  readonly name: string;
  readonly initiatorType: string;
  readonly startTime: number;
  readonly responseEnd: number;
  readonly encodedBodySize: number;
  readonly transferSize: number;
}

/** A map tile or art image: atlas or minimap tile (with its level), or a whole painted art image (builds before the atlas). */
export function classifyMapImage(url: string): { readonly kind: 'atlas' | 'minimap'; readonly level: number } | { readonly kind: 'art' | 'relief' } | null {
  const path = new URL(url).pathname;
  const tile = /\/maps\/(atlas|minimap)\/t\/(-?\d+)\/\d+\/\d+\.\w+$/.exec(path);
  if (tile?.[1] !== undefined && tile[2] !== undefined) return { kind: tile[1] === 'atlas' ? 'atlas' : 'minimap', level: Number(tile[2]) };
  if (/\/maps\/art\/[^/]+\.(?:webp|png)$/.test(path)) return { kind: 'art' };
  if (/\/maps\/terrain\/\d+\/relief\.png$/.test(path)) return { kind: 'relief' };
  return null;
}

export interface FirstViewResult {
  readonly workspaceReadyMs: number | null;
  readonly leafletChunkEndMs: number | null;
  readonly firstTileRequestMs: number | null;
  readonly firstArtEndMs: number | null;
  /** First art (atlas or minimap tile, or a painted art image) loaded, after the map (Leaflet) chunk loaded. */
  readonly firstArtAfterChunkMs: number | null;
  /** The opening view's own level: the finest tile level requested before the view settled (null without tiles). */
  readonly viewLevel: number | null;
  readonly indexBytes: number | null;
  /** Tiles at the view's level (body bytes), plus the index (MR-06 as recorded in rework-speed-d050.json); art images before the atlas. */
  readonly firstViewBytes: number;
  readonly firstViewTransferBytes: number;
  readonly tilesInView: number;
  readonly byLevel: Readonly<Record<string, { readonly n: number; readonly bytes: number; readonly transferBytes: number }>>;
  readonly artImages: { readonly n: number; readonly bytes: number };
  readonly reliefImages: { readonly n: number; readonly bytes: number };
  readonly allMapImageBytes: number;
  readonly allMapImageTransferBytes: number;
  readonly opening: { readonly selectedSteps: readonly number[]; readonly mapChip: string | null };
}

/** Reads the first view (pure, for tests). */
export function analyseFirstView(rows: readonly ResourceRow[], workspaceReadyMs: number | null, opening: FirstViewResult['opening']): FirstViewResult {
  const chunk = rows.find((row) => /\/assets\/leaflet-[^/]+\.js$/.test(new URL(row.name).pathname));
  const images = rows.flatMap((row) => {
    const kind = classifyMapImage(row.name);
    return kind === null ? [] : [{ row, kind }];
  });
  const art = images.filter((image) => image.kind.kind !== 'relief');
  const firstArtEnd = art.length === 0 ? null : Math.min(...art.map((image) => image.row.responseEnd));
  const firstRequest = art.length === 0 ? null : Math.min(...art.map((image) => image.row.startTime));
  const byLevel: Record<string, { n: number; bytes: number; transferBytes: number }> = {};
  for (const image of images) {
    if (!('level' in image.kind)) continue;
    const key = `${image.kind.kind}:${String(image.kind.level)}`;
    const entry = byLevel[key] ?? { n: 0, bytes: 0, transferBytes: 0 };
    entry.n += 1;
    entry.bytes += image.row.encodedBodySize;
    entry.transferBytes += image.row.transferSize;
    byLevel[key] = entry;
  }
  const tiled = images.flatMap((image) => ('level' in image.kind ? [image.kind.level] : []));
  const viewLevel = tiled.length === 0 ? null : Math.max(...tiled);
  const index = rows.find((row) => /\/maps\/(atlas|minimap)\/index\.json$/.test(new URL(row.name).pathname));
  const sum = (list: readonly { readonly row: ResourceRow }[], pick: (row: ResourceRow) => number): number => list.reduce((total, image) => total + pick(image.row), 0);
  const inView = images.filter((image) => 'level' in image.kind && image.kind.level === viewLevel);
  const artOnly = images.filter((image) => image.kind.kind === 'art');
  const relief = images.filter((image) => image.kind.kind === 'relief');
  const indexBytes = index === undefined ? null : index.encodedBodySize;
  const viewBytes = viewLevel === null ? sum(artOnly, (row) => row.encodedBodySize) : sum(inView, (row) => row.encodedBodySize) + (indexBytes ?? 0);
  const viewTransfer = viewLevel === null ? sum(artOnly, (row) => row.transferSize) : sum(inView, (row) => row.transferSize) + (index?.transferSize ?? 0);
  return {
    workspaceReadyMs: workspaceReadyMs === null ? null : round1(workspaceReadyMs),
    leafletChunkEndMs: chunk === undefined ? null : round1(chunk.responseEnd),
    firstTileRequestMs: firstRequest === null ? null : round1(firstRequest),
    firstArtEndMs: firstArtEnd === null ? null : round1(firstArtEnd),
    firstArtAfterChunkMs: firstArtEnd === null || chunk === undefined ? null : round1(firstArtEnd - chunk.responseEnd),
    viewLevel,
    indexBytes,
    firstViewBytes: viewBytes,
    firstViewTransferBytes: viewTransfer,
    tilesInView: viewLevel === null ? artOnly.length : inView.length,
    byLevel,
    artImages: { n: artOnly.length, bytes: sum(artOnly, (row) => row.encodedBodySize) },
    reliefImages: { n: relief.length, bytes: sum(relief, (row) => row.encodedBodySize) },
    allMapImageBytes: sum(images, (row) => row.encodedBodySize),
    allMapImageTransferBytes: sum(images, (row) => row.transferSize),
    opening,
  };
}

const FIRST_IMAGE = `performance.getEntriesByType('resource').some((e) => /\\/maps\\/(atlas|minimap|art)\\//.test(e.name) && /\\.(webp|png)$/.test(e.name))`;
const IMAGES_LOADED = `[...document.querySelectorAll('.leaflet-container img')].every((img) => img.complete)`;
const RESOURCES = `performance.getEntriesByType('resource').map((e) => ({ name: e.name, initiatorType: e.initiatorType, startTime: e.startTime, responseEnd: e.responseEnd, encodedBodySize: e.encodedBodySize, transferSize: e.transferSize }))`;
const OPENING = `(() => ({
  selectedSteps: [...document.querySelectorAll('[role=option][aria-selected=true]')].map((row) => Number(row.getAttribute('aria-posinset'))),
  mapChip: (() => { const chip = [...document.querySelectorAll('.leaflet-container ~ *, [class*=map] [class*=chip], [class*=viewing]')].map((el) => el.textContent.replace(/\\s+/g, ' ').trim()).find((text) => text.startsWith('Viewing')); return chip === undefined ? null : chip.slice(0, 120); })(),
}))()`;

/**
 * First art and the first view's bytes: a first visit (the sample project), cold cache, the
 * cold-load network, CPU throttled from the first byte. Resource timing is read once the view has
 * settled, before anything touches the map.
 */
export async function measureFirstView(browser: Browser, url: string, throttle: number, style: StyleChoice = 'painted'): Promise<FirstViewResult> {
  const session = await openSession(browser, url, { throttleAtLoad: throttle, network: true, style });
  try {
    const policy = quietPolicy(throttle);
    await session.page.waitForFunction("document.querySelector('.leaflet-container') !== null", undefined, { timeout: 60_000, polling: 100 });
    // The first map image, then the map's work and every image in the map loaded, then quiet again.
    await session.page.waitForFunction(FIRST_IMAGE, undefined, { timeout: 60_000, polling: 100 });
    await waitQuiet(session.page, 2 * policy.quietMs, 60_000);
    await session.page.waitForFunction(IMAGES_LOADED, undefined, { timeout: 60_000, polling: 100 });
    await waitQuiet(session.page, 2 * policy.quietMs, 60_000);
    const rows = await session.page.evaluate<ResourceRow[]>(RESOURCES);
    const ready = await session.page.evaluate<number | null>("(() => { const m = performance.getEntriesByName('frl:workspace-ready')[0]; return m === undefined ? null : m.startTime; })()");
    const opening = await session.page.evaluate<FirstViewResult['opening']>(OPENING);
    return analyseFirstView(rows, ready, opening);
  } finally {
    await closeSession(session);
  }
}
