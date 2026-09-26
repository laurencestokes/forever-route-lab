/**
 * The navigation worker on the committed `public/nav` (terrain-navigation.md §9.6, §17 step 3b.6),
 * read from disk through the injected fetch, with Node's WebCrypto verifying every file: Durotar
 * and Barrens legs between dataset spawns, reachability and plausible lengths. An exact length is
 * asserted only where docs/measurements/nav-m3b.json records the same query. The app side (leg
 * table, model, scheduler, client) then runs on top of it once, end to end.
 *
 * No client needed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimate } from '../src/domain/estimate';
import { worldMapId } from '../src/domain/ids';
import type { TravelEndpoint } from '../src/domain/travel';
import { NavigationLegTable, NavigationPathCache } from '../src/app/navigation-legs';
import { createNavigationTravelModel } from '../src/app/navigation-model';
import { createNavigationScheduler } from '../src/app/navigation-scheduler';
import { straightLineModel } from '../src/app/navigation-test-helpers';
import { parseNavManifest, spawnHint } from '../src/nav/manifest';
import { createNavWorkerClient } from '../src/nav/worker/client';
import { NAV_HEAP_TARGET_BYTES, NavWorkerCore } from '../src/nav/worker/core';
import type { NavLegQuery, NavLegResult, NavPoint } from '../src/nav/worker/protocol';
import { loadSpawns, type Spawn } from '../tools/terrain/lib/spawns';
import { fakeServer, nodeSha256, REPO_ROOT, type Bytes } from './support/fake-fetch';
import { inProcessNavWorker } from './support/nav-mesh';

const BASE = 'https://site.test/';

/** Every file under public/nav, keyed as the site serves it (`nav/...`). */
function navSite(): Map<string, Bytes> {
  const out = new Map<string, Bytes>();
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, `${prefix}${name}/`);
      else out.set(`${prefix}${name}`, new Uint8Array(readFileSync(path)));
    }
  };
  walk(join(REPO_ROOT, 'public', 'nav'), 'nav/');
  return out;
}

const SITE = navSite();
const MANIFEST_JSON = JSON.parse(new TextDecoder().decode(SITE.get('nav/manifest.json'))) as unknown;
const MANIFEST = parseNavManifest(MANIFEST_JSON);
const KALIMDOR = MANIFEST.maps.find((m) => m.mapId === 1);
const SPAWNS = loadSpawns(REPO_ROOT).spawns.filter((s) => s.mapId === 1);

/** The first spawn (lowest index) of an entity on Kalimdor. */
function spawnOf(kind: Spawn['kind'], id: number): Spawn {
  const s = SPAWNS.filter((x) => x.kind === kind && x.id === id).sort((a, b) => a.index - b.index)[0];
  if (s === undefined) throw new Error(`${kind} ${String(id)} has no Kalimdor spawn`);
  return s;
}

/** A spawn's endpoint with its census hint (§8.1: its area key rolled up). */
const pointOf = (s: Spawn): NavPoint => ({ x: s.x, y: s.y, hint: KALIMDOR === undefined ? 0 : spawnHint(KALIMDOR, s.areaKey) });
const leg = (a: Spawn, b: Spawn): NavLegQuery => ({ mapId: 1, from: pointOf(a), to: pointOf(b) });
const straight = (q: NavLegQuery): number => Math.sqrt((q.to.x - q.from.x) ** 2 + (q.to.y - q.from.y) ** 2);
const lengthYd = (r: NavLegResult | undefined): number => ((r?.groundTenths ?? 0) + (r?.swimTenths ?? 0)) / 10;

// Flight masters: Devrak (3615, the Crossroads), Omusa Thunderhorn (10378, Camp Taurajo), Doras
// (3310, Orgrimmar); npc 3036 stands in Thunder Bluff (G7b), which no connector joins yet (G8).
const CROSSROADS_TO_TAURAJO = leg(spawnOf('npc', 3615), spawnOf('npc', 10378));
const ORGRIMMAR_TO_CROSSROADS = leg(spawnOf('npc', 3310), spawnOf('npc', 3615));
const CROSSROADS_TO_THUNDER_BLUFF = leg(spawnOf('npc', 3615), spawnOf('npc', 3036));
/**
 * nav-m3b.json `probes.durotarOutliers`: the Durotar fixture's largest path ÷ straight ratio,
 * npc 3101 at (−44, −4274) to object 1731 at (−9, −4221), both Durotar (14): "straight 64 path
 * 2114 swim 0", in both directions (the 3b.5 runtime reproduces the ratio, 33.28).
 */
const DUROTAR_OUTLIER: NavLegQuery = { mapId: 1, from: { x: -44, y: -4274, hint: 14 }, to: { x: -9, y: -4221, hint: 14 } };
const DUROTAR_OUTLIER_BACK: NavLegQuery = { mapId: 1, from: DUROTAR_OUTLIER.to, to: DUROTAR_OUTLIER.from };
const QUERIES = [CROSSROADS_TO_TAURAJO, ORGRIMMAR_TO_CROSSROADS, CROSSROADS_TO_THUNDER_BLUFF, DUROTAR_OUTLIER, DUROTAR_OUTLIER_BACK];

