import type { NpcRecord } from '../domain/dataset';

/**
 * The flight-master test the TravelGraph seeds its taxi nodes by, in a file of its own so the
 * modules that only need it (the dataset source's flight-master list, the map's flight masters)
 * do not bring the TravelGraph into the entry chunk (docs/research/ui-refresh.md §10.3): the graph
 * is seeded in the lazy derived pipeline. `travel-graph.ts` re-exports both.
 */

/**
 * QuestieDB's Classic `npcFlags.FLIGHT_MASTER` (8, bit 3; DATA_PROVENANCE §6.3). Tested
 * arithmetically: no bitwise operators (D-012).
 */
export const FLIGHT_MASTER_FLAG = 8;

/** Whether an `npcFlags` value has the FLIGHT_MASTER bit; false for a value that is not a non-negative safe integer. */
export function isFlightMaster(npc: Pick<NpcRecord, 'npcFlags'>): boolean {
  const flags = npc.npcFlags;
  if (!Number.isSafeInteger(flags) || flags < 0) return false;
  return Math.floor(flags / FLIGHT_MASTER_FLAG) % 2 === 1;
}
