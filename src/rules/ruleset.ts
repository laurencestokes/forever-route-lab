import type { RulesetId } from '../domain/project';
import { type SpellId, spellId } from '../domain/ids';
import { DEFAULT_YELLOW_LOWER_BOUND, ERA_GREEN_RANGE, type GreenRangeTable } from './difficulty';
import { ERA_GROUP_XP_RATES, ERA_XP_TO_NEXT_LEVEL, ERA_ZERO_DIFFERENCE, type LevelBand } from './tables';

/**
 * The rulesets `forever-beta` and `era-1.15` (docs/ARCHITECTURE.md §9.1, docs/SIMULATION.md §1.2,
 * D-008). Every parameter is a `RuleValue` that says where it came from. `era-assumed` means "the
 * Forever value is unknown and the Era rule is used"; it appears only in `forever-beta`. The UI marks
 * every number that depends on an `era-assumed` or `assumption` value.
 *
 * Sources are cited by the rule ids of SIMULATION.md and the source ids of
 * docs/research/forever-game-rules.md (S = official, R = reported, C = client data). No value here
 * is new: each is the default SIMULATION §1.2 gives, with its basis.
 */

export type RuleBasis = 'client-data' | 'official' | 'reported' | 'era-assumed' | 'assumption';

export interface RuleValue<T> {
  readonly value: T;
  readonly basis: RuleBasis;
  /** Where the value comes from: rule ids of SIMULATION.md, source ids of forever-game-rules.md. */
  readonly source: string;
  /** Client build a `client-data` value was read from. */
  readonly build?: string;
  readonly note?: string;
}

/** SIMULATION QXP-4. */
export type QuestXpRounding = 'trinity-steps' | 'vmangos-ceil';

/** SIMULATION KXP-4: which level of an NPC's level range stands for its mobs. */
export type MobLevelChoice = 'midpoint-floor' | 'min' | 'max';

/** SIMULATION TIME-5, TIME-6: `auto` uses per-leg path lengths (the committed taxi file) where they cover a journey, `straight-line` never. */
export type TaxiModel = 'auto' | 'straight-line';

/** A riding spell and the riding tier it grants (SIMULATION TIME-3). */
export interface RidingSpell {
  readonly spellId: SpellId;
  readonly tier: 1 | 2;
  readonly name: string;
}

/** The type of every ruleset parameter, by its SIMULATION §1.2 name. */
export interface RuleValueTypes {
  readonly maxLevel: number;
  /** XP-1: index L - 1 holds the XP from level L to L + 1. */
  readonly xpToNextLevel: readonly number[];
  readonly questXpRounding: QuestXpRounding;
  readonly questXpMultiplier: number;
  readonly dungeonQuestXpMultiplier: number;
  readonly maxLevelMoneyEstimate: boolean;
  readonly killXpRounding: 'half-even';
  readonly eliteKillXpMultiplier: number;
  readonly dungeonEliteKillXpMultiplier: number;
  readonly dungeonMobXpMultiplier: number;
  readonly mobLevelChoice: MobLevelChoice;
  readonly zeroDifference: readonly LevelBand[];
  readonly groupXpEnabled: boolean;
  /** KXP-8: index = members - 1, for 1-5 members. */
  readonly groupXpRates: readonly number[];
  readonly restedEnabled: boolean;
  readonly greenRange: GreenRangeTable;
  readonly difficultyYellowLowerBound: number;
  readonly questLogCapacity: number;
  readonly runSpeed: number;
  readonly swimSpeed: number;
  readonly groundDetourFactor: number;
  /** TIME-3: the level each riding tier needs (index tier - 1). */
  readonly mountLevels: readonly number[];
  /** TIME-3: the speed bonus each riding tier gives (index tier - 1). */
  readonly mountSpeedBonus: readonly number[];
  readonly ridingSpells: readonly RidingSpell[];
  readonly hearthCastSeconds: number;
  readonly hearthCooldownSeconds: number;
  readonly taxiModel: TaxiModel;
  readonly taxiSpeed: number;
  readonly taxiDetourFactor: number;
  readonly taxiSpeedBonusPct: number;
  readonly transportWaitSeconds: number;
  readonly transportRideSeconds: number;
  readonly acceptSeconds: number;
  readonly acceptExtraSeconds: number;
  readonly turninSeconds: number;
  readonly rewardChoiceSeconds: number;
  readonly vendorSeconds: number;
  readonly repairSeconds: number;
  readonly trainerSeconds: number;
  readonly bindSeconds: number;
  readonly flightMasterSeconds: number;
  readonly lootSeconds: number;
  readonly objectUseSeconds: number;
  readonly skinSeconds: number;
  readonly killSeconds: number;
  readonly objectiveKillCount: number;
  readonly objectiveItemCount: number;
  readonly itemDropChance: number;
  readonly objectiveUseCount: number;
  readonly objectSearchSeconds: number;
  readonly eventObjectiveSeconds: number;
  readonly objectiveConcurrency: number;
  readonly grindWarnSeconds: number;
  /** No rule uses it yet; read as 1 (SIMULATION §1.2, open question 10.14). */
  readonly groupSize: number;
  /** No rule uses it yet; read as 1.0 (SIMULATION §1.2, open question 10.14). */
  readonly killXpMultiplier: number;
}

