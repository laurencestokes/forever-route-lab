import { worldMapId } from '../../domain/ids';
import type { TravelModel } from '../../domain/travel';
import type { EffectiveRules } from '../../rules/precedence';
import { sameMapTransports, type TravelGraph } from '../../rules/travel-graph';
import { initialRiding, travelSpeeds } from '../../sim/travel';
import type { Geometry } from './geometry';
import type { MatrixCache } from './types';

/**
 * Travel matrices (docs/research/optimizer-m7.md §5.3): one Int32 matrix of integer milliseconds
 * per riding tier, over the locations, filled only for the pairs that can be consecutive in some
 * candidate, through the travel model's quiet view. `ms = Math.round(1000 × leg.seconds)`: the
 * navigation model turns the leg table's tenth-yards into seconds with the tier's speeds, and picks
 * same-map transports at those speeds, so the engine and the optimiser agree by construction.
 * Matrices are directed: `ms[a][b]` and `ms[b][a]` are separate legs.
 */

/** The leg's seconds are unknown: usable only where the original walk used it. */
export const UNKNOWN_MS = -1;
/** The points lie on different world maps: a free unit's move is infeasible, never free (TIME-7). */
export const CROSS_MAP = -2;
/** Never requested: a read is a bug. */
export const NOT_REQUESTED = -3;

/** The speeds of riding tier `tier` for `'auto'` travel. */
export function tierSpeeds(tier: number, rules: EffectiveRules): { readonly groundYps: number; readonly swimYps: number } {
  return travelSpeeds('auto', initialRiding(tier === 1 ? 1 : tier === 2 ? 2 : 0, rules), rules).speeds;
}

/**
 * The matrix key's inputs that are not the pairs (§5.3): the model and its revision, the fallback
 * detour factor, the speeds, the tiers, and the same-map transports of every map the locations
 * touch. `extra` is what only the app knows (the leg table's unavailable maps).
 */
export function matrixKey(model: TravelModel, rules: EffectiveRules, graph: TravelGraph, geometry: Geometry, extra: string): string {
  const v = rules.values;
  const maps = [...new Set(Array.from(geometry.locations.table.mapId))].sort((a, b) => a - b);
  const transports: string[] = [];
  for (const map of maps) {
    for (const edge of sameMapTransports(graph, worldMapId(map))) {
      transports.push(
        `${edge.id}@${String(edge.from.point?.x)},${String(edge.from.point?.y)}>${String(edge.to.point?.x)},${String(edge.to.point?.y)}:${String(edge.waitS.value)}+${String(edge.rideS.value)}`,
      );
    }
  }
  return [
    model.id,
    model.revision,
    String(v.groundDetourFactor.value),
    String(v.runSpeed.value),
    String(v.swimSpeed.value),
    v.mountSpeedBonus.value.join(','),
    geometry.tiers.join(','),
    transports.join(';'),
    extra,
  ].join('|');
}

/** The requested pairs as numbers, for the cache's exact comparison: 7 per pair. */
export function pairSignature(geometry: Geometry): Float64Array {
  const n = geometry.locations.table.count;
  const out = new Float64Array(geometry.matrixPairs.length * 7);
  geometry.matrixPairs.forEach((code, k) => {
    const from = geometry.locations.endpoints[Math.floor(code / n)];
    const to = geometry.locations.endpoints[code % n];
    if (from === undefined || to === undefined) return;
    out.set([from.point.mapId, from.point.x, from.point.y, from.zoneHint, to.point.x, to.point.y, to.zoneHint], k * 7);
  });
  return out;
}

/**
 * Builds the matrices: 0 for coinciding points, `CROSS_MAP` across world maps, the quiet model's
 * leg for each requested pair, and `NOT_REQUESTED` elsewhere.
 */
export function buildMatrix(geometry: Geometry, model: TravelModel, rules: EffectiveRules): Int32Array {
  const { table, endpoints } = geometry.locations;
  const n = table.count;
  const tiers = geometry.tiers.length;
  const matrix = new Int32Array(tiers * n * n).fill(NOT_REQUESTED);
  for (let k = 0; k < tiers; k += 1) {
    const base = k * n * n;
    for (let a = 0; a < n; a += 1) {
      for (let b = 0; b < n; b += 1) {
        if ((table.mapId[a] ?? 0) !== (table.mapId[b] ?? 0)) matrix[base + a * n + b] = CROSS_MAP;
        else if ((table.pointId[a] ?? -1) === (table.pointId[b] ?? -2)) matrix[base + a * n + b] = 0;
      }
    }
    const speeds = tierSpeeds(geometry.tiers[k] ?? 0, rules);
    for (const code of geometry.matrixPairs) {
      const from = endpoints[Math.floor(code / n)];
      const to = endpoints[code % n];
      if (from === undefined || to === undefined) continue;
      const seconds = model.leg(from, to, speeds).seconds.value;
      matrix[base + code] = seconds === null ? UNKNOWN_MS : Math.round(seconds * 1000);
    }
  }
  return matrix;
}

interface CacheEntry {
  readonly key: string;
  readonly pairs: Float64Array;
  readonly matrix: Int32Array;
}

const sameSignature = (a: Float64Array, b: Float64Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * A small LRU of matrices (§5.3). It owns its buffers: `lookup` returns the cache's own array, which
 * compile copies before transferring; `store` keeps a copy.
 */
export function createMatrixCache(capacity = 2): MatrixCache {
  const entries: CacheEntry[] = [];
  return {
    capacity,
    size: () => entries.length,
    lookup(key, pairs) {
      const at = entries.findIndex((entry) => entry.key === key && sameSignature(entry.pairs, pairs));
      if (at < 0) return null;
      const [entry] = entries.splice(at, 1);
      if (entry === undefined) return null;
      entries.unshift(entry);
      return entry.matrix;
    },
    store(key, pairs, matrix) {
      const at = entries.findIndex((entry) => entry.key === key && sameSignature(entry.pairs, pairs));
      if (at >= 0) entries.splice(at, 1);
      entries.unshift({ key, pairs: pairs.slice(), matrix: matrix.slice() });
      while (entries.length > Math.max(1, capacity)) entries.pop();
    },
  };
}
