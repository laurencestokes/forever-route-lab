/**
 * User-configurable assumptions (docs/ARCHITECTURE.md §9.1). A project stores only the values the
 * user has overridden; everything else comes from the active ruleset, and each effective value
 * carries the provenance of whichever supplied it.
 */
export interface AssumptionValues {
  /** Party size, 1-5. Scales kill time; group XP rates apply only when `groupXp` is on. */
  readonly groupSize: number;
  readonly groupXp: boolean;
  /** Level cap to simulate (beta caps can be lower than 60). */
  readonly maxLevel: number;
  readonly questLogCapacity: number;
  readonly runSpeedYps: number;
  /** Multiplier on straight-line distance for walking and riding legs. */
  readonly travelDetourFactor: number;
  readonly taxiSpeedYps: number;
  readonly taxiDetourFactor: number;
  readonly transportWaitSeconds: number;
  readonly transportRideSeconds: number;
  /** Talking to an NPC or object to accept or turn in. */
  readonly interactionSeconds: number;
  readonly lootSeconds: number;
  readonly secondsPerKill: number;
  /** QuestieDB has no objective counts; this stands in for them. */
  readonly killsPerObjective: number;
  readonly secondsPerObjective: number;
  /** 0..1: how much concurrent objectives in one step overlap. */
  readonly objectiveConcurrency: number;
  /** Applied only to `era-seed` quest XP, never to user-entered values. */
  readonly questXpMultiplier: number;
  readonly dungeonQuestXpMultiplier: number;
  readonly killXpMultiplier: number;
}

export type AssumptionKey = keyof AssumptionValues;

export type AssumptionOverrides = Partial<AssumptionValues>;
