/**
 * The browser harness's command line (tests/bench/browser/README.md): builds and serves each tree,
 * then measures them in interleaved rounds (round r takes the trees in an order rotated by r), and
 * writes every session's raw results and the per-tree summary (median and spread over rounds).
 *
 * Usage:
 *   pnpm exec tsx tests/bench/browser/run.ts --tree cur=. [--tree pre=<dir> --tree main=<dir>]
 *     [--rounds 5] [--no-build] [--parts first-view,sample,ten-k,pans] [--out <dir>]
 *     [--project <file>] [--sel 14] [--edits 12] [--throttles 1,4] [--style painted|minimap|app]
 *
 * `--tree label=dir`: a checkout with its own node_modules (`pnpm install --frozen-lockfile`); the
 * first tree is the one the others are compared with in the summary's ratios (`base`), unless
 * `--base <label>` names another.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import {
  closeSession,
  cpuProbe,
  DEVICE_SCALE_FACTOR,
  DUROTAR,
  type InteractionSet,
  measureEdit,
  measureFirstView,
  measurePans,
  measureSelection,
  NETWORK,
  openSession,
  prepareSample,
  prepareTenK,
  prepareTenKWindow,
  quietPolicy,
  setThrottle,
  VIEWPORT,
  waitQuiet,
  type FirstViewResult,
  type PanResult,
  type StyleChoice,
} from './cases';
import { buildBenchProject, defaultProjectPath } from './make-project';
import { launchOptions, loadPlaywright, type Browser } from './playwright';
import { buildAndSnapshot, type BuildRecord, servePreview, type Served } from './server';
import { spread, type Spread } from './stats';

type Part = 'first-view' | 'sample' | 'ten-k' | 'pans';
const PARTS: readonly Part[] = ['first-view', 'sample', 'ten-k', 'pans'];

interface Args {
  readonly trees: readonly { readonly label: string; readonly dir: string }[];
  readonly base: string;
  readonly rounds: number;
  readonly build: boolean;
  readonly parts: readonly Part[];
  readonly out: string;
  readonly project: string | null;
  readonly selections: number;
  readonly edits: number;
  readonly throttles: readonly number[];
  readonly style: StyleChoice;
}

function parseArgs(argv: readonly string[]): Args {
  const values = (name: string): string[] => argv.flatMap((arg, i) => (arg === name && argv[i + 1] !== undefined ? [argv[i + 1] ?? ''] : []));
  const one = (name: string, fallback: string): string => values(name).at(-1) ?? fallback;
  const trees = values('--tree').map((spec) => {
    const at = spec.indexOf('=');
    if (at <= 0) throw new Error(`--tree wants label=dir, got ${spec}`);
    return { label: spec.slice(0, at), dir: resolve(spec.slice(at + 1)) };
  });
  if (trees.length === 0) throw new Error('give at least one --tree label=dir');
  const parts = one('--parts', PARTS.join(',')).split(',').map((part) => {
    if (!PARTS.includes(part as Part)) throw new Error(`unknown part ${part}; parts are ${PARTS.join(', ')}`);
    return part as Part;
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    trees,
    base: one('--base', trees[0]?.label ?? ''),
    rounds: Number(one('--rounds', '5')),
    build: !argv.includes('--no-build'),
    parts,
    out: resolve(one('--out', join('.cache', 'bench', 'browser', stamp))),
    project: values('--project').at(-1) ?? null,
    selections: Number(one('--sel', '14')),
    edits: Number(one('--edits', '12')),
    throttles: one('--throttles', '1,4').split(',').map(Number),
    style: styleOf(one('--style', 'painted')),
  };
}

function styleOf(value: string): StyleChoice {
  if (value === 'painted' || value === 'minimap' || value === 'app') return value;
  throw new Error(`--style is painted, minimap or app, not ${value}`);
}

interface InteractionPart {
  readonly selection: InteractionSet;
  readonly edit: InteractionSet;
}

interface SessionResult {
  readonly label: string;
  readonly round: number;
  readonly part: Part;
  readonly startedAt: string;
  readonly loadavg: readonly number[];
  /** The page's CPU probe at 1× when the session opened (cases.ts `cpuProbe`). */
  readonly probeMs?: number;
  readonly firstView?: Readonly<Record<string, FirstViewResult>>;
  readonly interactions?: Readonly<Record<string, InteractionPart>>;
  readonly pans?: PanResult;
  readonly pageErrors: readonly string[];
  readonly error?: string;
}

function log(message: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
}

/** Selection and edit at each throttle, in the window the session has set up. */
async function interactions(page: Parameters<typeof measureSelection>[0], session: Parameters<typeof setThrottle>[0], args: Args, editRow: number): Promise<Record<string, InteractionPart>> {
  const out: Record<string, InteractionPart> = {};
  for (const throttle of args.throttles) {
    await setThrottle(session, throttle);
    const selection = await measureSelection(page, throttle, args.selections);
    const edit = await measureEdit(page, throttle, args.edits, editRow);
    await setThrottle(session, 1);
    await waitQuiet(page, quietPolicy(1).quietMs, 30_000);
    out[`x${String(throttle)}`] = { selection, edit };
  }
  return out;
}

