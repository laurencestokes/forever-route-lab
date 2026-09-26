import { describe, expect, it } from 'vitest';
import { estimate, unknownEstimate } from '../domain/estimate';
import type { TravelEndpoint, TravelSpeeds } from '../domain/travel';
import { navLegEntryOf, navLegRequest, NavigationLegTable, NavigationPathCache, worldPathOf } from './navigation-legs';
import { createNavigationTravelModel, type NavigationTravelModel, type SameMapTransport } from './navigation-model';
import { endpoint, otherComponent, straightLineModel, TEST_NAV_REVISION, testNavManifest, unsnapped, walkable } from './navigation-test-helpers';
import type { NavLegResult } from '../nav/worker/protocol';

/**
 * The `navigation` TravelModel (terrain-navigation.md §9.3): a present leg, pending then filled, a
 * map without navigation data, the cross-component fallback, a same-map transport composition,
 * off-navmesh endpoints, flags as warnings, path(), and keys independent of request order.
 */

const SPEEDS: TravelSpeeds = { groundYps: 7, swimYps: 4.72 };
const FALLBACK = straightLineModel(1.25);
const A = endpoint(1, 100, 200, 14);
const B = endpoint(1, 400, 600, 14);

function setup(transports: readonly SameMapTransport[] = []): { model: NavigationTravelModel; table: NavigationLegTable; fill: (from: TravelEndpoint, to: TravelEndpoint, r: NavLegResult) => void } {
  const table = new NavigationLegTable(TEST_NAV_REVISION);
  const model = createNavigationTravelModel({ manifest: testNavManifest([1]), fallback: FALLBACK, table, paths: new NavigationPathCache(8), transports: (mapId) => transports.filter((t) => t.from.point.mapId === mapId) });
  const fill = (from: TravelEndpoint, to: TravelEndpoint, r: NavLegResult): void => {
    table.set(navLegRequest(TEST_NAV_REVISION, from, to).key, navLegEntryOf(r));
  };
  return { model, table, fill };
}

