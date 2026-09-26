import type { Estimated } from './estimate';
import type { WorldPoint } from './points';

/**
 * The travel seam shared by the engine, the simulation and the optimiser (ARCHITECTURE §9.1,
 * terrain-navigation.md §9.3; D-028). The engine, simulation and optimiser call one model, so
 * they cannot disagree about a leg. Two models implement it:
 *
 * - `straight-line` (src/rules): distance × `travelDetourFactor` / speed, basis `assumption`;
 * - `navigation` (src/app): legs from the committed navmesh through the nav worker, with the
 *   straight-line value as the labelled fallback.
 *
 * Types only: the pure modules receive a model; they never construct the navigation one.
 */

/**
 * One end of a leg: a world point and the top-level zone AreaTable id that picks its floor in a
 * multi-level place (terrain-navigation.md §8.1 rule A). `zoneHint` 0 means none.
 */
export interface TravelEndpoint {
  readonly point: WorldPoint;
  readonly zoneHint: number;
}

/** Movement speeds for one leg, yards per second, from the ruleset and the riding state. */
export interface TravelSpeeds {
  readonly groundYps: number;
  readonly swimYps: number;
}

/**
 * Why a leg's time is less certain than its basis says. The simulation turns each into a `SIM-`
 * warning (SIMULATION TIME-2; terrain-navigation.md §9.3).
 */
export type TravelWarning =
  /** Same map, but the navigation data has no walking path and no transport joins the two places. */
  | { readonly kind: 'no-walking-path' }
  /** An endpoint has no walkable polygon within 6 yd. */
  | { readonly kind: 'off-navmesh'; readonly end: 'from' | 'to' | 'both' }
  /** The path crosses a passage nobody has walked in game yet (D-034 item 5). */
  | { readonly kind: 'unverified-passage'; readonly passages: readonly string[] }
  /** An endpoint's floor is ambiguous: its containing polygons lie in more than one component. */
  | { readonly kind: 'ambiguous-floor' }
  /** The longest contiguous swim is over 200 yd; fatigue is unverified. */
  | { readonly kind: 'long-swim'; readonly longestSwimYd: number };

/**
 * How a leg's time was obtained.
 *
 * - `navigation`: a navmesh path.
 * - `same-map-transport`: walk, a `TravelGraph` transport, walk.
 * - `straight-line`: the labelled fallback, or the straight-line model itself.
 */
export type TravelMethod = 'navigation' | 'same-map-transport' | 'straight-line';

export interface TravelLeg {
  /** Seconds for the leg; `unknown` only when the endpoints are on different world maps. */
  readonly seconds: Estimated<number>;
  readonly method: TravelMethod;
  /**
   * True when the navigation leg is not computed yet and `seconds` is the fallback. A final
   * state (tests, exports, optimiser input) never has pending legs.
   */
  readonly pending: boolean;
  readonly warnings: readonly TravelWarning[];
}

export interface TravelModel {
  readonly id: 'straight-line' | 'navigation';
  /** The navigation data revision, or `'straight-line'`. Caches key on it. */
  readonly revision: string;
  /**
   * The leg between two points on the same world map. Points on different world maps have no
   * leg: the caller routes through the `TravelGraph` (hearth, transports, instance entrances).
   */
  leg(from: TravelEndpoint, to: TravelEndpoint, speeds: TravelSpeeds): TravelLeg;
  /** The polyline to draw for the leg, or null when unknown (straight-line model, pending, fallback). */
  path(from: TravelEndpoint, to: TravelEndpoint): readonly WorldPoint[] | null;
}