export type RuleKey = keyof RuleValueTypes;

export type RulesetValues = { readonly [K in RuleKey]: RuleValue<RuleValueTypes[K]> };

export interface Ruleset {
  readonly id: RulesetId;
  readonly name: string;
  readonly values: RulesetValues;
}

/** Every parameter, in SIMULATION §1.2 order (used to keep lists of keys deterministic). */
export const RULE_KEYS: readonly RuleKey[] = [
  'maxLevel',
  'xpToNextLevel',
  'questXpRounding',
  'questXpMultiplier',
  'dungeonQuestXpMultiplier',
  'maxLevelMoneyEstimate',
  'killXpRounding',
  'eliteKillXpMultiplier',
  'dungeonEliteKillXpMultiplier',
  'dungeonMobXpMultiplier',
  'mobLevelChoice',
  'zeroDifference',
  'groupXpEnabled',
  'groupXpRates',
  'restedEnabled',
  'greenRange',
  'difficultyYellowLowerBound',
  'questLogCapacity',
  'runSpeed',
  'swimSpeed',
  'groundDetourFactor',
  'mountLevels',
  'mountSpeedBonus',
  'ridingSpells',
  'hearthCastSeconds',
  'hearthCooldownSeconds',
  'taxiModel',
  'taxiSpeed',
  'taxiDetourFactor',
  'taxiSpeedBonusPct',
  'transportWaitSeconds',
  'transportRideSeconds',
  'acceptSeconds',
  'acceptExtraSeconds',
  'turninSeconds',
  'rewardChoiceSeconds',
  'vendorSeconds',
  'repairSeconds',
  'trainerSeconds',
  'bindSeconds',
  'flightMasterSeconds',
  'lootSeconds',
  'objectUseSeconds',
  'skinSeconds',
  'killSeconds',
  'objectiveKillCount',
  'objectiveItemCount',
  'itemDropChance',
  'objectiveUseCount',
  'objectSearchSeconds',
  'eventObjectiveSeconds',
  'objectiveConcurrency',
  'grindWarnSeconds',
  'groupSize',
  'killXpMultiplier',
];

const RULE_KEY_INDEX: ReadonlyMap<RuleKey, number> = new Map(RULE_KEYS.map((key, index) => [key, index]));

/** Orders rule keys as RULE_KEYS does (for deterministic `assumptionsUsed` lists). */
export function compareRuleKeys(a: RuleKey, b: RuleKey): number {
  return (RULE_KEY_INDEX.get(a) ?? 0) - (RULE_KEY_INDEX.get(b) ?? 0);
}

const FOREVER_BUILD = '1.60.1.69977';
const FOREVER_UI_BUILD = '1.60.1.70009';
const ERA_BUILD = '1.15.9.69722';

/** Apprentice and Journeyman Riding (forever-game-rules.md §6.1, C4; SIMULATION TIME-3). */
export const FOREVER_RIDING_SPELLS: readonly RidingSpell[] = [
  { spellId: spellId(33388), tier: 1, name: 'Apprentice Riding' },
  { spellId: spellId(33391), tier: 2, name: 'Journeyman Riding' },
];

const assumption = <T>(value: T, source: string, note?: string): RuleValue<T> =>
  note === undefined ? { value, basis: 'assumption', source } : { value, basis: 'assumption', source, note };

