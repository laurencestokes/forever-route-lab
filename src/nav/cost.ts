/**
 * The search's cost factors (terrain-navigation.md §9.1): a polygon's half of an edge costs its
 * length times the polygon's factor, ground 1 and swim 7 ÷ 4.72 (the era-assumed run and swim
 * speeds, yd/s); a connector's seconds cost yards at the run speed.
 */

/** Swim cost factor: era-assumed run speed ÷ swim speed (7 ÷ 4.72 yd/s). */
export const SWIM_FACTOR = 7 / 4.72;
/** Run speed in yd/s: a connector's seconds become yards of cost at this speed. */
export const CONNECTOR_YD_PER_SECOND = 7;