async function runPart(browser: Browser, served: Served, label: string, round: number, part: Part, args: Args, projectFile: string, projectSteps: number): Promise<SessionResult> {
  const base = { label, round, part, startedAt: new Date().toISOString(), loadavg: loadavg().map((value) => Math.round(value * 100) / 100) };
  if (part === 'first-view') {
    const firstView: Record<string, FirstViewResult> = {};
    for (const throttle of args.throttles) firstView[`x${String(throttle)}`] = await measureFirstView(browser, served.url, throttle, args.style);
    return { ...base, firstView, pageErrors: [] };
  }
  const session = await openSession(browser, served.url, { style: args.style });
  try {
    const { page } = session;
    const probe = { probeMs: await cpuProbe(page) };
    if (part === 'sample') {
      await prepareSample(page);
      return { ...base, ...probe, interactions: await interactions(page, session, args, 5), pageErrors: session.errors };
    }
    if (part === 'ten-k') {
      await prepareTenKWindow(page, projectFile, projectSteps);
      return { ...base, ...probe, interactions: await interactions(page, session, args, 5), pageErrors: session.errors };
    }
    await prepareTenK(page, projectFile, projectSteps, DUROTAR);
    await setThrottle(session, 4);
    const pans = await measurePans(page, 4);
    await setThrottle(session, 1);
    return { ...base, ...probe, pans, pageErrors: session.errors };
  } finally {
    await closeSession(session);
  }
}

// =============================================================================================
// Summary: per tree, each figure's median over rounds of the per-round value, with its spread

type Figures = Record<string, number[]>;

function add(figures: Figures, key: string, value: number | null | undefined): void {
  if (value === null || value === undefined || !Number.isFinite(value)) return;
  (figures[key] ??= []).push(value);
}

function figuresOf(result: SessionResult, figures: Figures): void {
  add(figures, `probeMs.${result.part}`, result.probeMs);
  for (const [throttle, view] of Object.entries(result.firstView ?? {})) {
    add(figures, `firstView.${throttle}.firstArtAfterChunkMs`, view.firstArtAfterChunkMs);
    add(figures, `firstView.${throttle}.firstArtEndMs`, view.firstArtEndMs);
    add(figures, `firstView.${throttle}.firstTileRequestMs`, view.firstTileRequestMs);
    add(figures, `firstView.${throttle}.workspaceReadyMs`, view.workspaceReadyMs);
    add(figures, `firstView.${throttle}.firstViewBytes`, view.firstViewBytes);
    add(figures, `firstView.${throttle}.allMapImageBytes`, view.allMapImageBytes);
  }
  const project = result.part === 'sample' ? 'sample' : 'tenK';
  for (const [throttle, part] of Object.entries(result.interactions ?? {})) {
    for (const kind of ['selection', 'edit'] as const) {
      const set = part[kind];
      const key = `${project}.${throttle}.${kind}`;
      add(figures, `${key}.toLastPaintMs.median`, set.toLastPaintMs.median);
      add(figures, `${key}.toLastPaintMs.p90`, set.toLastPaintMs.p90);
      add(figures, `${key}.toFirstPaintMs.median`, set.toFirstPaintMs.median);
      add(figures, `${key}.lastMapCallMs.median`, set.lastMapCallMs.median);
      add(figures, `${key}.derivedMs.median`, set.derivedMs.median);
      add(figures, `${key}.withoutMapWork`, set.withoutMapWork);
    }
  }
  if (result.pans !== undefined) {
    const pans = result.pans;
    add(figures, 'pans.x4.drags.p95', pans.drags.p95);
    add(figures, 'pans.x4.drags.p99', pans.drags.p99);
    add(figures, 'pans.x4.drags.max', pans.drags.max);
    add(figures, 'pans.x4.drags.over33', pans.drags.over33);
    add(figures, 'pans.x4.longDrag.p99', pans.longDrag.p99);
    add(figures, 'pans.x4.longTasks.count', pans.longTasks.count);
    add(figures, 'pans.x4.longTasks.over50', pans.longTasks.over50);
    add(figures, 'pans.x4.longTasks.maxMs', pans.longTasks.maxMs ?? 0);
    add(figures, 'pans.x4.syncMs.median', pans.syncMs.median);
    add(figures, 'pans.x4.syncMs.max', pans.syncMs.max);
  }
}

