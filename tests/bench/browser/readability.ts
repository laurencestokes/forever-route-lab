/**
 * The left panel's readability, measured in a production build (docs/DECISIONS.md D-051; the method
 * of docs/reviews/rework-followup.md, "Readability study", "Readability mocks" and "Readability
 * critic"). It opens the committed sample project as a first visit does, at the study's 1366 × 768,
 * and reads every route row in three states:
 *
 * - **At rest** (not hovered, not selected, not the active row): quest titles cut, issue words cut,
 *   NPC names and zones cut, quest rows with no place shown, chain positions hidden.
 * - **Hovered** (the pointer on the row): the same, for rows whose buttons appear on hover (the
 *   critic's "with the buttons showing").
 * - **Active** (each row clicked in turn): whether its issue's words, its NPC name and its zone are
 *   whole, whether the D-040 carried-work cue (a carried turn-in's issue words) is shown and whole,
 *   whether its chain position shows, and its height.
 *
 * Also the steps wholly in view (as the app opens, at the top of the list, and with step 8 active,
 * the mocks' sheet), the list's height, whether the active row ends wholly in view after ↓, PageDown,
 * PageUp, End and Home, and whether every row's name and tooltip carry its chain position and level.
 * readability-summary.ts has the definitions of "cut" and the counts.
 *
 * `--variant bplus` injects the B+ mock (bplus-mock.ts) into the same build; `today` measures the
 * build as it is. `--font selawik` draws the UI in Selawik (Microsoft's open, Segoe UI-metric font,
 * installed on the machine; never committed) instead of the machine's system-ui, with weight 500
 * drawn Semibold as the study saw Chrome draw Segoe UI on Windows; `system` (the default) leaves the
 * app's own font stack. Every result records the font Chromium actually used (CDP
 * `CSS.getPlatformFontsForNode`), which is the label every figure needs: the D-051 figures were
 * taken in Segoe UI on Windows.
 *
 * Usage:
 *   pnpm build
 *   pnpm exec tsx tests/bench/browser/readability.ts [--dist dist] [--variant today,bplus]
 *     [--font system|selawik] [--theme light|dark] [--dpr 1.5] [--gutter 0] [--out <dir>] [--no-shots]
 *     [--quick]
 *
 * `--gutter N` takes N CSS px from the right of the rows, as a classic scroll bar would (Playwright's
 * headless Chromium draws none): a check of how much a narrower text column moves the counts.
 * `--quick` skips the hover and active passes (rest and view only). Output in `--out` (default
 * `.cache/readability/<time>/`): `readability-<variant>.json` (every row record and the counts),
 * screenshots of the left panel (`<variant>-open.png`, `-rest.png`, `-hover.png`, `-active-8.png`,
 * `-active-45.png`), and the table printed at the end.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BPLUS_CSS, BPLUS_SCRIPT } from './bplus-mock';
import { MAP_LAYERS_KEY, VIEWPORT } from './cases';
import { launchOptions, loadPlaywright, type Page } from './playwright';
import { PAGE_SOURCE } from './readability-page';
import { activeCounts, namesCarry, ofText, rowCounts, type RowRecord } from './readability-summary';
import { servePreview } from './server';

type Variant = 'today' | 'bplus';
type FontChoice = 'system' | 'selawik';

interface Args {
  readonly dist: string;
  readonly variants: readonly Variant[];
  readonly font: FontChoice;
  readonly theme: 'light' | 'dark';
  readonly dpr: number;
  readonly out: string;
  readonly shots: boolean;
  readonly quick: boolean;
  /** CSS px taken from the right of the rows, as a classic scroll bar takes them (0: none, as headless Chromium draws). */
  readonly gutter: number;
}