describe('navigation TravelModel', () => {
  it('times a present leg from the table: ground, swim and connector seconds, basis derived', () => {
    const { model, fill } = setup();
    fill(A, B, walkable(5000, { swimTenths: 944, connectorTenthsSeconds: 125 }));
    expect(model.leg(A, B, SPEEDS)).toEqual({
      seconds: estimate(500 / 7 + 94.4 / 4.72 + 12.5, 'derived'),
      method: 'navigation',
      pending: false,
      warnings: [],
    });
    expect(model.id).toBe('navigation');
    expect(model.revision).toBe(TEST_NAV_REVISION);
  });

  it('gives the fallback, pending, for a leg not computed yet, records it, and the leg once it is filled', () => {
    const { model, table, fill } = setup();
    const first = model.leg(A, B, SPEEDS);
    expect(first).toEqual({ ...FALLBACK.leg(A, B, SPEEDS), pending: true });
    expect(table.takeMissing()).toEqual([navLegRequest(TEST_NAV_REVISION, A, B)]);
    fill(A, B, walkable(3500));
    expect(model.leg(A, B, SPEEDS)).toMatchObject({ seconds: estimate(50, 'derived'), method: 'navigation', pending: false });
  });

  it('gives the permanent fallback on a map without navigation data, and on a map that failed closed', () => {
    const { model, table } = setup();
    const a = endpoint(530, 0, 0);
    const b = endpoint(530, 100, 0);
    expect(model.leg(a, b, SPEEDS)).toEqual(FALLBACK.leg(a, b, SPEEDS));
    expect(model.hasNavigation(530)).toBe(false);
    table.markUnavailable(1, { code: 'integrity', message: 'damaged' });
    expect(model.leg(A, B, SPEEDS)).toEqual(FALLBACK.leg(A, B, SPEEDS));
    expect(table.missingCount).toBe(0);
    expect(model.path(A, B)).toBeNull();
  });

  it('passes legs across world maps to the fallback (no leg: the caller routes through the TravelGraph)', () => {
    const { model, table } = setup();
    const other = endpoint(0, 0, 0);
    expect(model.leg(A, other, SPEEDS)).toEqual({ seconds: unknownEstimate(), method: 'straight-line', pending: false, warnings: [] });
    expect(table.missingCount).toBe(0);
  });

  it('falls back with no-walking-path between components when no transport joins them', () => {
    const { model, fill } = setup();
    fill(A, B, otherComponent());
    expect(model.leg(A, B, SPEEDS)).toEqual({ ...FALLBACK.leg(A, B, SPEEDS), warnings: [{ kind: 'no-walking-path' }] });
    expect(model.path(A, B)).toBeNull();
  });

  it('composes walk, same-map transport, walk: the cheapest, with the transport\'s basis', () => {
    const dockA = endpoint(1, 1000, 1000);
    const dockB = endpoint(1, 3000, 1000);
    const slowDockB = endpoint(1, 3100, 1000);
    const boat: SameMapTransport = { id: 'boat', from: dockA, to: dockB, seconds: estimate(120, 'assumption') };
    const slow: SameMapTransport = { id: 'slow-boat', from: dockA, to: slowDockB, seconds: estimate(400, 'assumption') };
    const unknownBoat: SameMapTransport = { id: 'unknown', from: dockA, to: dockB, seconds: unknownEstimate() };
    const { model, table, fill } = setup([slow, boat, unknownBoat]);
    fill(A, B, otherComponent());
    // the walks are not known yet: pending, and exactly the four dock walks are recorded
    expect(model.leg(A, B, SPEEDS)).toEqual({ ...FALLBACK.leg(A, B, SPEEDS), pending: true });
    expect(new Set(table.takeMissing().map((r) => r.key))).toEqual(new Set([navLegRequest(TEST_NAV_REVISION, A, dockA), navLegRequest(TEST_NAV_REVISION, dockB, B), navLegRequest(TEST_NAV_REVISION, slowDockB, B)].map((r) => r.key)));
    expect(model.legsNeeded(A, B)).toHaveLength(3);
    fill(A, dockA, walkable(700));
    fill(dockB, B, walkable(1400, { flags: ['unverified-passage'], passages: ['undercity-west-tunnel'] }));
    // one walk still missing could make the other transport cheaper: pending, the fallback's seconds
    expect(model.leg(A, B, SPEEDS)).toEqual({ ...FALLBACK.leg(A, B, SPEEDS), pending: true });
    fill(slowDockB, B, walkable(70));
    expect(model.leg(A, B, SPEEDS)).toEqual({
      seconds: estimate(10 + 120 + 20, 'assumption'),
      method: 'same-map-transport',
      pending: false,
      warnings: [{ kind: 'unverified-passage', passages: ['undercity-west-tunnel'] }],
    });
    expect(model.legsNeeded(A, B)).toEqual([]);
    expect(model.path(A, B)).toBeNull();
  });

  it('skips a transport whose dock is off the walking component', () => {
    const dockA = endpoint(1, 1000, 1000);
    const dockB = endpoint(1, 3000, 1000);
    const { model, fill } = setup([{ id: 'boat', from: dockA, to: dockB, seconds: estimate(120, 'derived') }]);
    fill(A, B, otherComponent());
    fill(A, dockA, walkable(700));
    fill(dockB, B, otherComponent());
    expect(model.leg(A, B, SPEEDS).warnings).toEqual([{ kind: 'no-walking-path' }]);
  });

  it('falls back with off-navmesh, naming the end, when an endpoint has no polygon within 6 yd', () => {
    const { model, fill } = setup();
    const C = endpoint(1, 900, 900);
    fill(A, B, unsnapped(true, false));
    fill(B, A, unsnapped(false, true));
    fill(A, C, unsnapped(true, true));
    expect(model.leg(A, B, SPEEDS)).toEqual({ ...FALLBACK.leg(A, B, SPEEDS), warnings: [{ kind: 'off-navmesh', end: 'from' }] });
    expect(model.leg(B, A, SPEEDS).warnings).toEqual([{ kind: 'off-navmesh', end: 'to' }]);
    expect(model.leg(A, C, SPEEDS).warnings).toEqual([{ kind: 'off-navmesh', end: 'both' }]);
  });

  it('turns flags into warnings: unverified passage, ambiguous floor, long swim', () => {
    const { model, fill } = setup();
    fill(A, B, walkable(3000, { swimTenths: 2600, longestSwimYd: 260.25, flags: ['long-swim', 'unverified-passage'], passages: ['undercity-west-tunnel'], from: { snapped: true, ambiguous: true } }));
    expect(model.leg(A, B, SPEEDS).warnings).toEqual([
      { kind: 'unverified-passage', passages: ['undercity-west-tunnel'] },
      { kind: 'ambiguous-floor' },
      { kind: 'long-swim', longestSwimYd: 260.3 },
    ]);
    expect(model.leg(A, B, SPEEDS).seconds.basis).toBe('derived');
  });

  it('returns path() from its LRU, asking for a missing one', () => {
    const { model, fill } = setup();
    expect(model.path(A, B)).toBeNull();
    const [request] = model.paths.takeMissing();
    expect(request?.key).toBe(navLegRequest(TEST_NAV_REVISION, A, B).key);
    model.paths.set(request?.key ?? '', worldPathOf(1, [100, 200, 0, 250, 400, 3, 400, 600, 1]));
    expect(model.path(A, B)).toEqual([
      { mapId: 1, x: 100, y: 200 },
      { mapId: 1, x: 250, y: 400 },
      { mapId: 1, x: 400, y: 600 },
    ]);
    fill(B, A, otherComponent());
    expect(model.path(B, A)).toBeNull();
    expect(model.paths.missingCount).toBe(0);
  });

  it('answers the same whatever order the legs were requested and filled in', () => {
    const points = [A, B, endpoint(1, 50.2, -80.7), endpoint(1, 51, -81, 17), endpoint(1, 700, 20)];
    const pairs = points.flatMap((p) => points.filter((q) => q !== p).map((q) => [p, q] as const));
    const results = new Map(pairs.map(([p, q], i) => [navLegRequest(TEST_NAV_REVISION, p, q).key, walkable(1000 + i * 37)]));
    const run = (order: readonly (readonly [TravelEndpoint, TravelEndpoint])[]): string => {
      const { model, table } = setup();
      for (const [p, q] of order) model.leg(p, q, SPEEDS);
      const missing = table.takeMissing();
      for (const r of [...missing].reverse()) table.set(r.key, navLegEntryOf(results.get(r.key) ?? walkable(0)));
      return JSON.stringify(pairs.map(([p, q]) => model.leg(p, q, SPEEDS)));
    };
    expect(run([...pairs].reverse())).toBe(run(pairs));
  });

  it('refuses a table of another revision', () => {
    expect(() => createNavigationTravelModel({ manifest: testNavManifest(), fallback: FALLBACK, table: new NavigationLegTable('other') })).toThrow(RangeError);
  });
});