function summarise(results: readonly SessionResult[], labels: readonly string[], base: string): Record<string, unknown> {
  const byTree: Record<string, Record<string, Spread>> = {};
  for (const label of labels) {
    const figures: Figures = {};
    for (const result of results.filter((candidate) => candidate.label === label && candidate.error === undefined)) figuresOf(result, figures);
    byTree[label] = Object.fromEntries(Object.entries(figures).sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => [key, spread(values)]));
  }
  const ratios: Record<string, Record<string, number>> = {};
  for (const label of labels) {
    if (label === base) continue;
    const mine = byTree[label] ?? {};
    const theirs = byTree[base] ?? {};
    ratios[`${label}/${base}`] = Object.fromEntries(
      Object.keys(mine).flatMap((key) => {
        const a = mine[key]?.median;
        const b = theirs[key]?.median;
        return a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b) || b === 0 ? [] : [[key, Math.round((a / b) * 1000) / 1000]];
      }),
    );
  }
  return { byTree, ratios };
}

async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  mkdirSync(args.out, { recursive: true });
  const playwright = loadPlaywright();
  log(`Playwright ${playwright.version} from ${playwright.from}; results in ${args.out}`);

  // The 10,000-step project: the given file, or built (deterministic) when missing.
  const projectFile = args.project ?? defaultProjectPath(10_000);
  if (!existsSync(projectFile)) {
    const built = await buildBenchProject(10_000);
    mkdirSync(join(projectFile, '..'), { recursive: true });
    writeFileSync(projectFile, built.text);
  }
  const projectText = readFileSync(projectFile, 'utf8');
  const project = { file: projectFile, sha256: createHash('sha256').update(projectText).digest('hex'), steps: 10_000 };

  const builds: BuildRecord[] = args.trees.map((tree) => {
    log(`${args.build ? 'building' : 'copying'} ${tree.label} (${tree.dir})`);
    return buildAndSnapshot(tree.label, tree.dir, args.out, args.build);
  });
  const servers = new Map<string, Served>();
  for (const build of builds) servers.set(build.label, await servePreview(build.tree.dir, build.distDir));
  const browser = await playwright.chromium.launch(launchOptions());
  const meta = {
    harness: 'tests/bench/browser/run.ts',
    machine: { cpus: cpus().length, cpuModel: cpus()[0]?.model ?? 'unknown', platform: process.platform, node: process.version },
    browser: browser.version(),
    launch: launchOptions(),
    playwright: playwright.version,
    viewport: { ...VIEWPORT, deviceScaleFactor: DEVICE_SCALE_FACTOR },
    network: NETWORK,
    rounds: args.rounds,
    parts: args.parts,
    throttles: args.throttles,
    style: args.style,
    selections: args.selections,
    edits: args.edits,
    quiet: Object.fromEntries(args.throttles.map((throttle) => [`x${String(throttle)}`, quietPolicy(throttle)])),
    project,
    builds: builds.map((build) => ({ label: build.label, head: build.tree.head, changes: build.tree.changes.length, changesSha256: build.tree.changesSha256, entryGzipKb: build.entryGzipKb, buildOk: build.buildOk })),
    base: args.base,
  };
  writeFileSync(join(args.out, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  const results: SessionResult[] = [];
  try {
    for (let round = 0; round < args.rounds; round += 1) {
      const order = args.trees.map((_, i) => args.trees[(i + round) % args.trees.length]).filter((tree) => tree !== undefined);
      for (const part of args.parts) {
        for (const tree of order) {
          const served = servers.get(tree.label);
          if (served === undefined) continue;
          log(`round ${String(round + 1)}/${String(args.rounds)} ${part} ${tree.label}`);
          let result: SessionResult;
          try {
            result = await runPart(browser, served, tree.label, round, part, args, project.file, project.steps);
          } catch (error) {
            result = { label: tree.label, round, part, startedAt: new Date().toISOString(), loadavg: loadavg(), pageErrors: [], error: error instanceof Error ? (error.stack ?? error.message) : String(error) };
            log(`  failed: ${result.error ?? ''}`);
          }
          results.push(result);
          writeFileSync(join(args.out, `r${String(round + 1)}-${part}-${tree.label}.json`), `${JSON.stringify(result, null, 2)}\n`);
          writeFileSync(join(args.out, 'summary.json'), `${JSON.stringify({ meta, ...summarise(results, args.trees.map((t) => t.label), args.base) }, null, 2)}\n`);
        }
      }
    }
  } finally {
    await browser.close();
    for (const served of servers.values()) await served.stop();
  }
  const failures = results.filter((result) => result.error !== undefined).length;
  const withoutWork = results.reduce((total, result) => total + Object.values(result.interactions ?? {}).reduce((sum, part) => sum + part.selection.withoutMapWork + part.edit.withoutMapWork, 0), 0);
  log(`done: ${String(results.length)} sessions, ${String(failures)} failed, ${String(withoutWork)} interactions without map work; ${join(args.out, 'summary.json')}`);
  if (failures > 0 || withoutWork > 0) process.exitCode = 1;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