/** The values both profiles share: every one is an `assumption` of SIMULATION §1.2 or §6.5. */
const SHARED_ASSUMPTIONS = {
  maxLevelMoneyEstimate: assumption(false, 'SIMULATION QXP-6 (§1.2)', 'the 0.6 x fullXP money estimate is INFERRED; off by default'),
  mobLevelChoice: assumption<MobLevelChoice>('midpoint-floor', 'SIMULATION KXP-4 (§1.2)'),
  groupXpEnabled: assumption(false, 'SIMULATION KXP-8 (§1.2; review F23)', 'v1 simulates solo play'),
  restedEnabled: assumption(false, 'SIMULATION KXP-9 (§1.2)'),
  groundDetourFactor: assumption(1.25, 'SIMULATION TIME-2, §6.1 (§1.2)', 'straight-line model and the labelled navigation fallback'),
  taxiModel: assumption<TaxiModel>('auto', 'SIMULATION TIME-5, TIME-6 (§1.2)'),
  taxiDetourFactor: assumption(
    1.4,
    'SIMULATION TIME-5: rounded median of L3D / straight line over 286 direct TaxiPath legs, TaxiPath/TaxiPathNode/TaxiNodes 1.60.1.69977 (D-022, D-024)',
    'a cited aggregate client statistic; applying one factor to every straight line is a modelling choice',
  ),
  taxiSpeedBonusPct: assumption(0, 'SIMULATION TIME-5 (§1.2)', 'Legacy "Frequent Flier" would be 20 (forever-game-rules.md §6.4, C7)'),
  transportWaitSeconds: assumption(60, 'SIMULATION TIME-7 (§1.2)', 'half of an UNKNOWN cycle'),
  transportRideSeconds: assumption(60, 'SIMULATION TIME-7 (§1.2)'),
  acceptSeconds: assumption(3, 'SIMULATION TIME-8, §6.5'),
  acceptExtraSeconds: assumption(2, 'SIMULATION TIME-8, §6.5'),
  turninSeconds: assumption(3, 'SIMULATION TIME-8, §6.5'),
  rewardChoiceSeconds: assumption(2, 'SIMULATION TIME-8, §6.5'),
  vendorSeconds: assumption(10, 'SIMULATION TIME-8, §6.5'),
  repairSeconds: assumption(5, 'SIMULATION TIME-8, §6.5'),
  trainerSeconds: assumption(10, 'SIMULATION TIME-8, §6.5'),
  bindSeconds: assumption(5, 'SIMULATION TIME-4, §6.2'),
  flightMasterSeconds: assumption(3, 'SIMULATION TIME-5, §6.5'),
  lootSeconds: assumption(2, 'SIMULATION TIME-8, TIME-9, §6.5'),
  killSeconds: assumption(30, 'SIMULATION TIME-9, TIME-12, §6.5', 'class, gear and zone dependent; calibrate per class'),
  objectiveKillCount: assumption(8, 'SIMULATION TIME-9 (§1.2)', 'unmeasured placeholder (open question 10.13)'),
  objectiveItemCount: assumption(5, 'SIMULATION TIME-9 (§1.2)', 'unmeasured placeholder (open question 10.13)'),
  itemDropChance: assumption(0.5, 'SIMULATION TIME-9 (§1.2)', 'unmeasured placeholder (open question 10.13)'),
  objectiveUseCount: assumption(6, 'SIMULATION TIME-9 (§1.2)', 'unmeasured placeholder (open question 10.13)'),
  objectSearchSeconds: assumption(15, 'SIMULATION TIME-9 (§1.2)', 'unmeasured placeholder (open question 10.13)'),
  eventObjectiveSeconds: assumption(20, 'SIMULATION TIME-9 (§1.2)', 'unmeasured placeholder (open question 10.13)'),
  objectiveConcurrency: assumption(0.5, 'SIMULATION TIME-10 (§1.2)', '0 = full overlap, 1 = none'),
  grindWarnSeconds: assumption(600, 'SIMULATION SIM-11, TIME-12 (§1.2)'),
  groupSize: assumption(1, 'SIMULATION §1.2, open question 10.14', 'no rule uses this value yet'),
  killXpMultiplier: assumption(1.0, 'SIMULATION §1.2, open question 10.14', 'no rule uses this value yet'),
} as const satisfies Partial<RulesetValues>;