function parseArgs(argv: readonly string[]): Args {
  const one = (name: string, fallback: string): string => {
    const at = argv.lastIndexOf(name);
    return at >= 0 && argv[at + 1] !== undefined ? (argv[at + 1] ?? fallback) : fallback;
  };
  const variants = one('--variant', 'today,bplus').split(',').map((value) => {
    if (value !== 'today' && value !== 'bplus') throw new Error(`--variant is today and/or bplus, not ${value}`);
    return value;
  });
  const font = one('--font', 'system');
  if (font !== 'system' && font !== 'selawik') throw new Error(`--font is system or selawik, not ${font}`);
  const theme = one('--theme', 'light');
  if (theme !== 'light' && theme !== 'dark') throw new Error(`--theme is light or dark, not ${theme}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    dist: resolve(one('--dist', 'dist')),
    variants,
    font,
    theme,
    dpr: Number(one('--dpr', '1.5')),
    out: resolve(one('--out', join('.cache', 'readability', stamp))),
    shots: !argv.includes('--no-shots'),
    quick: argv.includes('--quick'),
    gutter: Number(one('--gutter', '0')),
  };
}

/** Selawik for the UI font, weight 500 drawn Semibold (as Chrome draws Segoe UI's 500 on Windows, per the study). */
const SELAWIK_CSS = String.raw`
@font-face { font-family: 'FRL measure UI'; src: local('Selawik'), local('Selawik-Regular'); font-weight: 1 450; }
@font-face { font-family: 'FRL measure UI'; src: local('Selawik Semibold'), local('Selawik-Semibold'); font-weight: 451 649; }
@font-face { font-family: 'FRL measure UI'; src: local('Selawik Bold'), local('Selawik-Bold'); font-weight: 650 1000; }
:root, :root[data-theme] { --frl-font-ui: 'FRL measure UI', sans-serif !important; }
`;

/** A script that adds a stylesheet as soon as the document has a head (an init script runs before it does). */
function styleScript(css: string): string {
  return `(() => { const add = () => { const style = document.createElement('style'); style.dataset.frlMeasure = ''; style.textContent = ${JSON.stringify(css)}; (document.head || document.documentElement).appendChild(style); }; if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add, { once: true }); else add(); })();`;
}

const call = <R>(page: Page, expression: string): Promise<R> => page.evaluate<R>(`(async () => window.__frlRead.${expression})()`);

function log(message: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
}

/** Waits until the rows' names stop changing for 1.5 s (the derived numbers have arrived). */
async function waitSettled(page: Page): Promise<void> {
  let last = '';
  let since = Date.now();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const labels = await call<string>(page, 'labels()');
    if (labels !== last) {
      last = labels;
      since = Date.now();
    } else if (Date.now() - since > 1500) return;
    await page.waitForTimeout(250);
  }
  throw new Error('the route rows did not settle within 90 s');
}

/** The fonts Chromium drew a step title with (CDP CSS.getPlatformFontsForNode). */
async function fontsUsed(page: Page, cdp: { send(method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown> }): Promise<string[]> {
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const doc = (await cdp.send('DOM.getDocument', { depth: 1 })) as { root: { nodeId: number } };
  const found = (await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.frl-steprow__title' })) as { nodeId: number };
  const fonts = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId: found.nodeId })) as { fonts: { familyName: string; postScriptName?: string; glyphCount: number }[] };
  void page;
  return fonts.fonts.map((font) => `${font.familyName}${font.postScriptName === undefined || font.postScriptName === '' ? '' : ` (${font.postScriptName})`}: ${String(font.glyphCount)} glyphs`);
}

const PARK = { x: 6, y: 6 } as const;

/** Rows' records at rest: every step, each read while it is not selected, active or hovered. */
async function restPass(page: Page, steps: number): Promise<RowRecord[]> {
  const byStep = new Map<number, RowRecord>();
  const collect = async (): Promise<void> => {
    for (const row of await call<RowRecord[]>(page, 'rows()')) {
      if (!row.selected && !row.active && !row.hovered && !byStep.has(row.step)) byStep.set(row.step, row);
    }
  };
  await page.mouse.move(PARK.x, PARK.y);
  for (let step = 1; step <= steps; step += 4) {
    await call(page, `reveal(${String(step)})`);
    await collect();
  }
  // The rows that were selected or active: make another row active, then read them.
  const missing = Array.from({ length: steps }, (_, i) => i + 1).filter((step) => !byStep.has(step));
  for (const step of missing) {
    const other = step === 1 ? 2 : step - 1;
    await call(page, `reveal(${String(other)})`);
    await clickRow(page, other);
    await call(page, `reveal(${String(step)})`);
    await page.mouse.move(PARK.x, PARK.y);
    await call(page, 'frames(2)');
    await collect();
  }
  return [...byStep.values()].sort((a, b) => a.step - b.step);
}

/** Clicks a row on its title line, clear of the number (the drag handle) and of the buttons. */
async function clickRow(page: Page, step: number): Promise<void> {
  const box = await call<{ x: number; y: number; width: number; height: number } | null>(page, `box(${String(step)})`);
  if (box === null) throw new Error(`step ${String(step)} is not mounted`);
  await page.mouse.click(box.x + Math.min(150, box.width / 2), box.y + 10);
  await call(page, 'frames(3)');
}

/** Each row hovered in turn (skipping the active row), read while the pointer is on it. */
async function hoverPass(page: Page, steps: number): Promise<RowRecord[]> {
  const out: RowRecord[] = [];
  for (let step = 1; step <= steps; step += 1) {
    await call(page, `reveal(${String(step)})`);
    const box = await call<{ x: number; y: number; width: number; height: number } | null>(page, `box(${String(step)})`);
    if (box === null) continue;
    await page.mouse.move(box.x + Math.min(150, box.width / 2), box.y + 10);
    await call(page, 'frames(2)');
    const row = await call<RowRecord | null>(page, `row(${String(step)})`);
    if (row !== null && !row.active && !row.selected) out.push(row);
  }
  await page.mouse.move(PARK.x, PARK.y);
  return out;
}

/** Each row made active in turn (a click, as a user selects it), read with the pointer parked. */
async function activePass(page: Page, steps: number): Promise<RowRecord[]> {
  const out: RowRecord[] = [];
  for (let step = 1; step <= steps; step += 1) {
    await call(page, `reveal(${String(step)})`);
    await clickRow(page, step);
    await call(page, `reveal(${String(step)})`);
    await page.mouse.move(PARK.x, PARK.y);
    await call(page, 'frames(2)');
    const row = await call<RowRecord | null>(page, `row(${String(step)})`);
    if (row === null || !row.active) throw new Error(`step ${String(step)} did not become the active row`);
    out.push(row);
  }
  return out;
}

interface KeyCheck {
  readonly key: string;
  readonly activeStep: number | null;
  readonly activeInView: boolean | null;
}

/** ↓ ↓ PageDown PageDown PageUp End Home from step 8, as the mocks' report: does the active row end wholly in view? */
async function keyPass(page: Page): Promise<KeyCheck[]> {
  await call(page, 'reveal(8)');
  await clickRow(page, 8);
  await page.mouse.move(PARK.x, PARK.y);
  const out: KeyCheck[] = [];
  for (const key of ['ArrowDown', 'ArrowDown', 'PageDown', 'PageDown', 'PageUp', 'End', 'Home']) {
    await page.keyboard.press(key);
    await call(page, 'frames(3)');
    const view = await call<{ activeStep: number | null; activeInView: boolean | null }>(page, 'view()');
    out.push({ key, activeStep: view.activeStep, activeInView: view.activeInView });
  }
  return out;
}

async function shot(page: Page, args: Args, name: string): Promise<void> {
  if (!args.shots) return;
  const clip = await call<{ x: number; y: number; width: number; height: number }>(page, 'panel()');
  await page.screenshot({ path: join(args.out, `${name}.png`), clip });
}

async function measureVariant(url: string, variant: Variant, args: Args): Promise<unknown> {
  const playwright = loadPlaywright();
  const browser = await playwright.chromium.launch(launchOptions());
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: args.dpr, colorScheme: args.theme });
    const style = `try { if (localStorage.getItem(${JSON.stringify(MAP_LAYERS_KEY)}) === null) localStorage.setItem(${JSON.stringify(MAP_LAYERS_KEY)}, ${JSON.stringify(JSON.stringify({ version: 1, style: 'painted' }))}); } catch (error) { /* storage blocked */ }`;
    const scripts = [style];
    if (args.font === 'selawik') scripts.push(styleScript(SELAWIK_CSS));
    if (args.gutter > 0) scripts.push(styleScript(`.frl-routelist__canvas { width: calc(100% - ${String(args.gutter)}px) !important; }`));
    if (variant === 'bplus') scripts.push(styleScript(BPLUS_CSS), BPLUS_SCRIPT);
    await context.addInitScript({ content: scripts.join('\n') });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });
    const cdp = await context.newCDPSession(page);
    await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForFunction("performance.getEntriesByName('frl:workspace-ready').length > 0 && document.querySelector('[role=listbox] [role=option]') !== null", undefined, { timeout: 120_000, polling: 100 });
    await page.evaluate(PAGE_SOURCE);
    await page.mouse.move(PARK.x, PARK.y);
    await waitSettled(page);
    const fonts = await fontsUsed(page, cdp);
    const steps = Number(await page.evaluate<string>("document.querySelector('[role=option][aria-setsize]').getAttribute('aria-setsize')"));
    log(`${variant}: ${String(steps)} steps; title font ${fonts.join('; ')}`);

    const atOpen = await call<unknown>(page, 'view()');
    await shot(page, args, `${variant}-open`);
    await page.evaluate("document.querySelector('[role=listbox]').scrollTop = 0");
    await call(page, 'frames(3)');
    const atTop = await call<unknown>(page, 'view()');
    await shot(page, args, `${variant}-rest`);

    const rest = await restPass(page, steps);
    const result: Record<string, unknown> = { variant, steps, fonts, atOpen, atTop, rest: rowCounts(rest), names: namesCarry(rest) };
    if (!args.quick) {
      await call(page, 'reveal(8)');
      await clickRow(page, 8);
      await page.evaluate("document.querySelector('[role=listbox]').scrollTop = 0");
      await call(page, 'frames(3)');
      await page.mouse.move(PARK.x, PARK.y);
      result['step8Active'] = await call<unknown>(page, 'view()');
      await shot(page, args, `${variant}-active-8`);
      const hovered = await hoverPass(page, steps);
      result['hover'] = rowCounts(hovered);
      // Step 11 hovered, with step 8 still the active row, for the picture.
      await page.evaluate("document.querySelector('[role=listbox]').scrollTop = 0");
      await call(page, 'frames(3)');
      const hoverBox = await call<{ x: number; y: number; width: number; height: number } | null>(page, 'box(11)');
      if (hoverBox !== null) {
        await page.mouse.move(hoverBox.x + 150, hoverBox.y + 10);
        await call(page, 'frames(2)');
        await shot(page, args, `${variant}-hover`);
        await page.mouse.move(PARK.x, PARK.y);
      }
      const active = await activePass(page, steps);
      result['active'] = activeCounts(active);
      await call(page, 'reveal(45)');
      await clickRow(page, 45);
      await page.mouse.move(PARK.x, PARK.y);
      await call(page, 'frames(3)');
      await shot(page, args, `${variant}-active-45`);
      result['keys'] = await keyPass(page);
      result['rows'] = { rest, hover: hovered, active };
    } else {
      result['rows'] = { rest };
    }
    result['pageErrors'] = errors;
    await context.close();
    return result;
  } finally {
    await browser.close();
  }
}

interface Printable {
  readonly variant: string;
  readonly fonts: readonly string[];
  readonly atOpen: { readonly stepsInView: number; readonly listHeight: number };
  readonly atTop: { readonly stepsInView: number };
  readonly step8Active?: { readonly stepsInView: number };
  readonly rest: ReturnType<typeof rowCounts>;
  readonly hover?: ReturnType<typeof rowCounts>;
  readonly active?: ReturnType<typeof activeCounts>;
  readonly names: ReturnType<typeof namesCarry>;
}

/** The results side by side as a Markdown table. */
function table(results: readonly Printable[]): string {
  const rows: [string, (r: Printable) => string][] = [
    ['Title font', (r) => r.fonts[0] ?? '?'],
    ['List height (px)', (r) => String(r.atOpen.listHeight)],
    ['Steps wholly in view: as opened / top / step 8 active', (r) => `${String(r.atOpen.stepsInView)} / ${String(r.atTop.stepsInView)} / ${r.step8Active === undefined ? '-' : String(r.step8Active.stepsInView)}`],
    ['Quest titles cut at rest', (r) => ofText(r.rest.questTitlesCut)],
    ['All titles cut at rest', (r) => ofText(r.rest.titlesCut)],
    ['Issue words cut at rest', (r) => ofText(r.rest.issueWordsCut)],
    ['NPC names cut at rest', (r) => ofText(r.rest.npcNamesCut)],
    ['Zones cut at rest', (r) => ofText(r.rest.zonesCut)],
    ['Quest rows with no place at rest', (r) => ofText(r.rest.noPlace)],
    ['Chain hidden at rest', (r) => ofText(r.rest.chainHidden)],
    ['Issue words cut on hover', (r) => (r.hover === undefined ? '-' : ofText(r.hover.issueWordsCut))],
    ['NPC names cut on hover', (r) => (r.hover === undefined ? '-' : ofText(r.hover.npcNamesCut))],
    ['Active: issue words whole', (r) => (r.active === undefined ? '-' : ofText(r.active.issueWhole))],
    ['Active: NPC and zone whole', (r) => (r.active === undefined ? '-' : ofText(r.active.placeWhole))],
    ['Active: carried-work cue shown / whole', (r) => (r.active === undefined ? '-' : `${ofText(r.active.carriedCueShown)} / ${ofText(r.active.carriedCueWhole)}`)],
    ['Active: chain shown', (r) => (r.active === undefined ? '-' : ofText(r.active.chainShown))],
    ['Active: title whole', (r) => (r.active === undefined ? '-' : ofText(r.active.titleWhole))],
    ['Active row height (px)', (r) => (r.active === undefined ? '-' : r.active.heightPx.join('-'))],
    ['Chain in name / tooltip', (r) => `${ofText(r.names.chainInName)} / ${ofText(r.names.chainInTooltip)}`],
  ];
  const head = `| | ${results.map((r) => r.variant).join(' | ')} |\n|---|${results.map(() => '---').join('|')}|`;
  return [head, ...rows.map(([label, cell]) => `| ${label} | ${results.map(cell).join(' | ')} |`)].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.out, { recursive: true });
  const served = await servePreview(process.cwd(), args.dist);
  const results: Printable[] = [];
  try {
    for (const variant of args.variants) {
      log(`${variant}: measuring ${args.dist} (${args.font} font, ${args.theme}, DPR ${String(args.dpr)}, gutter ${String(args.gutter)} px)`);
      const result = await measureVariant(served.url, variant, args);
      writeFileSync(join(args.out, `readability-${variant}.json`), `${JSON.stringify({ font: args.font, theme: args.theme, dpr: args.dpr, gutter: args.gutter, viewport: VIEWPORT, dist: args.dist, ...(result as object) }, null, 1)}\n`);
      results.push(result as Printable);
    }
  } finally {
    await served.stop();
  }
  const text = table(results);
  writeFileSync(join(args.out, 'table.md'), `${text}\n`);
  console.log(text);
  log(`wrote ${args.out}`);
}

await main();
