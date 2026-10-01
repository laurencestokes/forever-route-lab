/**
 * A CPU profile of the harness's selection or edit case (tests/bench/browser/README.md, "Finding
 * the cause"): the same window and input as run.ts, with the CDP Profiler sampling the page's main
 * thread around the interactions. Writes the `.cpuprofile` (open it in Chrome DevTools' Performance
 * panel) and prints the functions with the most self and inclusive time.
 *
 * Profile an unminified build so the names mean something:
 *   pnpm exec vite build --minify false --outDir <dir>
 *   pnpm exec tsx tests/bench/browser/profile.ts --tree . --dist <dir> --project sample --case selection [--throttle 1] [--count 14] [--out <dir>]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { closeSession, measureEdit, measureSelection, openSession, prepareSample, prepareTenKWindow, setThrottle, type InteractionSet } from './cases';
import { defaultProjectPath } from './make-project';
import { launchOptions, loadPlaywright } from './playwright';
import { servePreview } from './server';

interface ProfileNode {
  readonly id: number;
  readonly callFrame: { readonly functionName: string; readonly url: string; readonly lineNumber: number; readonly columnNumber: number };
  readonly children?: readonly number[];
}

interface CpuProfile {
  readonly nodes: readonly ProfileNode[];
  readonly samples: readonly number[];
  readonly timeDeltas: readonly number[];
  readonly startTime: number;
  readonly endTime: number;
}

export interface HotFunction {
  readonly name: string;
  readonly selfMs: number;
  readonly totalMs: number;
}

function label(node: ProfileNode): string {
  const frame = node.callFrame;
  const file = frame.url === '' ? '' : frame.url.slice(frame.url.lastIndexOf('/') + 1).replace(/-[\w-]{8}\.js$/, '.js');
  return `${frame.functionName === '' ? '(anonymous)' : frame.functionName}${file === '' ? '' : ` ${file}:${String(frame.lineNumber + 1)}`}`;
}

/** Self and inclusive time per function (by name and place), from a CDP profile. */
export function hotFunctions(profile: CpuProfile): HotFunction[] {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parent = new Map<number, number>();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  const self = new Map<string, number>();
  const total = new Map<string, number>();
  profile.samples.forEach((id, i) => {
    const delta = (profile.timeDeltas[i + 1] ?? profile.timeDeltas[i] ?? 0) / 1000;
    const node = byId.get(id);
    if (node === undefined) return;
    const name = label(node);
    self.set(name, (self.get(name) ?? 0) + delta);
    const seen = new Set<string>();
    for (let at: number | undefined = id; at !== undefined; at = parent.get(at)) {
      const ancestor = byId.get(at);
      if (ancestor === undefined) break;
      const key = label(ancestor);
      if (seen.has(key)) continue;
      seen.add(key);
      total.set(key, (total.get(key) ?? 0) + delta);
    }
  });
  return [...total.keys()].map((name) => ({ name, selfMs: Math.round((self.get(name) ?? 0) * 10) / 10, totalMs: Math.round((total.get(name) ?? 0) * 10) / 10 }));
}

async function main(argv: readonly string[]): Promise<void> {
  const option = (name: string, fallback: string): string => {
    const i = argv.indexOf(name);
    return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
  };
  const tree = resolve(option('--tree', '.'));
  const dist = resolve(option('--dist', join(tree, 'dist')));
  const project = option('--project', 'sample');
  const kind = option('--case', 'selection');
  const throttle = Number(option('--throttle', '1'));
  const count = Number(option('--count', '14'));
  const out = resolve(option('--out', join('.cache', 'bench', 'browser', 'profiles')));
  mkdirSync(out, { recursive: true });
  const playwright = loadPlaywright();
  const served = await servePreview(tree, dist);
  const browser = await playwright.chromium.launch(launchOptions());
  try {
    const session = await openSession(browser, served.url);
    try {
      if (project === 'sample') await prepareSample(session.page);
      else await prepareTenKWindow(session.page, option('--project-file', defaultProjectPath(10_000)), 10_000);
      await setThrottle(session, throttle);
      await session.cdp.send('Profiler.enable');
      await session.cdp.send('Profiler.setSamplingInterval', { interval: 100 });
      await session.cdp.send('Profiler.start');
      const result: InteractionSet = kind === 'edit' ? await measureEdit(session.page, throttle, count, 5) : await measureSelection(session.page, throttle, count);
      const { profile } = (await session.cdp.send('Profiler.stop')) as { profile: CpuProfile };
      await setThrottle(session, 1);
      const name = `${project}-${kind}-x${String(throttle)}`;
      writeFileSync(join(out, `${name}.cpuprofile`), JSON.stringify(profile));
      const hot = hotFunctions(profile);
      const top = (key: 'selfMs' | 'totalMs', n: number) => [...hot].sort((a, b) => b[key] - a[key]).slice(0, n);
      const report = {
        case: name,
        interactions: result.samples.length,
        toLastPaintMs: result.toLastPaintMs,
        toFirstPaintMs: result.toFirstPaintMs,
        profileMs: Math.round((profile.endTime - profile.startTime) / 100) / 10,
        topSelf: top('selfMs', 40),
        topTotal: top('totalMs', 60),
      };
      writeFileSync(join(out, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
      console.log(JSON.stringify({ case: name, toLastPaintMs: result.toLastPaintMs, file: join(out, `${name}.cpuprofile`) }));
    } finally {
      await closeSession(session);
    }
  } finally {
    await browser.close();
    await served.stop();
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
}
