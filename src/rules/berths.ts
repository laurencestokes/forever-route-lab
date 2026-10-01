import { type WorldMapId, worldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';

/**
 * Client berths and their boarding points (docs/SIMULATION.md TIME-7; D-052 item 1; review TR-03).
 *
 * An inferred dock is the ship's stop in the committed taxi file (`transports[].stops`), which lies
 * in the water beside its pier. The navigation data's snap puts a point there, and a point on the
 * deck above the water, on the water surface (the lowest floor), so a walk to the berth itself
 * ended with a long swim. The rule (D-052 item 1): the walk goes to the dock's
 * **boarding point**, the nearest point within `BOARDING_RADIUS_YD` of the berth whose snap is
 * walkable ground (a polygon that is not water, and not ambiguous between components). The step
 * from the boarding point to the berth has no swim leg; it is priced at each end of the ride as
 * its straight-line yards (`fromBerthYd`, the ride fact's `boardingYd`) at the run speed, as an
 * assumption and a travel part of its own, not part of the wait (`boardingSteps`,
 * src/sim/transport.ts). The real path along the pier is unknown and at least that long.
 *
 * **The radius, from the committed navmesh (nav revision `aefbc78d…`, measured on client
 * 1.60.1.70009; the re-pin to 1.60.1.70124 rebuilt the mesh byte for byte, so the revision and the
 * table are unchanged).** The architect first proposed 40 yd, to be checked against the data. Every boat berth lies 13.1 to 15.1 yd
 * from the nearest walkable polygon, but at those points the snap still takes the water surface
 * under the deck, so no walk can end there. The nearest points a walk can end on walkable ground
 * are 12.5 to 95.2 yd from the nine boat berths (listed below), so 40 yd would leave five of them
 * (Menethil, Southshore, Steamwheedle Port, Powderfuse Port and Rut'theran) with the swim.
 * 100 yd reaches all nine; the largest, Rut'theran's 95.2 yd, is on a part of the pier the
 * navmesh joins to the village only through water (a 72 yd swim from the village's flight
 * master, priced as a swim). The two sky transports' stops (Dalaran, Mulgore) are on walkable
 * ground already (0 yd).
 *
 * The table is data derived from the committed navmesh and taxi file. `tests/berth-boarding.test.ts`
 * searches them again (1 yd steps, nearest first, then x, then y) and fails when the table
 * differs, so a rebuilt navmesh or taxi file (a re-pin, D-050 item 1) cannot leave it stale. An
 * entry applies only while the file's stop is at the berth it records; otherwise the walk goes to
 * the berth as before, and swims.
 */

/** The largest distance from a berth to its boarding point (TIME-7; measured, see above). */
export const BOARDING_RADIUS_YD = 100;

/** The navigation data the table was measured on (`public/nav/manifest.json` `navRevision`). */
export const BOARDING_NAV_REVISION = 'aefbc78d797bb187cef9223b77514946245e768833b75813ac0599151e53f120';

export interface BerthBoarding {
  /** The client transport path (`TaxiPath.ID`) and the index of the stop among its stops in the committed taxi file. */
  readonly pathId: number;
  readonly stop: number;
  /** The berth, as the committed file gives it (whole yards). */
  readonly berth: WorldPoint;
  /** Where the walk to and from the dock ends: the nearest walkable point within the radius; null when there is none. */
  readonly boarding: WorldPoint | null;
  /** Straight-line yards from the berth to the boarding point, one decimal; null without one. */
  readonly fromBerthYd: number | null;
}

const EK: WorldMapId = worldMapId(0);
const KALIMDOR: WorldMapId = worldMapId(1);
const at = (mapId: WorldMapId, x: number, y: number): WorldPoint => ({ mapId, x, y });
const entry = (pathId: number, stop: number, berth: WorldPoint, boarding: WorldPoint, fromBerthYd: number): BerthBoarding => ({ pathId, stop, berth, boarding, fromBerthYd });

/** Every berth the transport seeds cite on a map with navigation data (src/rules/travel-seeds.ts), by path and stop. */
export const BERTH_BOARDINGS: readonly BerthBoarding[] = [
  // Stormwind Harbor – Auberdine ship
  entry(11616, 0, at(KALIMDOR, 6548, 942), at(KALIMDOR, 6534, 908), 36.8),
  entry(11616, 1, at(EK, -8654, 1344), at(EK, -8648, 1333), 12.5),
  // Menethil – Southshore – Auberdine ship
  entry(11167, 0, at(EK, -3709, -575), at(EK, -3757, -641), 81.6),
  entry(11167, 1, at(EK, -1103, -555), at(EK, -1047, -521), 65.5),
  entry(11167, 2, at(KALIMDOR, 6406, 823), at(KALIMDOR, 6421, 818), 15.8),
  // Steamwheedle Port – Powderfuse Port ship
  entry(11391, 0, at(KALIMDOR, -6933, -4951), at(KALIMDOR, -6898, -4904), 58.6),
  entry(11391, 1, at(EK, -8232, -5801), at(EK, -8220, -5760), 42.7),
  // Dalaran – Zephras Isle and Mulgore – Zephras Isle: on walkable ground already
  entry(11398, 0, at(EK, 545, 424), at(EK, 545, 424), 0),
  entry(11457, 0, at(KALIMDOR, -802, 367), at(KALIMDOR, -802, 367), 0),
  // Rut'theran – Auberdine boat
  entry(293, 0, at(KALIMDOR, 8532, 1024), at(KALIMDOR, 8613, 1074), 95.2),
  entry(293, 1, at(KALIMDOR, 6594, 760), at(KALIMDOR, 6578, 762), 16.1),
  // Menethil – Auberdine ship (the same berths as path 11167's)
  entry(295, 0, at(EK, -3709, -575), at(EK, -3757, -641), 81.6),
  entry(295, 1, at(KALIMDOR, 6406, 823), at(KALIMDOR, 6421, 818), 15.8),
];

const samePoint = (a: WorldPoint, b: WorldPoint): boolean => a.mapId === b.mapId && a.x === b.x && a.y === b.y;

/** The boarding of stop `stop` of client path `pathId` while the file's stop is still at `berth`; null otherwise. */
export function berthBoarding(pathId: number, stop: number, berth: WorldPoint): BerthBoarding | null {
  return BERTH_BOARDINGS.find((candidate) => candidate.pathId === pathId && candidate.stop === stop && samePoint(candidate.berth, berth)) ?? null;
}
