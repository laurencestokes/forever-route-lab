import type { TravelEndpoint } from '../domain/travel';
import type { StepRecord, TravelPair } from './types';

/**
 * Leg enumeration (terrain-navigation.md §9.4): every leg a walk asked the travel model for, in
 * first-use order without repeats. A walk with the fallback model asks for every leg the final walk
 * needs (consecutive located steps, `leg` waypoints, the TIME-2 spawn positions, hearth
 * destinations, and the walks of every transport it compared), because the navigation data
 * changes only seconds, never which places are visited. So the app can request all legs of a
 * revision after one walk.
 */

const endpointKey = (end: TravelEndpoint): string => `${String(end.point.x)},${String(end.point.y)},${String(end.zoneHint)}`;

/** A directed pair's identity: world map, then both endpoints with their zone hints. */
export function legPairKey(pair: TravelPair): string {
  return `${String(pair.from.point.mapId)}|${endpointKey(pair.from)}|${endpointKey(pair.to)}`;
}

/** The distinct legs the records asked for, in route order. */
export function enumerateLegs(records: readonly StepRecord[]): TravelPair[] {
  const seen = new Set<string>();
  const out: TravelPair[] = [];
  for (const record of records) {
    for (const pair of record.legsAsked) {
      const key = legPairKey(pair);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(pair);
    }
  }
  return out;
}