/** `forever-beta`: Forever where it is known, the Era rule (`era-assumed`) where it is not. */
export const FOREVER_BETA: Ruleset = {
  id: 'forever-beta',
  name: 'WoW Forever (beta)',
  values: {
    ...SHARED_ASSUMPTIONS,
    maxLevel: {
      value: 60,
      basis: 'official',
      source: 'SIMULATION XP-3; forever-game-rules.md §3 (S1, S2)',
      note: 'the beta caps were 20, then 30 (B1): override maxLevel to simulate them',
    },
    xpToNextLevel: {
      value: ERA_XP_TO_NEXT_LEVEL,
      basis: 'era-assumed',
      source: 'SIMULATION XP-1 (cmangos-classic player_xp_for_level [E3], warcraft.wiki.gg [W1], formula)',
      note: 'the server owns the curve; reported unchanged for Forever (forever-game-rules.md §3, R6)',
    },
    questXpRounding: {
      value: 'trinity-steps',
      basis: 'era-assumed',
      source: 'SIMULATION QXP-4 (TrinityCore RoundXPValue [E4]; Questie QuestieXP.lua [Q1])',
      note: 'CONFLICT: the alternative is vmangos-ceil',
    },
    questXpMultiplier: assumption(1.0, 'SIMULATION QXP-3, QXP-5 (§1.2)', 'reports suggest about 2x (forever-game-rules.md §3, R5, R6, R10)'),
    dungeonQuestXpMultiplier: assumption(1.0, 'SIMULATION QXP-3, QXP-5 (§1.2)', 'reports suggest much higher (forever-game-rules.md §3, R5, R6)'),
    killXpRounding: { value: 'half-even', basis: 'era-assumed', source: 'SIMULATION KXP-6 (vmangos, cmangos std::nearbyint in float32)' },
    eliteKillXpMultiplier: { value: 2.0, basis: 'era-assumed', source: 'SIMULATION KXP-5 (vmangos, cmangos, warcraft.wiki.gg [W2])' },
    dungeonEliteKillXpMultiplier: {
      value: 2.5,
      basis: 'era-assumed',
      source: 'SIMULATION KXP-5 (vmangos, cmangos IsNonRaidDungeon)',
      note: 'emulator-only; not in the wiki; UNVERIFIED against Blizzard Era',
    },
    dungeonMobXpMultiplier: assumption(1.0, 'SIMULATION KXP-5 (§1.2)', 'reportedly much lower (forever-game-rules.md §3, R5, R6)'),
    zeroDifference: { value: ERA_ZERO_DIFFERENCE, basis: 'era-assumed', source: 'SIMULATION KXP-2 (vmangos, cmangos, warcraft.wiki.gg [W2])' },
    groupXpRates: {
      value: ERA_GROUP_XP_RATES,
      basis: 'era-assumed',
      source: 'SIMULATION KXP-8 (vmangos Group.cpp, cmangos Formulas.h:390-408)',
      note: 'the emulators call the rates guesswork',
    },
    greenRange: {
      value: ERA_GREEN_RANGE,
      basis: 'era-assumed',
      source: 'SIMULATION COL-2, COL-4 (cmangos-classic GetQuestGreenRange)',
      note: 'CONFLICT at levels 5-9 (4 or 5); the Forever range is UNKNOWN',
    },
    difficultyYellowLowerBound: {
      value: DEFAULT_YELLOW_LOWER_BOUND,
      basis: 'era-assumed',
      source: 'SIMULATION COL-1, COL-4',
      note: 'the Forever Lua fallback (Mainline/DifficultyUtil.lua) uses -4',
    },
    questLogCapacity: {
      value: 40,
      basis: 'client-data',
      source:
        'SIMULATION VAL-20: QuestLogConstsMainlineCamelot.MAXIMUM_NUM_QUESTS_LOG_CAN_ACCEPT (QuestConstantsDocumentation.lua:145-150, Camelot/QuestMapFrameUtils.lua:18-21); forever-game-rules.md §7 (R9)',
      build: FOREVER_UI_BUILD,
      note: 'the client constant; what the server enforces at launch is unknown (U13)',
    },
    runSpeed: { value: 7.0, basis: 'era-assumed', source: 'SIMULATION TIME-1, §6.1 (vmangos Unit.cpp:67-75, cmangos Unit.cpp:63-71)' },
    swimSpeed: {
      value: 4.722,
      basis: 'era-assumed',
      source: 'SIMULATION §6.1 (vmangos Unit.cpp:67-75, cmangos Unit.cpp:63-71); terrain-navigation.md §9.1',
      note: 'navigation legs only (TravelSpeeds.swimYps)',
    },
    mountLevels: {
      value: [40, 60],
      basis: 'client-data',
      source: 'SIMULATION §6.1, TIME-3: ItemSparse RequiredLevel (items 5656 and 18776); forever-game-rules.md §6.1 (C4)',
      build: FOREVER_BUILD,
      note: 'riding training level and cost are UNKNOWN (U6)',
    },
    mountSpeedBonus: {
      value: [0.6, 1.0],
      basis: 'client-data',
      source: 'SIMULATION §6.1, TIME-3: SpellEffect of spells 86457 (+60%) and 86458 (+100%); forever-game-rules.md §6.1 (C4)',
      build: FOREVER_BUILD,
      note: 'which riding tier grants which speed spell is server-side (INFERRED)',
    },
    ridingSpells: {
      value: FOREVER_RIDING_SPELLS,
      basis: 'client-data',
      source: 'SIMULATION TIME-3: SpellName and SkillLineAbility rows 17539 and 15030 (forever-game-rules.md §6.1, C4)',
      build: FOREVER_BUILD,
      note: 'the tier-to-speed mapping is INFERRED',
    },
    hearthCastSeconds: {
      value: 10,
      basis: 'client-data',
      source: 'SIMULATION §6.2: spell 8690 SpellMisc.CastingTimeIndex 7, SpellCastTimes 7 = 10,000 ms',
      build: FOREVER_BUILD,
    },
    hearthCooldownSeconds: {
      value: 3600,
      basis: 'client-data',
      source: 'SIMULATION §6.2: SpellCooldowns spell 8690 CategoryRecoveryTime 3,600,000 ms (forever-game-rules.md §6.3, C5)',
      build: FOREVER_BUILD,
      note: 'a server override is UNKNOWN',
    },
    taxiSpeed: {
      value: 32,
      basis: 'era-assumed',
      source: 'SIMULATION §6.3 Model A: vmangos PLAYER_FLIGHT_SPEED, cmangos TAXI_FLIGHT_SPEED (D-024)',
      note: 'Forever flight speed is server-side (UNKNOWN)',
    },
    objectUseSeconds: {
      value: 5,
      basis: 'client-data',
      source: 'SIMULATION §6.5: spell 3365 "Opening", SpellMisc CastingTimeIndex 6, SpellCastTimes 6 = 5,000 ms',
      build: FOREVER_BUILD,
      note: 'some objects are instant',
    },
    skinSeconds: {
      value: 2,
      basis: 'client-data',
      source: 'SIMULATION §6.5: spell 8613 "Skinning", SpellMisc CastingTimeIndex 5, SpellCastTimes 5 = 2,000 ms',
      build: FOREVER_BUILD,
    },
  },
};