const coreOver = (maxBytes?: number): { core: NavWorkerCore; requests: () => string[] } => {
  const server = fakeServer(SITE, BASE);
  const core = new NavWorkerCore({ manifest: MANIFEST, baseUrl: `${BASE}nav/`, fetch: server.fetch, digest: nodeSha256, ...(maxBytes === undefined ? {} : { maxBytes }) });
  return { core, requests: () => server.requests.map((r) => r.url.slice(BASE.length)) };
};

describe('the worker core on the committed navigation data', () => {
  it('fetches and verifies map.bin and the blocks it needs, and answers Durotar and Barrens legs', async () => {
    const { core, requests } = coreOver();
    const [taurajo, orgrimmar, thunderBluff, outlier, back] = await core.legs(1, QUERIES);
    // the recorded query: exactly the recorded length, no swimming, both ways
    expect([lengthYd(outlier), outlier?.swimTenths]).toEqual([2114, 0]);
    expect([lengthYd(back), back?.swimTenths]).toEqual([2114, 0]);
    // Barrens and Durotar legs over land: reachable, never shorter than the straight line, and
    // within 1.5 times it (the Barrens fixture's p90 ratio is 1.15, §9.5)
    for (const [r, q] of [
      [taurajo, CROSSROADS_TO_TAURAJO],
      [orgrimmar, ORGRIMMAR_TO_CROSSROADS],
    ] as const) {
      expect(r?.reachable).toBe(true);
      expect(r?.from.snapped && r.to.snapped).toBe(true);
      expect(lengthYd(r)).toBeGreaterThanOrEqual(straight(q));
      expect(lengthYd(r) / straight(q)).toBeLessThan(1.5);
    }
    // Thunder Bluff is its own component until its elevators are observed (G8)
    expect([thunderBluff?.reachable, thunderBluff?.reason]).toEqual([false, 'other-component']);
    const files = requests();
    expect(files[0]).toBe('nav/1/map.bin');
    expect(files.slice(1).every((f) => /^nav\/1\/\d+_\d+\.bin$/.test(f))).toBe(true);
    const stats = core.stats();
    expect([stats.filesVerified, stats.refetches, stats.blocksPinned]).toEqual([files.length, 0, 0]);
    expect(stats.bytes).toBeLessThan(NAV_HEAP_TARGET_BYTES);
  });

  it('gives the same legs when every block is evicted between requests', async () => {
    const { core: resident } = coreOver();
    const expected = await resident.legs(1, QUERIES);
    const { core } = coreOver(1);
    const got: NavLegResult[] = [];
    for (const [i, q] of [...QUERIES].reverse().entries()) got.unshift(...(await core.legs(i, [q])));
    expect(got).toEqual(expected);
    expect(core.stats().blocksEvicted).toBeGreaterThan(0);
  });
});

describe('the navigation travel model on the committed data, end to end', () => {
  it('walks pending, then fills from the worker in one batch, with the fallback where there is no path', async () => {
    const worker = inProcessNavWorker({ fetch: fakeServer(SITE, BASE).fetch, digest: nodeSha256 });
    const client = createNavWorkerClient({ baseUrl: BASE, manifest: MANIFEST_JSON, port: worker.port });
    const table = new NavigationLegTable(MANIFEST.navRevision);
    const paths = new NavigationPathCache();
    const fallback = straightLineModel();
    const model = createNavigationTravelModel({ manifest: MANIFEST, fallback, table, paths });
    const scheduler = createNavigationScheduler({ service: client, table, paths });
    const end = (p: NavPoint): TravelEndpoint => ({ point: { mapId: worldMapId(1), x: p.x, y: p.y }, zoneHint: p.hint });
    const speeds = { groundYps: 7, swimYps: 4.72 };
    const pairs = [CROSSROADS_TO_TAURAJO, CROSSROADS_TO_THUNDER_BLUFF, DUROTAR_OUTLIER].map((q) => ({ from: end(q.from), to: end(q.to) }));
    const batch = new Promise((resolve) => scheduler.subscribe(resolve));
    expect(pairs.map((p) => model.leg(p.from, p.to, speeds).pending)).toEqual([true, true, true]);
    expect(await batch).toEqual({ legs: 3, paths: 0, unavailable: [] });
    const [taurajo, thunderBluff, outlier] = pairs.map((p) => model.leg(p.from, p.to, speeds));
    expect(taurajo).toMatchObject({ method: 'navigation', pending: false, warnings: [] });
    expect(outlier).toEqual({ seconds: estimate(2114 / 7, 'derived'), method: 'navigation', pending: false, warnings: [] });
    const tb = pairs[1];
    if (tb === undefined) throw new Error('no pair');
    expect(thunderBluff).toEqual({ ...fallback.leg(tb.from, tb.to, speeds), warnings: [{ kind: 'no-walking-path' }] });
    scheduler.dispose();
    client.dispose();
  });
});
