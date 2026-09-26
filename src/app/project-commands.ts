import {
  CLASS_TOKENS,
  type CharacterProfile,
  type ClassToken,
  type CustomQuest,
  type DatasetView,
  type Faction,
  type Location,
  type ProjectV1,
  type QuestId,
  type QuestRecord,
  RACE_FACTION,
  RACE_TOKENS,
  type RaceToken,
  type RouteProfile,
  isInventedQuestId,
  questId,
} from '../domain';
import type { Command } from './commands';
import { stepQuestIds } from './shell-support';

/**
 * Project-level commands (ARCHITECTURE §8.2, §12.2): the character and route profile from the
 * Settings dialog, and custom quests (§5.5). Each is one undo entry; a command that restates the
 * current values changes nothing (no revision, no history entry).
 */

// Character and route profile -------------------------------------------------------------------

/**
 * Playable classes per race in the Forever client, `CLIENT` CharBaseInfo at 1.60.1.69977 (identical
 * at 70009): docs/research/forever-game-rules.md §4. 56 pairs. The Settings dialog offers only
 * these; a project that holds another pair keeps it and is told it is not a playable one.
 */
export const FOREVER_RACE_CLASSES: Readonly<Record<RaceToken, readonly ClassToken[]>> = {
  Human: ['HUNTER', 'MAGE', 'PALADIN', 'PRIEST', 'ROGUE', 'WARLOCK', 'WARRIOR'],
  Dwarf: ['HUNTER', 'PALADIN', 'PRIEST', 'ROGUE', 'SHAMAN', 'WARRIOR'],
  NightElf: ['DRUID', 'HUNTER', 'PRIEST', 'ROGUE', 'WARRIOR'],
  Gnome: ['MAGE', 'PRIEST', 'ROGUE', 'WARLOCK', 'WARRIOR'],
  HighOrderSkyborne: ['DRUID', 'HUNTER', 'MAGE', 'ROGUE', 'WARRIOR'],
  Orc: ['HUNTER', 'MAGE', 'ROGUE', 'SHAMAN', 'WARLOCK', 'WARRIOR'],
  Scourge: ['MAGE', 'PALADIN', 'PRIEST', 'ROGUE', 'WARLOCK', 'WARRIOR'],
  Tauren: ['DRUID', 'HUNTER', 'SHAMAN', 'WARRIOR'],
  Troll: ['HUNTER', 'MAGE', 'PRIEST', 'ROGUE', 'SHAMAN', 'WARLOCK', 'WARRIOR'],
  WindshaperSkyborne: ['DRUID', 'HUNTER', 'ROGUE', 'SHAMAN', 'WARRIOR'],
};

/** The races of a faction, in token order. */
export function racesOf(faction: Faction): readonly RaceToken[] {
  return RACE_TOKENS.filter((race) => RACE_FACTION[race] === faction);
}

/** Whether the Forever client lets `race` be `cls` (FOREVER_RACE_CLASSES). */
export function isPlayablePair(race: RaceToken, cls: ClassToken): boolean {
  return FOREVER_RACE_CLASSES[race].includes(cls);
}

/** The classes of a race in token order (the dialog's list). */
export function classesOf(race: RaceToken): readonly ClassToken[] {
  return CLASS_TOKENS.filter((cls) => FOREVER_RACE_CLASSES[race].includes(cls));
}

/** The level cap the start level is checked against: the project's assumption, else the official 60 (ARCHITECTURE §9.1). */
export const OFFICIAL_MAX_LEVEL = 60;

export function maxLevelOf(project: Pick<ProjectV1, 'assumptions'>): number {
  return project.assumptions.maxLevel ?? OFFICIAL_MAX_LEVEL;
}

const sameList = <T>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((item, i) => Object.is(item, b[i]));

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return sameList(a, b);
  return Object.is(a, b);
}

/** `base` with `patch`, or `base` itself when every patched field equals (arrays element-wise) what it has. */
function merged<T extends object>(base: T, patch: Partial<T>): T {
  const keys = Object.keys(patch) as (keyof T)[];
  const changes = keys.some((key) => patch[key] !== undefined && !sameValue(patch[key], base[key]));
  return changes ? { ...base, ...patch } : base;
}

export interface SettingsPatch {
  readonly character?: Partial<CharacterProfile>;
  readonly routeProfile?: Partial<RouteProfile>;
}

/**
 * The Settings dialog's one command: the character and the route profile together ("Edit
 * settings"), so one undo reverts the whole dialog. Unchanged fields change nothing.
 */
