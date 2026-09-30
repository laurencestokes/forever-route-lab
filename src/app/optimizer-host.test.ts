import { describe, expect, it } from 'vitest';
import { fakeServer, nodeSha256, publicSite, readDirectory } from '../../tests/support/fake-fetch';
import { npcId, sequentialIdSource } from '../domain/ids';
import { makeFlightStep } from '../domain/step-factory';
import { createClientTables } from '../infra/maps/client-tables';
import { fixedClock } from './clock';
import { createDerivedStore } from './derived';
import { createDerivedPipeline } from './derived-pipeline';
import { createOptimizationHost } from './optimizer-host';
import { createRunWalker, walkRoute } from './optimizer-walk';
import { createEditorStore } from './store';
import { loadWorkspace } from './workspace';

/**
 * The optimiser host prices a route as the derived pipeline does (review TR-12): its `taxi` input
 * is required, and with the pipeline's loaded taxi file its walk equals the pipeline's (TIME-6),
 * while with `taxi: null` it is TIME-5. The full committed dataset and client tables through the
 * fake fetch; no client needed.
 */

const NOW = '2026-09-30T00:00:00.000Z';
const ref = (id: number) => ({ npcId: npcId(id), taxiNodeId: null, name: null });
// Doras (Orgrimmar), Devrak (Crossroads) and Tal (Thunder Bluff): dataset flight masters.
const ORGRIMMAR = 3310;
const CROSSROADS = 3615;
const THUNDER_BLUFF = 2995;

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe('the optimiser host and the derived pipeline (TR-12)', () => {
  it('walk a route with flights to the same numbers when the host is given the pipeline’s taxi file', { timeout: 60_000 }, async () => {
    const site = new Map([...publicSite(), ...readDirectory('public/maps/client', 'maps/client/')]);
    const server = fakeServer(site);
    const workspace = await loadWorkspace({ fetch: server.fetch, baseUrl: './', sha256: nodeSha256, nowIso: NOW, yieldToRender: () => Promise.resolve() });
    const ids = sequentialIdSource(9000);
    const steps = [makeFlightStep(ids, { from: ref(ORGRIMMAR), to: ref(CROSSROADS) }), makeFlightStep(ids, { from: ref(CROSSROADS), to: ref(THUNDER_BLUFF) }), makeFlightStep(ids, { from: ref(THUNDER_BLUFF), to: ref(ORGRIMMAR) })];
    const base = workspace.project;
    const project = {
      ...base,
      character: { ...base.character, faction: 'Horde' as const, race: 'Orc' as const, class: 'WARRIOR' as const, knownFlightPaths: [ref(ORGRIMMAR), ref(CROSSROADS), ref(THUNDER_BLUFF)] },
      route: { ...base.route, steps, groups: {} },
    };
    const store = createEditorStore({ project, ids: sequentialIdSource(1000), clock: fixedClock(NOW) });
    const handle = createDerivedStore();
    const resources = { fetch: server.fetch, baseUrl: './', sha256: nodeSha256 };
    const pipeline = createDerivedPipeline({ store, data: workspace.data, geometry: workspace.geometry.geometry, output: handle, navigation: { kind: 'unavailable', reason: 'test' }, clientTables: { resources } });
    await until(() => handle.store.getState().results?.final === true && handle.store.getState().places?.taxi === 'loaded', 'the final walk on the taxi file');
    const pipelineDurations = handle.store.getState().results?.estimates.map((estimate) => estimate.duration) ?? [];
    pipeline.dispose();

    const taxi = await createClientTables(resources).taxi();
    if (taxi.kind !== 'loaded') throw new Error(`taxi file ${taxi.kind}`);
    const walkWith = (table: typeof taxi.table | null) => {
      const host = createOptimizationHost({ project, revision: 0, data: workspace.data, geometry: workspace.geometry.geometry, navigation: { kind: 'unavailable', reason: 'test' }, taxi: table });
      return walkRoute(createRunWalker(host), project, { first: 0, last: steps.length - 1 }, { probe: false }).route.estimates;
    };
    const withTaxi = walkWith(taxi.table);
    expect(withTaxi.map((estimate) => estimate.duration)).toEqual(pipelineDurations);
    expect(withTaxi.every((estimate) => !estimate.assumptionsUsed.includes('taxiDetourFactor'))).toBe(true);
    // Without the file the host prices the same flights by TIME-5, which differs.
    const without = walkWith(null);
    expect(without.every((estimate) => estimate.assumptionsUsed.includes('taxiDetourFactor'))).toBe(true);
    expect(without.map((estimate) => estimate.duration.value)).not.toEqual(pipelineDurations.map((duration) => duration.value));
  });
});
