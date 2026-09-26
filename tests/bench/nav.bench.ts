/**
 * Navigation runtime benchmark (terrain-navigation.md §9.5, §9.6, §14.3; RC-06, RC-07, RC-13):
 * `src/nav` on the committed `public/nav`, the fixture baselines of step 3b.5.
 *
 *   node --expose-gc --import tsx tests/bench/nav.bench.ts [--runs 3] [--write]
 *
 * Fixtures (map 1, Kalimdor):
 * - `durotar`, `barrens`: the zone's dataset spawns (area key rolled up with the manifest's hint
 *   roll-up) sorted by (kind, id, x, y), every k-th to 300, rounded to 1 yd and snapped with rules
 *   A and B (the prototype's §9.5 sets);
 * - `barrensPool` (RC-07's realistic section): every quest whose `zoneOrSort` is The Barrens (17),
 *   98 quests and about 300 actions (accept, objectives, turn-in; ARCHITECTURE §14's pool of 100):
 *   its quest givers and turn-in targets (their first spawn on the map) and one location per
 *   objective (the spawn nearest the centroid of the objective's Barrens spawns: the kill or object
 *   target, or an item's droppers), unique after 1-yd rounding.
 *
 * Per fixture: the directed N × N matrix (one `legsFrom` per source over every target) with the
 * whole map resident (median of `--runs`, determinism by hash), the same against the build's
 * reference `legsFrom` (tools/terrain/lib/legs.ts, the one G10/G10b check against Detour), the
 * engine's consecutive single legs, mesh-derived path ÷ straight line, the 3D ÷ 2D length ratio
 * (RC-13), and "computing paths" from an empty mesh: snap loads, then the searches loading what
 * they reach (RC-06), with the blocks loaded and their gzip-6 bytes (§9.6 fetch baselines; fetch
 * and SHA-256 are not included). Memory: the typed layout's bytes and the measured heap growth
 * (heapUsed + arrayBuffers, after gc) with each continent resident (RC-07). Block decode and link:
 * each block alone into an empty mesh.
 *
 * Prints one JSON object; `--write` stores it as the `runtime` section of
 * docs/measurements/nav-m3b.json.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { buildMapMesh } from '../../tools/terrain/lib/link';
import { decodeBlock as buildDecode } from '../../tools/terrain/lib/encode';
import { components as buildComponents } from '../../tools/terrain/lib/components';
import { legsFrom as buildLegs, scratch as buildScratch } from '../../tools/terrain/lib/legs';
import { derive, readBuildConfig } from '../../tools/terrain/lib/settings';
import { meshParams } from '../../tools/terrain/lib/stage2';
import { loadSpawns, type Spawn } from '../../tools/terrain/lib/spawns';
import { legsFrom, LegSearch, loadBlock, openMap, parseNavManifest, quantise, SearchScratch, snap, snapMissing, spawnHint, type Leg, type LegEndpoint, type NavMapEntry, type NavMesh } from '../../src/nav';
import { REPO_ROOT } from '../support/fake-fetch';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const RUNS = Number(option('--runs', '3'));
const WRITE = args.includes('--write');
const NAV = join(REPO_ROOT, 'public', 'nav');
const MAP = 1;

const gc = (globalThis as { gc?: () => void }).gc;
const manifest = parseNavManifest(JSON.parse(readFileSync(join(NAV, 'manifest.json'), 'utf8')) as unknown);
const entryOf = (mapId: number): NavMapEntry => {
  const e = manifest.maps.find((m) => m.mapId === mapId);
  if (e === undefined) throw new Error(`map ${String(mapId)} missing`);
  return e;
};
const t0 = performance.now();
const files = new Map<string, Buffer>();
const file = (path: string): Buffer => {
  let b = files.get(path);
  if (b === undefined) {
    b = readFileSync(join(NAV, path));
    files.set(path, b);
  }
  return b;
};
const gz6 = new Map<string, number>();
const gzipOf = (path: string): number => {
  let n = gz6.get(path);
  if (n === undefined) {
    n = gzipSync(file(path), { level: 6 }).length;
    gz6.set(path, n);
  }
  return n;
};

const median = (values: readonly number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};
const quantile = (values: readonly number[], p: number): number => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? Number.NaN;
};
const r1 = (v: number): number => Math.round(v * 10) / 10;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const r4 = (v: number): number => Math.round(v * 10000) / 10000;

function openLoaded(mapId: number): NavMesh {
  const e = entryOf(mapId);
  const mesh = openMap(manifest, mapId, file(e.mapFile.path));
  e.blocks.forEach((b, i) => loadBlock(mesh, i, file(b.path)));
  return mesh;
}

// ---------------------------------------------------------------------------------------------
// memory and block loading

function memory(mapId: number): Record<string, unknown> {
  const e = entryOf(mapId);
  for (const b of e.blocks) file(b.path);
  file(e.mapFile.path);
  gc?.();
  gc?.();
  const m0 = process.memoryUsage();
  const t = performance.now();
  const resident = openLoaded(mapId);
  const loadMs = performance.now() - t;
  const scratch = new SearchScratch(resident);
  gc?.();
  gc?.();
  const m1 = process.memoryUsage();
  const typed = resident.typedBytes();
  const per: number[] = [];
  e.blocks.forEach((b, i) => {
    const single = openMap(manifest, mapId, file(e.mapFile.path));
    const tb = performance.now();
    loadBlock(single, i, file(b.path));
    per.push(performance.now() - tb);
  });
  const out = {
    polygons: resident.n,
    blocks: resident.blockCount,
    loadAllMs: r1(loadMs),
    typedLayoutBytes: typed.map + typed.blocks,
    typedLayout: { mapWide: typed.map, blocks: typed.blocks, searchScratch: scratch.bytes },
    bytesPerPolygon: r1((typed.map + typed.blocks + scratch.bytes) / resident.n),
    heapGrowthMB: gc === undefined ? null : r1((m1.heapUsed + m1.arrayBuffers - m0.heapUsed - m0.arrayBuffers) / 1e6),
    blockDecodeAndLinkMs: { p50: r1(quantile(per, 0.5)), p90: r1(quantile(per, 0.9)), max: r1(Math.max(...per)) },
  };
  return out;
}

// measured first, in a heap that holds nothing else yet but the file bytes
const memoryByMap = { '1': memory(1), '0': memory(0) };

// ---------------------------------------------------------------------------------------------
// fixtures

const entry1 = entryOf(MAP);
const loaded = loadSpawns(REPO_ROOT);
const spawns = loaded.spawns.filter((s) => s.mapId === MAP);
const hintOf = (s: Spawn): number => spawnHint(entry1, s.areaKey);

interface Point {
  readonly x: number;
  readonly y: number;
  readonly hint: number;
}

function zoneSet(zone: number, n: number): Point[] {
  const c = spawns.filter((s) => hintOf(s) === zone).sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || a.id - b.id || a.x - b.x || a.y - b.y);
  const step = Math.max(1, Math.floor(c.length / n));
  return c
    .filter((_, i) => i % step === 0)
    .slice(0, n)
    .map((s) => ({ x: quantise(s.x), y: quantise(s.y), hint: zone }));
}

interface QuestRow {
  readonly id: number;
  readonly zoneOrSort: number;
  readonly starters: readonly { readonly kind: string; readonly id: number }[];
  readonly finishers: readonly { readonly kind: string; readonly id: number }[];
  readonly objectives: readonly { readonly kind: string; readonly npcId?: number; readonly objectId?: number; readonly itemId?: number }[];
}

function barrensPool(): { points: Point[]; quests: number; actions: number; skipped: Record<string, number> } {
  const quests = (JSON.parse(readFileSync(join(REPO_ROOT, 'public', 'data', 'quests.json'), 'utf8')) as { rows: QuestRow[] }).rows.filter((q) => q.zoneOrSort === 17).sort((a, b) => a.id - b.id);
  const items = new Map((JSON.parse(readFileSync(join(REPO_ROOT, 'public', 'data', 'items.json'), 'utf8')) as { rows: { id: number; dropNpcs?: number[]; dropObjects?: number[] }[] }).rows.map((r) => [r.id, r]));
  const byEntity = new Map<string, Spawn[]>();
  for (const s of spawns) {
    const k = `${s.kind}:${String(s.id)}`;
    const list = byEntity.get(k);
    if (list === undefined) byEntity.set(k, [s]);
    else list.push(s);
  }
  for (const list of byEntity.values()) list.sort((a, b) => a.index - b.index);
  const skipped: Record<string, number> = {};
  const skip = (why: string): void => {
    skipped[why] = (skipped[why] ?? 0) + 1;
  };
  const out: Point[] = [];
  let actions = 0;
  const giver = (g: { kind: string; id: number }): void => {
    actions += 1;
    if (g.kind !== 'npc' && g.kind !== 'object') return skip(`giver-${g.kind}`);
    const first = byEntity.get(`${g.kind}:${String(g.id)}`)?.[0];
    if (first === undefined) return skip('giver-no-spawn-on-map');
    out.push({ x: quantise(first.x), y: quantise(first.y), hint: hintOf(first) });
  };
  for (const q of quests) {
    for (const g of q.starters) giver(g);
    for (const g of q.finishers) giver(g);
    for (const o of q.objectives) {
      actions += 1;
      const entities: string[] = [];
      if (o.kind === 'kill' && o.npcId !== undefined) entities.push(`npc:${String(o.npcId)}`);
      else if (o.kind === 'object' && o.objectId !== undefined) entities.push(`object:${String(o.objectId)}`);
      else if (o.kind === 'item' && o.itemId !== undefined) {
        const it = items.get(o.itemId);
        for (const n of it?.dropNpcs ?? []) entities.push(`npc:${String(n)}`);
        for (const n of it?.dropObjects ?? []) entities.push(`object:${String(n)}`);
      } else {
        skip(`objective-${o.kind}`);
        continue;
      }
      const inZone = entities.flatMap((k) => byEntity.get(k) ?? []).filter((s) => hintOf(s) === 17);
      if (inZone.length === 0) {
        skip('objective-no-barrens-spawn');
        continue;
      }
      const cx = inZone.reduce((s, p) => s + p.x, 0) / inZone.length;
      const cy = inZone.reduce((s, p) => s + p.y, 0) / inZone.length;
      const d = (p: Spawn): number => (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy);
      const best = [...inZone].sort((a, b) => d(a) - d(b) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || a.id - b.id || a.index - b.index)[0];
      if (best !== undefined) out.push({ x: quantise(best.x), y: quantise(best.y), hint: 17 });
    }
  }
  const unique = new Map<string, Point>();
  for (const p of out) {
    const k = `${String(p.x)},${String(p.y)},${String(p.hint)}`;
    if (!unique.has(k)) unique.set(k, p);
  }
  const points = [...unique.values()].sort((a, b) => a.x - b.x || a.y - b.y || a.hint - b.hint);
  return { points, quests: quests.length, actions, skipped };
}

// ---------------------------------------------------------------------------------------------
// measurements

const legHash = (legs: readonly (readonly Leg[])[]): string => {
  const h = createHash('sha256');
  for (const row of legs) for (const l of row) h.update(`${l.reachable ? 1 : 0}:${String(l.groundTenths)}:${String(l.swimTenths)}:${String(l.connectorTenthsSeconds)}:${l.flags.join('+')};`);
  return h.digest('hex').slice(0, 16);
};

function snapAll(mesh: NavMesh, points: readonly Point[]): { ends: LegEndpoint[]; unsnapped: number; offMain: number; ambiguous: number } {
  const ends: LegEndpoint[] = [];
  let unsnapped = 0;
  let offMain = 0;
  let ambiguous = 0;
  for (const p of points) {
    const s = snap(mesh, p.x, p.y, p.hint);
    if (s.poly < 0) {
      unsnapped += 1;
      continue;
    }
    if (mesh.comp[s.poly] !== 0) offMain += 1;
    if (s.flags.ambiguous) ambiguous += 1;
    ends.push({ x: p.x, y: p.y, poly: s.poly });
  }
  return { ends, unsnapped, offMain, ambiguous };
}

function matrix(mesh: NavMesh, S: SearchScratch, ends: readonly LegEndpoint[]): { ms: number; legs: Leg[][]; settled: number } {
  const t0 = performance.now();
  const legs: Leg[][] = [];
  let settled = 0;
  for (const s of ends) {
    const search = new LegSearch(mesh, S, s, ends);
    const status = search.run();
    if (status.kind !== 'done') throw new Error(`matrix: the resident mesh answered ${status.kind}`);
    legs.push([...status.legs]);
    settled += search.settled;
  }
  return { ms: performance.now() - t0, legs, settled };
}

function lazyComputingPaths(points: readonly Point[]): { ms: number; snapBlocks: number; snapGzip6: number; blocks: number; gzip6: number; hash: string } {
  const e = entry1;
  const t0 = performance.now();
  const mesh = openMap(manifest, MAP, file(e.mapFile.path));
  const load = (bs: readonly number[]): void => {
    for (const b of bs) loadBlock(mesh, b, file(e.blocks[b]?.path ?? ''));
  };
  const ends: LegEndpoint[] = [];
  for (const p of points) {
    load(snapMissing(mesh, p.x, p.y));
    const s = snap(mesh, p.x, p.y, p.hint);
    if (s.poly >= 0) ends.push({ x: p.x, y: p.y, poly: s.poly });
  }
  const snapLoaded = mesh.loadedBlocks();
  const S = new SearchScratch(mesh);
  const legs: Leg[][] = [];
  for (const s of ends) legs.push([...legsFrom(mesh, S, s, ends, {}, load)]);
  const ms = performance.now() - t0;
  const all = mesh.loadedBlocks();
  const bytes = (bs: readonly number[]): number => bs.reduce((sum, b) => sum + gzipOf(e.blocks[b]?.path ?? ''), 0);
  return { ms, snapBlocks: snapLoaded.length, snapGzip6: bytes(snapLoaded), blocks: all.length, gzip6: bytes(all), hash: legHash(legs) };
}

const cfg = readBuildConfig();
const derived = derive(cfg.settings);
const grid = { perAdt: derived.perAdt, blockAdts: derived.settings.blockAdts, tileVoxels: derived.settings.tileVoxels };
const buildMesh = buildMapMesh(
  entry1.blocks.map((b) => buildDecode(file(b.path), grid)),
  meshParams(derived),
);
const buildComp = buildComponents(buildMesh);
const buildS = buildScratch(buildMesh);

const mesh = openLoaded(MAP);
const S = new SearchScratch(mesh);

function fixture(points: readonly Point[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  const snapped = snapAll(mesh, points);
  const ends = snapped.ends;
  const runs: { ms: number; hash: string }[] = [];
  let legs: Leg[][] = [];
  let settled = 0;
  for (let r = 0; r < RUNS; r += 1) {
    const m = matrix(mesh, S, ends);
    runs.push({ ms: m.ms, hash: legHash(m.legs) });
    legs = m.legs;
    settled = m.settled;
  }
  // the build's reference on the same endpoints
  let diff = 0;
  let compared = 0;
  const tb = performance.now();
  for (let i = 0; i < ends.length; i += 1) {
    const src = ends[i];
    if (src === undefined) continue;
    const want = buildLegs(buildMesh, buildComp.comp, buildS, src, ends);
    want.forEach((w, j) => {
      const g = legs[i]?.[j];
      compared += 1;
      if (g === undefined || g.reachable !== w.reachable || g.groundTenths !== w.groundTenths || g.swimTenths !== w.swimTenths || g.longestSwimYd !== w.longestSwimYd || g.corridor !== w.corridor) diff += 1;
    });
  }
  const buildMs = performance.now() - tb;
  // consecutive single legs, the engine's pattern
  const tc = performance.now();
  for (let i = 0; i + 1 < ends.length; i += 1) {
    const a = ends[i];
    const b = ends[i + 1];
    if (a !== undefined && b !== undefined) legsFrom(mesh, S, a, [b]);
  }
  const consecutiveMs = performance.now() - tc;
  // ratios, swims and the 3D ÷ 2D length (not timed)
  const ratios: number[] = [];
  const ratios3d: number[] = [];
  let sum2d = 0;
  let sum3d = 0;
  let reachable = 0;
  let swim200 = 0;
  let swim400 = 0;
  let passageLegs = 0;
  ends.forEach((s) => {
    const with3d = legsFrom(mesh, S, s, ends, { with3d: true });
    with3d.forEach((l, j) => {
      if (!l.reachable) return;
      reachable += 1;
      if (l.longestSwimYd > 200) swim200 += 1;
      if (l.longestSwimYd > 400) swim400 += 1;
      if (l.flags.includes('unverified-passage')) passageLegs += 1;
      const t = ends[j];
      if (t === undefined) return;
      const straight = Math.sqrt((t.x - s.x) * (t.x - s.x) + (t.y - s.y) * (t.y - s.y));
      const len2d = (l.groundTenths + l.swimTenths) / 10;
      if (straight > 50) ratios.push(len2d / straight);
      if (len2d > 50 && l.length3dYd !== undefined) {
        ratios3d.push(l.length3dYd / len2d);
        sum2d += len2d;
        sum3d += l.length3dYd;
      }
    });
  });
  // computing paths from an empty mesh
  const lazy: ReturnType<typeof lazyComputingPaths>[] = [];
  for (let r = 0; r < RUNS; r += 1) lazy.push(lazyComputingPaths(points));
  const lazyHashes = new Set(lazy.map((l) => l.hash));
  const hashes = new Set(runs.map((r) => r.hash));
  const n = ends.length;
  const l0 = lazy[0];
  return {
    ...extra,
    points: points.length,
    snapped: n,
    unsnapped: snapped.unsnapped,
    offMainPoints: snapped.offMain,
    ambiguousPoints: snapped.ambiguous,
    legs: n * n,
    reachable,
    matrixMs: r1(median(runs.map((r) => r.ms))),
    matrixMsRange: [r1(Math.min(...runs.map((r) => r.ms))), r1(Math.max(...runs.map((r) => r.ms)))],
    msPerSource: r3(median(runs.map((r) => r.ms)) / n),
    settledPerSource: Math.round(settled / n),
    hash: runs[0]?.hash,
    deterministic: hashes.size === 1 && lazyHashes.size === 1 && lazy[0]?.hash === runs[0]?.hash,
    buildReference: { legsCompared: compared, differences: diff, ms: r1(buildMs) },
    consecutive: { legs: n - 1, msMean: r3(consecutiveMs / Math.max(1, n - 1)) },
    ratio: { n: ratios.length, p50: r4(quantile(ratios, 0.5)), p90: r4(quantile(ratios, 0.9)), max: r4(quantile(ratios, 1)) },
    ratio3dOver2d: { n: ratios3d.length, p50: r4(quantile(ratios3d, 0.5)), p90: r4(quantile(ratios3d, 0.9)), max: r4(quantile(ratios3d, 1)), total: r4(sum3d / sum2d) },
    swimOver200Legs: swim200,
    swimOver400Legs: swim400,
    unverifiedPassageLegs: passageLegs,
    computingPathsFromEmpty: {
      ms: r1(median(lazy.map((l) => l.ms))),
      msRange: [r1(Math.min(...lazy.map((l) => l.ms))), r1(Math.max(...lazy.map((l) => l.ms)))],
      snapBlocks: l0?.snapBlocks,
      snapGzip6: l0?.snapGzip6,
      blocks: l0?.blocks,
      gzip6: l0?.gzip6,
    },
  };
}

const pool = barrensPool();
const fixtures = {
  durotar: fixture(zoneSet(14, 300)),
  barrens: fixture(zoneSet(17, 300)),
  barrensPool: fixture(pool.points, { quests: pool.quests, actions: pool.actions, skippedActions: pool.skipped }),
};

const pooled = fixtures.barrensPool as { computingPathsFromEmpty: { ms: number }; matrixMs: number };
const ceilingMs = Math.ceil((pooled.computingPathsFromEmpty.ms * 4 * 1.25) / 100) * 100;

const report = {
  $comment: [
    'Step 3b.5 (src/nav, docs/research/terrain-navigation.md §9.5, §9.6, §14.3; RC-06, RC-07, RC-13): the runtime on the committed public/nav, measured by tests/bench/nav.bench.ts (node --expose-gc --import tsx tests/bench/nav.bench.ts --runs 3 --write).',
    'Fixtures on map 1 (Kalimdor): durotar and barrens are the prototype sets of §9.5 (zone spawns sorted by kind, id, x, y; every k-th to 300; rounded to 1 yd; snapped with rules A and B). barrensPool is the realistic section (RC-07): every quest with zoneOrSort 17 (The Barrens), 98 quests and about 300 actions; its quest givers and turn-in targets (first spawn on the map) and one location per objective (the spawn nearest the centroid of the objective entities\' Barrens spawns; items through their droppers), unique after 1-yd rounding.',
    'matrixMs: one legsFrom per source over every target with the whole map resident (median of the runs, range given); buildReference: the same legs from the build\'s reference legsFrom (tools/terrain/lib/legs.ts, the code G10 and G10b check against Detour), compared field by field; consecutive: N - 1 single-target legs; ratio: (ground + swim) / straight line for legs longer than 50 yd straight (mesh-derived, not game truth); ratio3dOver2d: the 3D length through the portal crossings (each at its portal\'s interpolated height, endpoints by the polygon\'s fan triangle) over the 2D length, legs over 50 yd (RC-13); computingPathsFromEmpty: from an empty mesh, snap every endpoint (loading every block within 6 yd), then the matrix with the searches loading the blocks they reach (RC-06): decode and link included, fetch and SHA-256 not; blocks and gzip6 are the blocks loaded (the fetch baseline, §9.6).',
    'memory: each continent resident in the typed layout: typedLayoutBytes (sum of the typed arrays the mesh holds) and searchScratch (the per-map Dijkstra arrays); heapGrowthMB = growth of heapUsed + arrayBuffers after gc (node --expose-gc) for opening and loading every block, file bytes read beforehand. blockDecodeAndLinkMs: each block decoded and added alone to an empty mesh.',
    'proposedCeiling: the absolute ceiling for "computing paths" of the realistic section on the Milestone 9 throttled profile (4x CPU): computingPathsFromEmpty.ms x 4 x 1.25 (the 25% regression allowance), rounded up to 100 ms. Fetch and SHA-256 of the blocks come on top and are measured in 3b.6.',
  ],
  date: '2026-09-26',
  machine: { cpu: cpus()[0]?.model.trim(), threads: cpus().length, ramGb: Math.round(totalmem() / 1e9), node: process.version },
  navRevision: manifest.navRevision,
  runs: RUNS,
  fixtures,
  memory: memoryByMap,
  proposedCeiling: { realisticSectionComputingPathsMs: ceilingMs, profile: 'Milestone 9 throttled (4x CPU)', basis: 'computingPathsFromEmpty.ms of barrensPool x 4 x 1.25, rounded up to 100 ms; excludes fetch and SHA-256' },
  benchWallMs: Math.round(performance.now() - t0),
};

console.log(JSON.stringify(report, null, 1));
if (WRITE) {
  const path = join(REPO_ROOT, 'docs', 'measurements', 'nav-m3b.json');
  const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  json['runtime'] = report;
  writeFileSync(path, `${JSON.stringify(json, null, 1)}\n`);
  console.error(`wrote the runtime section of ${path}`);
}