export function updateSettings(patch: SettingsPatch): Command {
  return {
    label: 'Edit settings',
    apply(project) {
      const character = patch.character === undefined ? project.character : merged(project.character, patch.character);
      const routeProfile = patch.routeProfile === undefined ? project.routeProfile : merged(project.routeProfile, patch.routeProfile);
      if (character === project.character && routeProfile === project.routeProfile) return project;
      return { ...project, character, routeProfile };
    },
  };
}

// Custom quests ---------------------------------------------------------------------------------

/**
 * The information-level issue for a custom quest that replaces a dataset quest with its id
 * (ARCHITECTURE §5.5, §9.4). The validation registry arrives in Milestone 6
 * (src/validate/codes.ts); the code is spelled here as ARCHITECTURE §9.4 names it.
 */
export const CUSTOM_SHADOWED_CODE = 'DATA001-custom-shadowed';

/** The id for a new invented quest: one below the lowest id in use, and never above -1 (§5.5). */
export function nextInventedQuestId(project: Pick<ProjectV1, 'customQuests'>): QuestId {
  let lowest = 0;
  for (const quest of project.customQuests) if (quest.id < lowest) lowest = quest.id;
  return questId(Math.min(-1, lowest - 1));
}

export interface CustomQuestFields {
  readonly id: QuestId;
  readonly name: string;
  readonly level: number | null;
  readonly minLevel: number | null;
  /** Base XP entered by the user (basis `user`); null: unknown. Needs a level, which it is taken at. */
  readonly baseXp: number | null;
  readonly foreverStatus: QuestRecord['provenance']['foreverStatus'];
  readonly starterLocation: Location | null;
  readonly finisherLocation: Location | null;
}

const EMPTY_PREREQUISITES: QuestRecord['prerequisites'] = {
  preQuestSingle: [],
  preQuestGroup: [],
  exclusiveTo: [],
  nextQuestInChain: null,
  parentQuest: null,
  childQuests: [],
  inGroupWith: [],
  breadcrumbForQuestId: null,
  breadcrumbs: [],
  availableUntilCompleted: null,
  availableStartingWith: null,
  disabledByQuest: null,
};

const EMPTY_REQUIREMENTS: QuestRecord['requirements'] = {
  skill: null,
  minReputation: null,
  maxReputation: null,
  spell: null,
  specialization: null,
  sourceItemId: null,
  requiredSourceItems: [],
};

/**
 * A custom quest from the editor's fields. `base` is what it starts from: the custom quest being
 * edited, or the dataset quest it replaces (its starters, objectives, prerequisites and the rest are
 * kept), or null for an invented quest, which starts with none of them (any race and class, no
 * objectives listed: unknown, not "none"). The XP basis is always `user`.
 */
export function buildCustomQuest(fields: CustomQuestFields, base: CustomQuest | QuestRecord | null): CustomQuest {
  const xp = fields.baseXp === null || fields.level === null ? null : { questLevel: fields.level, baseXp: fields.baseXp, basis: 'user' as const };
  const common = {
    id: fields.id,
    name: fields.name,
    level: fields.level,
    minLevel: fields.minLevel,
    xp,
    starterLocation: fields.starterLocation,
    finisherLocation: fields.finisherLocation,
  };
  if (base === null) {
    return {
      ...common,
      maxLevel: null,
      races: null,
      classes: null,
      zoneOrSort: null,
      dungeonQuest: false,
      starters: [],
      finishers: [],
      objectives: [],
      objectiveHints: [],
      objectivesText: null,
      prerequisites: EMPTY_PREREQUISITES,
      requirements: EMPTY_REQUIREMENTS,
      reputationReward: [],
      flags: { repeatable: false, needsEvent: false, questFlags: 0, specialFlags: 0 },
      // Not a QuestieDB record, so there is no upstream fact; 'era' claims nothing (foreverProvenanceOf).
      provenance: { upstreamDiff: 'era', foreverStatus: fields.foreverStatus, corrected: false, created: false, source: 'custom' },
    };
  }
  const { provenance } = base;
  return {
    ...common,
    maxLevel: base.maxLevel,
    races: base.races,
    classes: base.classes,
    zoneOrSort: base.zoneOrSort,
    dungeonQuest: base.dungeonQuest,
    starters: base.starters,
    finishers: base.finishers,
    objectives: base.objectives,
    objectiveHints: base.objectiveHints,
    objectivesText: base.objectivesText,
    prerequisites: base.prerequisites,
    requirements: base.requirements,
    reputationReward: base.reputationReward,
    flags: base.flags,
    provenance: { ...provenance, foreverStatus: fields.foreverStatus, source: 'custom' },
  };
}

/** A field of the custom quest editor, for marking the one a problem is about. */
export type CustomQuestField = 'id' | 'name' | 'level' | 'minLevel' | 'xp';