/** `era-1.15`: Classic Era 1.15.9 for comparison; emulator and wiki rules are `reported`. */
export const ERA_1_15: Ruleset = {
  id: 'era-1.15',
  name: 'Classic Era 1.15',
  values: {
    ...SHARED_ASSUMPTIONS,
    maxLevel: { value: 60, basis: 'official', source: 'SIMULATION XP-3 (Questie QuestiePlayer.IsMaxLevel [Q1])' },
    xpToNextLevel: {
      value: ERA_XP_TO_NEXT_LEVEL,
      basis: 'reported',
      source: 'SIMULATION XP-1 (cmangos-classic player_xp_for_level [E3], warcraft.wiki.gg [W1], formula)',
    },
    questXpRounding: {
      value: 'trinity-steps',
      basis: 'reported',
      source: 'SIMULATION QXP-4 (TrinityCore RoundXPValue [E4]; Questie QuestieXP.lua [Q1])',
      note: 'CONFLICT: the alternative is vmangos-ceil',
    },
    questXpMultiplier: { value: 1.0, basis: 'reported', source: 'SIMULATION QXP-3 (§1.2)', note: 'the seed is Era quest XP' },
    dungeonQuestXpMultiplier: { value: 1.0, basis: 'reported', source: 'SIMULATION QXP-3 (§1.2)', note: 'the seed is Era quest XP' },
    killXpRounding: { value: 'half-even', basis: 'reported', source: 'SIMULATION KXP-6 (vmangos, cmangos std::nearbyint in float32)' },
    eliteKillXpMultiplier: { value: 2.0, basis: 'reported', source: 'SIMULATION KXP-5 (vmangos, cmangos, warcraft.wiki.gg [W2])' },
    dungeonEliteKillXpMultiplier: {
      value: 2.5,
      basis: 'reported',
      source: 'SIMULATION KXP-5 (vmangos, cmangos IsNonRaidDungeon)',
      note: 'emulator-only; not in the wiki; UNVERIFIED against Blizzard Era',
    },
    dungeonMobXpMultiplier: { value: 1.0, basis: 'reported', source: 'SIMULATION KXP-5 (§1.2)' },
    zeroDifference: { value: ERA_ZERO_DIFFERENCE, basis: 'reported', source: 'SIMULATION KXP-2 (vmangos, cmangos, warcraft.wiki.gg [W2])' },
    groupXpRates: {
      value: ERA_GROUP_XP_RATES,
      basis: 'reported',
      source: 'SIMULATION KXP-8 (vmangos Group.cpp, cmangos Formulas.h:390-408)',
      note: 'the emulators call the rates guesswork',
    },
    greenRange: {
      value: ERA_GREEN_RANGE,
      basis: 'reported',
      source: 'SIMULATION COL-2 (cmangos-classic GetQuestGreenRange)',
      note: 'CONFLICT at levels 5-9 (4 or 5)',
    },
    difficultyYellowLowerBound: {
      value: DEFAULT_YELLOW_LOWER_BOUND,
      basis: 'client-data',
      source: 'SIMULATION COL-1 (Vanilla/UIParent.lua:1397-1424)',
      build: ERA_BUILD,
    },
    questLogCapacity: {
      value: 20,
      basis: 'client-data',
      source: 'SIMULATION VAL-20 (Vanilla/Constants.lua:86-88 MAX_QUESTS = 20)',
      build: ERA_BUILD,
    },
    runSpeed: { value: 7.0, basis: 'reported', source: 'SIMULATION TIME-1, §6.1 (vmangos Unit.cpp:67-75, cmangos Unit.cpp:63-71)' },
    swimSpeed: {
      value: 4.722,
      basis: 'reported',
      source: 'SIMULATION §6.1 (vmangos Unit.cpp:67-75, cmangos Unit.cpp:63-71); terrain-navigation.md §9.1',
      note: 'navigation legs only (TravelSpeeds.swimYps)',
    },
    mountLevels: {
      value: [40, 60],
      basis: 'client-data',
      source: 'SIMULATION §6.1: ItemSparse RequiredLevel (items 5656, 2411 and 18776)',
      build: ERA_BUILD,
    },
    mountSpeedBonus: {
      value: [0.6, 1.0],
      basis: 'client-data',
      source: 'SIMULATION §6.1: aura 32 base 59 and 99 on the mount spells (e.g. 458, 23229)',
      build: ERA_BUILD,
    },
    ridingSpells: {
      value: [],
      basis: 'client-data',
      source: 'SIMULATION §1.2, TIME-3: neither riding spell exists in Era',
      build: ERA_BUILD,
      note: "Era riding is recognised by skill: 'riding' only",
    },
    hearthCastSeconds: {
      value: 10,
      basis: 'client-data',
      source: 'SIMULATION §6.2: spell 8690 SpellMisc.CastingTimeIndex 7, SpellCastTimes 7 = 10,000 ms',
      build: ERA_BUILD,
    },
    hearthCooldownSeconds: {
      value: 3600,
      basis: 'client-data',
      source: 'SIMULATION §6.2: SpellCooldowns spell 8690 CategoryRecoveryTime 3,600,000 ms',
      build: ERA_BUILD,
    },
    taxiSpeed: { value: 32, basis: 'reported', source: 'SIMULATION §6.3 Model A: vmangos PLAYER_FLIGHT_SPEED, cmangos TAXI_FLIGHT_SPEED' },
    objectUseSeconds: {
      value: 5,
      basis: 'client-data',
      source: 'SIMULATION §6.5: spell 3365 "Opening", SpellMisc CastingTimeIndex 6, SpellCastTimes 6 = 5,000 ms',
      build: ERA_BUILD,
      note: 'some objects are instant',
    },
    skinSeconds: {
      value: 2,
      basis: 'client-data',
      source: 'SIMULATION §6.5: spell 8613 "Skinning", SpellMisc CastingTimeIndex 5, SpellCastTimes 5 = 2,000 ms',
      build: ERA_BUILD,
    },
  },
};

export const RULESETS: Readonly<Record<RulesetId, Ruleset>> = {
  'forever-beta': FOREVER_BETA,
  'era-1.15': ERA_1_15,
};

export function rulesetById(id: RulesetId): Ruleset {
  return RULESETS[id];
}
