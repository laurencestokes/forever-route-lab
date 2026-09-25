/**
 * Loader benchmark (ARCHITECTURE §14: dataset fetch to ready ≤ 1 s, no long task > 100 ms).
 *
 *   pnpm exec tsx tests/bench/loader.bench.ts [--runs 7] [--dir public|fixture]
 *   node --expose-gc --import tsx tests/bench/loader.bench.ts   (adds the retained heap of one workspace)
 *
 * Runs the app's startup (`loadWorkspace`: manifest, parallel fetch, SHA-256 of every file,
 * strict UTF-8 decoding, JSON.parse, the shape check, geometry with its frame and content hashes,
 * `prepareDataset`, the first `DatasetView` and the sample project) against a fake `fetch` that
 * serves the committed files
 * from memory, so the numbers are the CPU cost on this machine without network or disk. Node's
 * WebCrypto and JSON.parse stand in for the browser's; the browser budget is checked later with
 * Playwright under CPU throttling (§14). Prints one JSON object: medians and minimums per phase,
 * the longest synchronous section (the long-task candidate), and the spawn conversion counts.
 */
import { performance } from 'node:perf_hooks';
import { loadWorkspace, type WorkspaceReport } from '../../src/app/workspace';
import { fakeServer, nodeSha256, publicSite, fixtureSite } from '../support/fake-fetch';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const runs = Number(option('--runs', '7'));
const fixture = option('--dir', 'public') === 'fixture';
const site = fixture ? fixtureSite() : publicSite();
/** The fixture is the test slice, which the loader refuses unless asked (code-F7). */
const allowSlice = fixture;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};
const round = (value: number): number => Math.round(value * 10) / 10;

const reports: WorkspaceReport[] = [];
for (let run = 0; run < runs; run += 1) {
  const server = fakeServer(site);
  const workspace = await loadWorkspace({
    fetch: server.fetch,
    baseUrl: './',
    sha256: nodeSha256,
    nowIso: '2026-09-25T12:00:00.000Z',
    now: () => performance.now(),
    yieldToRender: () => Promise.resolve(),
    allowSlice,
  });
  reports.push(workspace.report);
}

/** The heap one loaded workspace retains (files, prepared dataset, one view), when gc is exposed. */
async function retainedHeapMb(): Promise<number | null> {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc === undefined) return null;
  gc();
  const before = process.memoryUsage().heapUsed;
  const server = fakeServer(site);
  const kept = await loadWorkspace({ fetch: server.fetch, baseUrl: './', sha256: nodeSha256, nowIso: '2026-09-25T12:00:00.000Z', yieldToRender: () => Promise.resolve(), allowSlice });
  gc();
  const after = process.memoryUsage().heapUsed;
  return kept.project.route.steps.length > 0 ? Math.round((after - before) / 1e5) / 10 : null;
}
const heapMb = await retainedHeapMb();

const phase = (pick: (r: WorkspaceReport) => number) => {
  const values = reports.map(pick);
  return { median: round(median(values)), min: round(Math.min(...values)), max: round(Math.max(...values)) };
};
const last = reports.at(-1);
if (last === undefined) throw new Error('no runs');
const perFile = Object.fromEntries(
  Object.keys(last.files).map((path) => [
    path,
    {
      bytes: last.files[path]?.bytes ?? 0,
      hashMs: phase((r) => r.files[path]?.hashMs ?? 0),
      parseMs: phase((r) => r.files[path]?.parseMs ?? 0),
      checkMs: phase((r) => r.files[path]?.checkMs ?? 0),
    },
  ]),
);
// The longest synchronous stretch: prepareDataset runs as one task; each file's decode + parse +
// check runs in that file's own continuation.
const longestSync = phase((r) => Math.max(r.prepareMs, ...Object.values(r.files).map((f) => f.parseMs + f.checkMs)));

console.log(
  JSON.stringify(
    {
      runs,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      totalMs: phase((r) => r.totalMs),
      datasetMs: phase((r) => r.datasetMs),
      geometryMs: phase((r) => r.geometryMs),
      prepareMs: phase((r) => r.prepareMs),
      viewMs: phase((r) => r.viewMs),
      sampleMs: phase((r) => r.sampleMs),
      longestSyncMs: longestSync,
      perFile,
      geometryReloaded: last.geometryReloaded,
      spawnStats: last.spawnStats,
      retainedHeapMb: heapMb,
    },
    null,
    2,
  ),
);
