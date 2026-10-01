/**
 * Interactions' main-thread timelines (tests/bench/browser/README.md, "Finding the cause"): the
 * harness's sample or 10,000-step window, a few selection clicks or Alt+↓ and Alt+↑ edits
 * (`--repeat`), each under the CDP Profiler, printed as segments of the profile (which function, or
 * idle, ran when), with the app's User Timing measures and the frames timed from the input.
 *
 *   pnpm exec tsx tests/bench/browser/timeline.ts --tree . --dist <unminified dist> --project sample --case edit [--throttle 1] [--repeat 3]
 */
import { resolve, join } from 'node:path';
import { closeSession, measureEdit, measureSelection, openSession, prepareSample, prepareTenKWindow, setThrottle, visibleRows, rowPoint, waitQuiet, quietPolicy } from './cases';
import { defaultProjectPath } from './make-project';
import { launchOptions, loadPlaywright } from './playwright';
import { probeCall, type ProbeMark, type ProbeSince } from './probe';
import { servePreview } from './server';

interface Node {
  readonly id: number;
  readonly callFrame: { readonly functionName: string; readonly url: string; readonly lineNumber: number };
  readonly children?: readonly number[];
}
interface Profile {
  readonly nodes: readonly Node[];
  readonly samples: readonly number[];
  readonly timeDeltas: readonly number[];
  readonly startTime: number;
}

const name = (node: Node): string => {
  const file = node.callFrame.url.slice(node.callFrame.url.lastIndexOf('/') + 1).replace(/-[\w-]{8}\.js$/, '');
  return `${node.callFrame.functionName === '' ? '(anon)' : node.callFrame.functionName}${file === '' ? '' : `@${file}:${String(node.callFrame.lineNumber + 1)}`}`;
};

/** Segments: consecutive samples with the same "task" label (the stack's frames below root, the first `depth` interesting ones). */
function segments(profile: Profile, depth: number): { start: number; end: number; label: string }[] {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parent = new Map<number, number>();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  // React's own scheduling and event dispatch, and anonymous wrappers in the entry chunk, say nothing
  // about which work ran: the label is the first named frames below them.
  const SKIP = /^(\(root\)|\(anon\)@index:\d+|processRootScheduleInMicrotask|flushSyncWorkAcrossRoots_impl|performSyncWorkOnRoot|performWorkOnRoot|dispatchDiscreteEvent|dispatchEvent|batchedUpdates\$1|dispatchEventForPluginEventSystem|processDispatchQueue)/;
  const out: { start: number; end: number; label: string }[] = [];
  let t = profile.startTime;
  profile.samples.forEach((id, i) => {
    t += profile.timeDeltas[i] ?? 0;
    const stack: string[] = [];
    for (let at: number | undefined = id; at !== undefined; at = parent.get(at)) {
      const node = byId.get(at);
      if (node !== undefined) stack.unshift(name(node));
    }
    const interesting = stack.filter((frame) => !SKIP.test(frame));
    const label = interesting.slice(0, depth).join(' > ') || stack.at(-1) || '?';
    const last = out.at(-1);
    if (last !== undefined && last.label === label) last.end = t;
    else out.push({ start: t, end: t, label });
  });
  return out;
}

async function main(argv: readonly string[]): Promise<void> {
  const option = (key: string, fallback: string): string => {
    const i = argv.indexOf(key);
    return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
  };
  const tree = resolve(option('--tree', '.'));
  const dist = resolve(option('--dist', join(tree, 'dist')));
  const project = option('--project', 'sample');
  const kind = option('--case', 'selection');
  const throttle = Number(option('--throttle', '1'));
  const repeat = Number(option('--repeat', '2'));
  const depth = Number(option('--depth', '3'));
  const playwright = loadPlaywright();
  const served = await servePreview(tree, dist);
  const browser = await playwright.chromium.launch(launchOptions());
  try {
    const session = await openSession(browser, served.url);
    try {
      const { page, cdp } = session;
      if (project === 'sample') await prepareSample(page);
      else await prepareTenKWindow(page, option('--project-file', defaultProjectPath(10_000)), 10_000);
      await setThrottle(session, throttle);
      // Warm up as the harness does (one selection, or the edit's selection and two edits).
      if (kind === 'edit') await measureEdit(page, throttle, 2, 5);
      else await measureSelection(page, throttle, 2);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 50 });
      const rows = await visibleRows(page);
      for (let r = 0; r < repeat; r += 1) {
        const mark = await page.evaluate<ProbeMark>(probeCall('mark'));
        await page.evaluate(probeCall('startFrames'));
        const origin = await page.evaluate<number>('performance.timeOrigin');
        await cdp.send('Profiler.start');
        if (kind === 'edit') await page.keyboard.press(r % 2 === 0 ? 'Alt+ArrowDown' : 'Alt+ArrowUp');
        else {
          const row = rows[(2 * r + 1) % rows.length];
          if (row === undefined) throw new Error('no row');
          const point = rowPoint(row);
          await page.mouse.click(point.x, point.y);
        }
        const policy = quietPolicy(throttle);
        await page.evaluate(probeCall('waitQuiet', mark.measures, mark.time, policy.quietMs, policy.quietMs, policy.maxMs));
        const { profile } = (await cdp.send('Profiler.stop')) as { profile: Profile };
        const recorded = await page.evaluate<ProbeSince>(probeCall('since', mark));
        await page.evaluate(probeCall('stopFrames'));
        const input = recorded.inputs.find((i) => i.type === (kind === 'edit' ? 'keydown' : 'pointerdown') && (kind !== 'edit' || i.key !== 'Alt'));
        if (input === undefined) throw new Error('no input');
        // Profile times are µs on the monotonic clock; performance.now() is ms since timeOrigin (ms since the epoch, wall clock).
        // Align on the input: the first profile segment that is not idle after the start is the input's dispatch.
        const segs = segments(profile, depth);
        const firstBusy = segs.find((s) => !s.label.startsWith('(idle)') && !s.label.startsWith('(program)'));
        const base = firstBusy?.start ?? profile.startTime;
        console.log(`\n=== ${kind} #${String(r + 1)} (profile aligned to the first JS sample = input dispatch; origin ${String(origin)})`);
        for (const s of segs) {
          const from = (s.start - base) / 1000;
          const to = (s.end - base) / 1000;
          if (to < -5) continue;
          if (to - from < 0.4 && !s.label.includes('Quest')) continue;
          console.log(`${from.toFixed(1).padStart(7)} ${to.toFixed(1).padStart(7)} ${(to - from).toFixed(1).padStart(6)}  ${s.label}`);
        }
        console.log('  measures (from input):');
        for (const m of recorded.measures) if (m.start >= input.time - 1) console.log(`    ${(m.start - input.time).toFixed(1).padStart(7)} +${m.duration.toFixed(1)} ${m.name}${m.inFrame ? ' (frame)' : ''}`);
        console.log('  frames (first callback, from input):', recorded.frames.map((f) => (f.called - input.time).toFixed(1)).slice(0, 14).join(' '));
        await waitQuiet(page, 300, 5_000);
      }
    } finally {
      await closeSession(session);
    }
  } finally {
    await browser.close();
    await served.stop();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
