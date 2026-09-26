/**
 * The app's derived results over real data and real navigation, end to end (ARCHITECTURE §12.1,
 * §9.1; terrain-navigation.md §9.2-§9.6): the Durotar fixture slice and the sample route, the
 * committed `public/nav` manifest loaded and checked by `startNavigation`, the navigation worker
 * run in-process on the committed blocks (read through the fake fetch, every file verified with
 * Node's WebCrypto), the scheduler, the leg table and the navigation model, and the engine, the
 * simulation and the validator in the pipeline:
 *
 * - the first walk (the manifest still being checked) uses the straight-line model and is not final;
 * - once navigation is available the walk's legs are pending, computed in the "computing paths"
 *   phase and re-walked in batches, until the results are final with navmesh legs;
 * - the numbers change only by travel time (navigation changes seconds, never places, §9.4).
 *
 * No client needed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fixedClock } from '../src/app/clock';
import { createDerivedStore, type DerivedResults, provisionalNote } from '../src/app/derived';
import { projectRules, projectTravelGraph, selectTravelModel, travelGraphSourceOf } from '../src/app/derived-context';
import { createDerivedPipeline } from '../src/app/derived-pipeline';
import { startNavigation } from '../src/app/navigation-runtime';
import { createEditorStore } from '../src/app/store';
import { loadWorkspace } from '../src/app/workspace';
import type { SpawnPoint } from '../src/domain/dataset';
import { npcId, sequentialIdSource } from '../src/domain/ids';
import type { WorldPoint } from '../src/domain/points';
import { createNavWorkerClient } from '../src/nav/worker/client';
import type { UserDock } from '../src/rules/travel-graph';
import { type Bytes, fakeServer, fixtureSite, nodeSha256, publicSite, REPO_ROOT } from './support/fake-fetch';
import { inProcessNavWorker } from './support/nav-mesh';

const NOW = '2026-09-26T00:00:00.000Z';
const BASE = 'https://site.test/';

/** The fixture slice and geometry (or the files of `base`), and every file under public/nav, as the site serves them. */
function site(base: Map<string, Bytes> = fixtureSite()): Map<string, Bytes> {
  const out = base;
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

const travelSeconds = (r: DerivedResults | null): number => (r?.estimates ?? []).reduce((sum, e) => sum + e.breakdown.travel, 0);

describe('derived results with navigation, end to end', () => {
  it('walk the sample route with the straight-line model, then with navmesh legs once they are computed', { timeout: 60_000 }, async () => {
    const server = fakeServer(site(), BASE);
    const workspace = await loadWorkspace({ fetch: server.fetch, baseUrl: BASE, sha256: nodeSha256, nowIso: NOW, allowSlice: true, yieldToRender: () => Promise.resolve() });
    const store = createEditorStore({ project: workspace.project, ids: sequentialIdSource(1000), clock: fixedClock(NOW) });
    const handle = createDerivedStore();
    const pipeline = createDerivedPipeline({ store, data: workspace.data, geometry: workspace.geometry.geometry, output: handle });

    await vi.waitFor(() => {
      expect(handle.store.getState().status).toBe('ready');
    });
    const straight = handle.store.getState().results;
    expect(straight?.travelModel).toBe('straight-line');
    expect(straight?.final).toBe(false);
    expect(straight?.estimates).toHaveLength(workspace.project.route.steps.length);

    const navigation = await startNavigation({
      fetch: server.fetch,
      baseUrl: BASE,
      sha256: nodeSha256,
      createService: ({ json, baseUrl }) => createNavWorkerClient({ baseUrl, manifest: json, port: inProcessNavWorker({ fetch: server.fetch, digest: nodeSha256 }).port }),
    });
    expect(navigation.kind).toBe('available');
    pipeline.setNavigation(navigation);

    await vi.waitFor(
      () => {
        const state = handle.store.getState();
        expect(state.results?.travelModel).toBe('navigation');
        expect(state.results?.final).toBe(true);
      },
      { timeout: 50_000, interval: 50 },
    );
    const state = handle.store.getState();
    const walked = state.results;
    expect(provisionalNote(state)).toBeNull();
    expect(state.travel).toMatchObject({ model: 'navigation', unavailableMaps: [], unavailableAll: false });
    expect(state.paths.state).toBe('idle');
    expect(walked?.pendingLegs).toBe(0);
    const legs = walked?.records.flatMap((record) => record.legs) ?? [];
    expect(legs.some((leg) => leg.method === 'navigation' && leg.seconds.basis !== 'unknown')).toBe(true);
    // Navigation changes seconds, never which places are visited, the XP or the issues' codes.
    expect(walked?.metrics.xpGained).toEqual(straight?.metrics.xpGained);
    expect(walked?.records.map((r) => r.legs.map((leg) => [leg.from.point, leg.to.point]))).toEqual(straight?.records.map((r) => r.legs.map((leg) => [leg.from.point, leg.to.point])));
    expect(travelSeconds(walked)).not.toBe(travelSeconds(straight));
    expect(walked?.issues.map((issue) => issue.code).filter((code) => !code.startsWith('SIM'))).toEqual(straight?.issues.map((issue) => issue.code).filter((code) => !code.startsWith('SIM')));

    pipeline.dispose();
    if (navigation.kind === 'available') navigation.runtime.dispose();
  });
});

describe('same-map transports on the committed navmesh (D-034 item 2, terrain-navigation §9.3 case 2; NAV-08)', () => {
  it('price a leg with no walking path across the Auberdine – Rut\'theran boat once both docks have positions', { timeout: 60_000 }, async () => {
    const server = fakeServer(site(publicSite()), BASE);
    const workspace = await loadWorkspace({ fetch: server.fetch, baseUrl: BASE, sha256: nodeSha256, nowIso: NOW, yieldToRender: () => Promise.resolve() });
    const view = workspace.data.view({ faction: 'Alliance', class: 'WARRIOR', customQuests: [], questOverrides: {} });
    const geometry = workspace.geometry.geometry;
    /** A dataset NPC's first resolved spawn (published position). */
    const spawnOf = (id: number): SpawnPoint & { readonly world: WorldPoint } => {
      const spawn = view.spawns({ kind: 'npc', id: npcId(id) }).find((s): s is SpawnPoint & { readonly world: WorldPoint } => s.world !== null);
      if (spawn === undefined) throw new Error(`NPC ${String(id)} has no resolved spawn`);
      return spawn;
    };
    // Innkeeper Shaussiy (Auberdine, Darkshore) to Vesprystus (Rut'theran Village): no walking path.
    const inn = spawnOf(6737);
    const rutheran = spawnOf(3838);
    // Stand-ins for user-entered docks (TIME-7): the two villages' hippogryph masters' published
    // spawns (Vesprystus 3838, Caylais Moonfeather 3841). No dock position is seeded or invented.
    const auberdine = spawnOf(3841);
    const docks: UserDock[] = [
      { transportId: 'rutheran-auberdine', stop: 0, point: rutheran.world },
      { transportId: 'rutheran-auberdine', stop: 1, point: auberdine.world },
    ];
    const navigation = await startNavigation({
      fetch: server.fetch,
      baseUrl: BASE,
      sha256: nodeSha256,
      createService: ({ json, baseUrl }) => createNavWorkerClient({ baseUrl, manifest: json, port: inProcessNavWorker({ fetch: server.fetch, digest: nodeSha256 }).port }),
    });
    if (navigation.kind !== 'available') throw new Error(`navigation ${navigation.kind}`);
    const rules = projectRules('forever-beta', {});
    const speeds = { groundYps: rules.values.runSpeed.value, swimYps: rules.values.swimSpeed.value };
    const legOf = async (userDocks: readonly UserDock[]) => {
      const graph = projectTravelGraph(view, [], rules, userDocks);
      const selection = selectTravelModel({ navigation, detourFactor: rules.values.groundDetourFactor.value, graph, faction: 'Alliance', dataset: view, geometry });
      const model = selection.navigation;
      if (model === null) throw new Error('no navigation model');
      const from = { point: inn.world, zoneHint: selection.hints.spawn(inn, inn.world) };
      const to = { point: rutheran.world, zoneHint: selection.hints.spawn(rutheran, rutheran.world) };
      expect(await navigation.runtime.scheduler.computeLegs(model, [{ from, to }])).toMatchObject({ complete: true });
      return model.leg(from, to, speeds);
    };
    // Without dock positions: the labelled straight-line fallback, with the no-walking-path warning.
    const without = await legOf([]);
    expect(without).toMatchObject({ method: 'straight-line', pending: false });
    expect(without.warnings).toContainEqual({ kind: 'no-walking-path' });
    // With both docks: walk to the Auberdine dock, the boat (assumed wait and ride), walk on.
    const withDocks = await legOf(docks);
    expect(withDocks).toMatchObject({ method: 'same-map-transport', pending: false });
    expect(withDocks.seconds.basis).toBe('assumption');
    expect(withDocks.seconds.value).toBeGreaterThan(rules.values.transportWaitSeconds.value + rules.values.transportRideSeconds.value);
    navigation.runtime.dispose();
  });
});

describe('dungeon entrances (TIME-7; ENG-01)', () => {
  it('fail here once zones.json records an instance world map for a dungeon while the app still seeds no entrance edge', () => {
    const zones = JSON.parse(readFileSync(join(REPO_ROOT, 'public', 'data', 'zones.json'), 'utf8')) as { dungeons: Record<string, Record<string, unknown> & { entrances?: readonly Record<string, unknown>[] }> };
    const mapKey = (record: Record<string, unknown>): boolean => Object.keys(record).some((key) => /map/i.test(key));
    const withMap = Object.values(zones.dungeons).filter((d) => mapKey(d) || (d.entrances ?? []).some(mapKey));
    const seeded = travelGraphSourceOf({ npc: () => undefined, spawns: () => [], zone: () => undefined }, []).dungeons;
    // Today: 122 dungeons, none with an instance map id (QuestieDB instanceIdToAreaId.lua is not
    // extracted, DATA_PROVENANCE §6.6), so no entrance edge; a step on an instance map keeps SIM-4.
    expect(Object.keys(zones.dungeons).length).toBeGreaterThan(0);
    if (withMap.length > 0) expect(seeded.length).toBeGreaterThan(0);
    else expect(seeded).toEqual([]);
  });
});
