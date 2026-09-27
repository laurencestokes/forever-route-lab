import { describe, expect, it } from 'vitest';
import type { TravelLeg, TravelModel } from '../../domain/travel';
import { EASTERN_KINGDOMS, point } from '../../engine/test-helpers';
import { createStraightLineTravelModel } from '../../rules/straight-line';
import type { Geometry } from './geometry';
import { indexLocations, LocationSet } from './locations';
import { buildMatrix, createMatrixCache, CROSS_MAP, matrixKey, NOT_REQUESTED, pairSignature, tierSpeeds, UNKNOWN_MS } from './matrix';
import { effectiveRules } from '../../rules/precedence';
import { FOREVER_BETA } from '../../rules/ruleset';
import { H_ASSUMPTIONS, hScenario } from './test-helpers';

/** Travel matrices (docs/research/optimizer-m7.md §5.3). */

const rules = hScenario({ quests: [], steps: [], exit: null }).context.rules;

function geometry(pairs: readonly (readonly [number, number])[], tiers: readonly number[] = [0]): Geometry {
  const set = new LocationSet();
  set.add({ point: point(0, 0), zoneHint: 0 });
  set.add({ point: point(300, 400), zoneHint: 0 });
  set.add({ point: point(300, 400), zoneHint: 7 });
  set.add({ point: point(-50, 0), zoneHint: 0 });
  set.add({ point: point(0, 0, EASTERN_KINGDOMS), zoneHint: 0 });
  const locations = indexLocations(set);
  const n = locations.table.count;
  const tierIndex = new Int32Array(3).fill(-1);
  tiers.forEach((t, k) => {
    tierIndex[t] = k;
  });
  return {
    tiers,
    tierIndex,
    locations,
    spawnEntities: [],
    spawnTableOf: new Map(),
    spawnTables: { count: 0, data: new Int32Array(0) },
    opFrom: new Map(),
    tables: new Map(),
    matrixPairs: Int32Array.from(pairs.map(([a, b]) => a * n + b)).sort(),
    pairs: [],
  };
}

describe('buildMatrix', () => {
  // Locations in order: 0 (EK 0,0), 1 (−50,0), 2 (0,0), 3 (300,400), 4 (300,400 hint 7).
  const g = geometry([
    [2, 3],
    [3, 2],
    [1, 2],
  ]);
  const model = createStraightLineTravelModel(1);
  const matrix = buildMatrix(g, model, rules);
  const n = g.locations.table.count;
  const at = (a: number, b: number, tier = 0): number => matrix[(tier * n + a) * n + b] ?? NaN;

  it('holds the quiet model’s leg in integer ms for each requested pair, both directions', () => {
    const speeds = tierSpeeds(0, rules);
    expect(at(2, 3)).toBe(Math.round((500 / speeds.groundYps) * 1000));
    expect(at(3, 2)).toBe(at(2, 3));
    expect(at(1, 2)).toBe(Math.round((50 / speeds.groundYps) * 1000));
  });

  it('marks coinciding points 0, other world maps CROSS_MAP, and every other pair NOT_REQUESTED', () => {
    expect(at(3, 4)).toBe(0);
    expect(at(2, 2)).toBe(0);
    expect(at(0, 2)).toBe(CROSS_MAP);
    expect(at(2, 1)).toBe(NOT_REQUESTED);
  });

  it('uses each tier’s speeds and marks unknown seconds UNKNOWN_MS', () => {
    const tiers = geometry([[2, 3]], [0, 1]);
    const two = buildMatrix(tiers, model, rules);
    const n2 = tiers.locations.table.count;
    expect(two[(1 * n2 + 2) * n2 + 3]).toBe(Math.round((500 / tierSpeeds(1, rules).groundYps) * 1000));
    const unknown: TravelModel = { ...model, leg: (): TravelLeg => ({ seconds: { value: null, basis: 'unknown', eraFallback: false }, method: 'straight-line', pending: false, warnings: [] }) };
    expect(buildMatrix(tiers, unknown, rules)[2 * n2 + 3]).toBe(UNKNOWN_MS);
  });
});

describe('the matrix cache', () => {
  const g = geometry([
    [2, 3],
    [1, 2],
  ]);
  const model = createStraightLineTravelModel(1);
  const key = matrixKey(model, rules, hScenario({ quests: [], steps: [], exit: null }).context.graph, g, '');

  it('finds a matrix by key and exact pair list, and owns its buffers', () => {
    const cache = createMatrixCache();
    const signature = pairSignature(g);
    expect(cache.lookup(key, signature)).toBeNull();
    const matrix = buildMatrix(g, model, rules);
    cache.store(key, signature, matrix);
    matrix.fill(7);
    const hit = cache.lookup(key, signature);
    expect(hit).not.toBeNull();
    expect(hit?.[0]).not.toBe(7);
    expect(cache.lookup(`${key}x`, signature)).toBeNull();
    expect(cache.lookup(key, pairSignature(geometry([[2, 3]])))).toBeNull();
  });

  it('keeps the most recently used entries only', () => {
    const cache = createMatrixCache(2);
    const signature = pairSignature(g);
    const matrix = buildMatrix(g, model, rules);
    cache.store('a', signature, matrix);
    cache.store('b', signature, matrix);
    expect(cache.lookup('a', signature)).not.toBeNull();
    cache.store('c', signature, matrix);
    expect(cache.size()).toBe(2);
    expect(cache.lookup('b', signature)).toBeNull();
    expect(cache.lookup('a', signature)).not.toBeNull();
  });

  it('keys on the model, the speeds, the tiers and the extra key', () => {
    const graph = hScenario({ quests: [], steps: [], exit: null }).context.graph;
    // The straight-line model's revision never changes: the rules' detour factor (which built it) is in the key.
    const detour = effectiveRules(FOREVER_BETA, { ...H_ASSUMPTIONS, travelDetourFactor: 1.25 });
    expect(matrixKey(createStraightLineTravelModel(1.25), detour, graph, g, '')).not.toBe(key);
    const faster = effectiveRules(FOREVER_BETA, { ...H_ASSUMPTIONS, runSpeedYps: 7 });
    expect(matrixKey(model, faster, graph, g, '')).not.toBe(key);
    expect(matrixKey(model, rules, graph, geometry([[2, 3]], [0, 1]), '')).not.toBe(key);
    expect(matrixKey(model, rules, graph, g, 'unavailable:0')).not.toBe(key);
  });
});