/** Why a field cannot be saved, in words, with the field it is about. */
export interface CustomQuestProblem {
  readonly field: CustomQuestField;
  readonly message: string;
}

/** Why the editor's fields cannot be saved; empty when they can. */
export function customQuestProblems(
  fields: CustomQuestFields,
  project: Pick<ProjectV1, 'customQuests'>,
  editing: QuestId | null,
): readonly CustomQuestProblem[] {
  const problems: CustomQuestProblem[] = [];
  const add = (field: CustomQuestField, message: string) => {
    problems.push({ field, message });
  };
  if (!Number.isSafeInteger(fields.id) || fields.id === 0) add('id', 'The quest id must be a whole number other than 0 (negative for an invented quest).');
  else if (editing !== null && fields.id !== editing) add('id', 'The id of a custom quest cannot change: its steps use it. Create a new custom quest instead.');
  else if (editing === null && project.customQuests.some((quest) => quest.id === fields.id)) {
    add('id', `The project already has a custom quest with id ${String(fields.id)}.`);
  }
  if (fields.name.trim() === '') add('name', 'The quest needs a name.');
  const level = (value: number | null, field: CustomQuestField, what: string) => {
    if (value !== null && !(Number.isInteger(value) && value >= 1)) add(field, `${what} must be a whole number of at least 1, or left empty (unknown).`);
  };
  level(fields.level, 'level', 'The level');
  level(fields.minLevel, 'minLevel', 'The required level');
  if (fields.baseXp !== null) {
    if (!(Number.isFinite(fields.baseXp) && fields.baseXp >= 0)) add('xp', 'The XP must be a number of at least 0, or left empty (unknown).');
    else if (fields.level === null) add('xp', 'Enter the quest level to enter XP: quest XP is taken at the quest level.');
  }
  return problems;
}

/**
 * Adds a custom quest, or replaces the one with id `replacing`. The id is a custom quest's
 * identity, which its steps point at (CR-10): a quest whose id differs from `replacing`, a new
 * quest whose id the project already has, or a `replacing` the project does not have changes
 * nothing (the editor says why before it gets here). A quest equal to the one it replaces changes
 * nothing either.
 */
export function saveCustomQuest(quest: CustomQuest, replacing: QuestId | null = null): Command {
  return {
    label: replacing === null ? 'Add custom quest' : 'Edit custom quest',
    apply(project) {
      const list = project.customQuests;
      if (replacing === null) return list.some((q) => q.id === quest.id) ? project : { ...project, customQuests: [...list, quest] };
      if (quest.id !== replacing) return project;
      const at = list.findIndex((q) => q.id === replacing);
      const current = list[at];
      if (current === undefined || JSON.stringify(current) === JSON.stringify(quest)) return project;
      return { ...project, customQuests: list.map((q, i) => (i === at ? quest : q)) };
    },
  };
}

/** How many steps of the route act on quest `id` (accept, complete, turn in or abandon it). */
export function questStepCount(project: Pick<ProjectV1, 'route'>, id: QuestId): number {
  let count = 0;
  for (const step of project.route.steps) if (stepQuestIds(step).includes(id)) count += 1;
  return count;
}

/** Removes the custom quest `id` (a replaced dataset quest shows its dataset record again). */
export function deleteCustomQuest(id: QuestId): Command {
  return {
    label: 'Delete custom quest',
    apply(project) {
      if (!project.customQuests.some((q) => q.id === id)) return project;
      return { ...project, customQuests: project.customQuests.filter((q) => q.id !== id) };
    },
  };
}

/** Sets a custom quest's starter or finisher location (from a map pick or typed coordinates). */
export function setCustomQuestLocation(id: QuestId, end: 'starter' | 'finisher', location: Location | null): Command {
  const key = end === 'starter' ? 'starterLocation' : 'finisherLocation';
  return {
    label: location === null ? 'Clear custom quest location' : 'Set custom quest location',
    apply(project) {
      const at = project.customQuests.findIndex((q) => q.id === id);
      const current = project.customQuests[at];
      if (current === undefined || current[key] === location) return project;
      return { ...project, customQuests: project.customQuests.map((q, i) => (i === at ? { ...q, [key]: location } : q)) };
    },
  };
}

/**
 * Whether a custom quest replaces a dataset quest (`CUSTOM_SHADOWED_CODE`): a real id the dataset
 * without the project's custom quests has. `base` is that view (`datasetBaseView`).
 */
export function shadowedQuest(base: DatasetView, id: QuestId): QuestRecord | null {
  if (isInventedQuestId(id)) return null;
  const record = base.quest(id);
  return record !== undefined && record.provenance.source !== 'custom' ? record : null;
}
