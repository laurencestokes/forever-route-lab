import type { EffectiveRules } from '../../rules/precedence';
import type { RuleKey } from '../../rules/ruleset';

/**
 * Ruleset parameters in words (docs/SIMULATION.md §1.2), for the tooltips of assumed numbers:
 * "Depends on assumptions: this step reads seconds per kill (your assumption) …". The keys are the
 * rules module's `RuleKey` type, so a new parameter fails the type check here until it has words.
 */
export const RULE_LABELS: Readonly<Record<RuleKey, string>> = {
  maxLevel: 'level cap',
  xpToNextLevel: 'XP needed per level',
  questXpRounding: 'quest XP rounding',
  questXpMultiplier: 'quest XP multiplier',
  dungeonQuestXpMultiplier: 'dungeon quest XP multiplier',
  maxLevelMoneyEstimate: 'XP turned into money at the level cap',
  killXpRounding: 'kill XP rounding',
  eliteKillXpMultiplier: 'elite kill XP multiplier',
  dungeonEliteKillXpMultiplier: 'dungeon elite kill XP multiplier',
  dungeonMobXpMultiplier: 'dungeon mob XP multiplier',
  mobLevelChoice: 'which level of a mob’s range is used',
  zeroDifference: 'kill XP level-difference table',
  groupXpEnabled: 'group XP',
  groupXpRates: 'group XP rates',
  restedEnabled: 'rested XP',
  greenRange: 'green quest range',
  difficultyYellowLowerBound: 'yellow quest threshold',
  questLogCapacity: 'quest log capacity',
  runSpeed: 'run speed',
  swimSpeed: 'swim speed',
  groundDetourFactor: 'ground detour factor',
  mountLevels: 'riding levels',
  mountSpeedBonus: 'mount speed bonus',
  ridingSpells: 'riding spells',
  hearthCastSeconds: 'hearthstone cast time',
  hearthCooldownSeconds: 'hearthstone cooldown',
  taxiModel: 'flight time model',
  taxiSpeed: 'flight speed',
  taxiDetourFactor: 'flight detour factor',
  taxiSpeedBonusPct: 'flight speed bonus',
  transportWaitSeconds: 'transport wait',
  transportRideSeconds: 'transport ride time',
  acceptSeconds: 'time to accept a quest',
  acceptExtraSeconds: 'time per further quest accepted',
  turninSeconds: 'time to turn in a quest',
  rewardChoiceSeconds: 'time to choose a reward',
  vendorSeconds: 'vendor time',
  repairSeconds: 'repair time',
  trainerSeconds: 'trainer time',
  bindSeconds: 'time to set the hearthstone',
  flightMasterSeconds: 'flight master time',
  lootSeconds: 'loot time',
  objectUseSeconds: 'object use time',
  skinSeconds: 'skinning time',
  killSeconds: 'seconds per kill',
  objectiveKillCount: 'kills per objective',
  objectiveItemCount: 'items per objective',
  itemDropChance: 'item drop chance',
  objectiveUseCount: 'uses per objective',
  objectSearchSeconds: 'object search time',
  eventObjectiveSeconds: 'event objective time',
  objectiveConcurrency: 'objective overlap',
  grindWarnSeconds: 'long grind warning',
  groupSize: 'group size',
  killXpMultiplier: 'kill XP multiplier',
};

/** Where a marked value comes from, in words: the project's assumption, the ruleset's, or an Era stand-in. */
function originWords(rules: EffectiveRules, key: RuleKey): string {
  const value = rules.values[key];
  if (value.basis === 'era-assumed') return 'Era value';
  return value.from === 'project' ? 'your assumption' : 'ruleset assumption';
}

/** One parameter a number read, with where its value comes from in words. */
export interface RuleParameter {
  readonly key: RuleKey;
  /** `seconds per kill`. */
  readonly label: string;
  /** `your assumption`, `ruleset assumption` or `Era value`. */
  readonly origin: string;
}

/** Every parameter in `keys`, in order, each with its origin: the route summary lists them all. */
export function assumptionList(keys: readonly RuleKey[], rules: EffectiveRules): readonly RuleParameter[] {
  return keys.map((key) => ({ key, label: RULE_LABELS[key], origin: originWords(rules, key) }));
}

/** At most this many parameters are named in a tooltip; the rest are counted. */
const NAMED = 4;

/**
 * The parameters a number read, for its assumed marker's tooltip: `seconds per kill (your
 * assumption), run speed (Era value)`, with the rest counted after the first four; null for none.
 * Tooltips only: the route summary lists every parameter (`assumptionList`).
 */
export function assumptionWords(keys: readonly RuleKey[], rules: EffectiveRules): string | null {
  if (keys.length === 0) return null;
  const named = keys.slice(0, NAMED).map((key) => `${RULE_LABELS[key]} (${originWords(rules, key)})`);
  const rest = keys.length - named.length;
  return rest > 0 ? `${named.join(', ')} and ${String(rest)} more` : named.join(', ');
}
