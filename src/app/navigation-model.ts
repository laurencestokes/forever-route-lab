import { estimate, unknownEstimate, type EstimateBasis, type Estimated } from '../domain/estimate';
import type { WorldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import type { TravelEndpoint, TravelLeg, TravelModel, TravelSpeeds, TravelWarning } from '../domain/travel';
import type { NavManifest } from '../nav/manifest';
import { hasNavLegFlag, isWalkable, navLegRequest, NavigationPathCache, type NavigationLegTable, type NavLegEntry, type NavLegRequest } from './navigation-legs';

/**
 * The `navigation` travel model (terrain-navigation.md §9.3; ARCHITECTURE §9.1; D-028, D-031,
 * D-034 items 1, 2 and 5): legs from the committed navmesh, read synchronously from the leg table
 * the worker fills, with the injected straight-line model as the labelled fallback.
 *
 * - **Leg present:** `g/10/groundYps + s/10/swimYps + c/10` seconds, basis `derived`, method
 *   `navigation`. The path was chosen with on-foot costs (the rider approximation) and lengths are
 *   horizontal (RC-13): both are assumptions recorded with this model (§9.1). `eraFallback` is
 *   false here; the caller combines the speeds' own provenance (SIMULATION §8).
 * - **Different components of one map:** the injected same-map transports (a boat or zeppelin
 *   with both docks on the map, D-034 item 2) are tried: the walk to the departure dock from the
 *   table, the transport, the walk from the arrival dock; the cheapest wins, method
 *   `same-map-transport`, its basis combined by SIMULATION §8 (a transport time that is an
 *   assumption makes the total one). A walk to or from a client berth (`berths`, TIME-7) prices
 *   its swim at the ground speed and raises no long-swim. Without one: the fallback plus
 *   `no-walking-path`.
 * - **An endpoint with no polygon within 6 yd:** the fallback plus `off-navmesh`.
 * - **A map without navigation data**, or one whose files failed closed: the fallback, for good
 *   (not pending, no warning), as the straight-line model itself would give.
 * - **A leg not computed yet:** the fallback value with `pending` true; the leg is recorded as
 *   missing for the scheduler.
 * - **Flags become warnings:** `unverified-passage` (naming the passages), `ambiguous-floor`,
 *   `long-swim` (over 200 yd, with the run's length).
 * - `path()` returns the funnel polyline from the small path LRU, recording a request when it is
 *   not there, and null for a leg with no walking path, a fallback, or a transport composition.
 *
 * Points on different world maps have no leg (TravelModel contract): those calls go straight to
 * the fallback, which answers them per the same contract.
 */

/** A transport whose two docks lie on one world map (D-034 item 2), from the `TravelGraph`. */
export interface SameMapTransport {
  /** Names the transport; ties between equal totals go to the lower id. */
  readonly id: string;
  /** The departure dock. */
  readonly from: TravelEndpoint;
  /** The arrival dock. */
  readonly to: TravelEndpoint;
  /** Wait plus ride, with the transport's own basis. */
  readonly seconds: Estimated<number>;
  /**
   * Which docks are client berths, the committed taxi file's inferred stops (SIMULATION TIME-7):
   * a walk to or from one prices its swim as the walk along the pier and raises no long-swim.
   * Absent: neither.
   */
  readonly berths?: { readonly from: boolean; readonly to: boolean };
}

/** The directed same-map transport edges of a map (both directions listed separately). */
export type SameMapTransports = (mapId: WorldMapId) => readonly SameMapTransport[];

export interface NavigationTravelModelOptions {
  readonly manifest: NavManifest;
  /** The labelled straight-line model (src/rules). */
  readonly fallback: TravelModel;
  /** The leg table; its revision must be the manifest's navRevision. */
  readonly table: NavigationLegTable;
  readonly paths?: NavigationPathCache;
  readonly transports?: SameMapTransports;
}

/** A directed pair the caller needs a leg for. */
export interface TravelPair {
  readonly from: TravelEndpoint;
  readonly to: TravelEndpoint;
}

export interface NavigationTravelModel extends TravelModel {
  readonly id: 'navigation';
  readonly table: NavigationLegTable;
  readonly paths: NavigationPathCache;
  /** True when legs on the map come from the navmesh (listed in the manifest and not failed). */
  hasNavigation(mapId: number): boolean;
  /**
   * The table entries `leg(from, to)` needs that the table lacks: the direct leg, and, when the
   * direct leg has no walking path, the walks to and from every same-map transport's docks. Empty
   * when the answer is final. Nothing is recorded (the "computing paths" phase uses this).
   */
  legsNeeded(from: TravelEndpoint, to: TravelEndpoint): readonly NavLegRequest[];
}

const positive = (v: number): boolean => Number.isFinite(v) && v > 0;

/** Seconds of a walkable entry at `speeds`, or null when a speed the leg needs is not a positive number. */
function entrySeconds(e: NavLegEntry, speeds: TravelSpeeds): number | null {
  if ((e.g > 0 && !positive(speeds.groundYps)) || (e.s > 0 && !positive(speeds.swimYps))) return null;
  const ground = e.g > 0 ? e.g / 10 / speeds.groundYps : 0;
  const swim = e.s > 0 ? e.s / 10 / speeds.swimYps : 0;
  return ground + swim + e.c / 10;
}

/**
 * The warnings of one or more walkable entries (passages merged, the longest swim kept); the
 * entries in `berthWalks` (walks to or from a client berth, TIME-7) raise no long-swim.
 */
function warningsOf(entries: readonly NavLegEntry[], berthWalks: readonly NavLegEntry[] = []): TravelWarning[] {
  const out: TravelWarning[] = [];
  const passages = [...new Set(entries.flatMap((e) => (hasNavLegFlag(e.flags, 'unverifiedPassage') ? e.passages : [])))];
  if (passages.length > 0) out.push({ kind: 'unverified-passage', passages });
  if (entries.some((e) => hasNavLegFlag(e.flags, 'ambiguousFloor'))) out.push({ kind: 'ambiguous-floor' });
  const swims = entries.filter((e) => hasNavLegFlag(e.flags, 'longSwim') && !berthWalks.includes(e)).map((e) => e.swimRun);
  if (swims.length > 0) out.push({ kind: 'long-swim', longestSwimYd: Math.max(...swims) / 10 });
  return out;
}

/** A client berth's walk (TIME-7): its swim at the ground speed, standing for the walk along the pier. */
const berthSpeeds = (speeds: TravelSpeeds): TravelSpeeds => ({ groundYps: speeds.groundYps, swimYps: speeds.groundYps });

/** The warnings of an entry with no flags: shared, so the common leg allocates none. */
const NO_WARNINGS: readonly TravelWarning[] = [];

/** SIMULATION §8: unknown if any input is; else assumption if any is; else derived (the sum is computed). */
function combinedBasis(bases: readonly EstimateBasis[]): EstimateBasis {
  if (bases.includes('unknown')) return 'unknown';
  return bases.includes('assumption') ? 'assumption' : 'derived';
}

const withWarnings = (leg: TravelLeg, extra: readonly TravelWarning[], pending: boolean): TravelLeg => ({ ...leg, pending, warnings: [...leg.warnings, ...extra] });

export function createNavigationTravelModel(options: NavigationTravelModelOptions): NavigationTravelModel {
  const { manifest, fallback, table } = options;
  if (table.revision !== manifest.navRevision) throw new RangeError(`the leg table is for navRevision ${table.revision}, the manifest is ${manifest.navRevision}`);
  const paths = options.paths ?? new NavigationPathCache();
  const transports: SameMapTransports = options.transports ?? (() => []);
  const revision = manifest.navRevision;
  const mapIds = new Set(manifest.maps.map((m) => m.mapId));

  const hasNavigation = (mapId: number): boolean => mapIds.has(mapId) && table.unavailable(mapId) === null;
  // The request, and so its key string (whose hash the engine then keeps), once per endpoint pair:
  // by point identity, checked against both zone hints. The walker's endpoints come from its place
  // caches, so a leg meets the same point objects walk after walk.
  const requests = new WeakMap<WorldPoint, WeakMap<WorldPoint, { readonly fromHint: number; readonly toHint: number; readonly r: NavLegRequest }>>();
  const request = (from: TravelEndpoint, to: TravelEndpoint): NavLegRequest => {
    let byTo = requests.get(from.point);
    if (byTo === undefined) {
      byTo = new WeakMap();
      requests.set(from.point, byTo);
    }
    const hit = byTo.get(to.point);
    if (hit !== undefined && hit.fromHint === from.zoneHint && hit.toHint === to.zoneHint) return hit.r;
    const r = navLegRequest(revision, from, to);
    byTo.set(to.point, { fromHint: from.zoneHint, toHint: to.zoneHint, r });
    return r;
  };

  const unsnappedEnd = (e: NavLegEntry): 'from' | 'to' | 'both' | null => {
    const a = hasNavLegFlag(e.flags, 'unsnappedFrom');
    const b = hasNavLegFlag(e.flags, 'unsnappedTo');
    return a && b ? 'both' : a ? 'from' : b ? 'to' : null;
  };

  const docksOn = (mapId: WorldMapId): readonly SameMapTransport[] =>
    [...transports(mapId)].filter((t) => t.from.point.mapId === mapId && t.to.point.mapId === mapId).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  /**
   * The cheapest walk-transport-walk composition; `pending` when a walk any transport needs is not
   * in the table yet (it records those); null when no composition exists.
   */
  const viaTransport = (from: TravelEndpoint, to: TravelEndpoint, speeds: TravelSpeeds): TravelLeg | 'pending' | null => {
    let best: { total: number; transport: SameMapTransport; walks: readonly NavLegEntry[]; berthWalks: readonly NavLegEntry[] } | null = null;
    let pending = false;
    for (const t of docksOn(from.point.mapId)) {
      if (t.seconds.value === null || t.seconds.basis === 'unknown') continue;
      const r1 = request(from, t.from);
      const r2 = request(t.to, to);
      const e1 = table.get(r1.key);
      const e2 = table.get(r2.key);
      if (e1 === undefined || e2 === undefined) {
        pending = true;
        if (e1 === undefined) table.recordMissing(r1);
        if (e2 === undefined) table.recordMissing(r2);
        continue;
      }
      if (!isWalkable(e1) || !isWalkable(e2)) continue;
      const fromBerth = t.berths?.from === true;
      const toBerth = t.berths?.to === true;
      const w1 = entrySeconds(e1, fromBerth ? berthSpeeds(speeds) : speeds);
      const w2 = entrySeconds(e2, toBerth ? berthSpeeds(speeds) : speeds);
      if (w1 === null || w2 === null) continue;
      const total = w1 + t.seconds.value + w2;
      const berthWalks = [...(fromBerth ? [e1] : []), ...(toBerth ? [e2] : [])];
      if (best === null || total < best.total) best = { total, transport: t, walks: [e1, e2], berthWalks };
    }
    // A walk still missing could make another transport cheaper: until all are known, the leg is
    // pending and its seconds are the fallback's (the TravelLeg contract).
    if (pending) return 'pending';
    if (best === null) return null;
    const basis = combinedBasis(['derived', best.transport.seconds.basis]);
    return {
      seconds: basis === 'unknown' ? unknownEstimate() : estimate(best.total, basis, best.transport.seconds.eraFallback),
      method: 'same-map-transport',
      pending: false,
      warnings: warningsOf(best.walks, best.berthWalks),
    };
  };

  const model: NavigationTravelModel = {
    id: 'navigation',
    revision,
    table,
    paths,
    hasNavigation,

    leg(from, to, speeds) {
      const mapId = from.point.mapId;
      if (to.point.mapId !== mapId || !hasNavigation(mapId)) return fallback.leg(from, to, speeds);
      const direct = request(from, to);
      const e = table.get(direct.key);
      if (e === undefined) {
        table.recordMissing(direct);
        return withWarnings(fallback.leg(from, to, speeds), [], true);
      }
      if (isWalkable(e)) {
        const seconds = entrySeconds(e, speeds);
        return { seconds: seconds === null ? unknownEstimate() : estimate(seconds, 'derived'), method: 'navigation', pending: false, warnings: e.flags === 0 ? NO_WARNINGS : warningsOf([e]) };
      }
      const end = unsnappedEnd(e);
      if (end !== null) return withWarnings(fallback.leg(from, to, speeds), [{ kind: 'off-navmesh', end }], false);
      const via = viaTransport(from, to, speeds);
      if (via === 'pending') return withWarnings(fallback.leg(from, to, speeds), [], true);
      if (via !== null) return via;
      return withWarnings(fallback.leg(from, to, speeds), [{ kind: 'no-walking-path' }], false);
    },

    path(from, to): readonly WorldPoint[] | null {
      const mapId = from.point.mapId;
      if (to.point.mapId !== mapId || !hasNavigation(mapId)) return null;
      const r = request(from, to);
      const e = table.get(r.key);
      if (e !== undefined && !isWalkable(e)) return null;
      const cached = paths.get(r.key);
      if (cached !== undefined) return cached;
      paths.recordMissing(r);
      return null;
    },

    legsNeeded(from, to) {
      const mapId = from.point.mapId;
      if (to.point.mapId !== mapId || !hasNavigation(mapId)) return [];
      const direct = request(from, to);
      const e = table.get(direct.key);
      if (e === undefined) return [direct];
      if (isWalkable(e) || unsnappedEnd(e) !== null) return [];
      const out = new Map<string, NavLegRequest>();
      for (const t of docksOn(from.point.mapId)) {
        if (t.seconds.value === null || t.seconds.basis === 'unknown') continue;
        for (const r of [request(from, t.from), request(t.to, to)]) if (!table.has(r.key)) out.set(r.key, r);
      }
      return [...out.values()];
    },
  };
  return model;
}
