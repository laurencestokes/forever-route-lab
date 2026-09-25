import {
  type CharacterProfile,
  createEmptyProject,
  type DatasetView,
  type EntityRef,
  type IdSource,
  type Location,
  makeAcceptStep,
  makeNoteStep,
  makeTurnInStep,
  type ProjectV1,
  type QuestRecord,
  type RouteStep,
  sequentialIdSource,
  type SourcedPoint,
  type UiMapId,
  uiMapId,
} from '../domain';
import { characterName } from './character-names';
import { effectiveQuestLevel, questOpenTo } from './shell-support';

/**
 * The route the app opens with until projects load from storage (Milestone 4): a sample built at
 * runtime from the real dataset, never a recommendation. It takes the quests whose starter spawns
 * on the Durotar map (UiMap 1411: the Valley of Trials, Razor Hill and the rest of Durotar), whose
 * required level is at most 5, which are open to the character by race and class, and which are
 * neither repeatable nor sorted under one of QuestieDB's holiday and recurring-event quest sorts
 * (`HOLIDAY_QUEST_SORTS`). Each gets an accept step at its starter's spawn and a turn-in step at
 * its finisher's, ordered by quest level and then id. Objectives, travel, prerequisites and the
 * quest log are not considered: that is what the simulator and validator (Milestone 6) and the
 * optimiser (Milestone 7) are for.
 */

export const SAMPLE_PROJECT_NAME = 'Sample project';
/** Named for the whole Durotar map it draws from, not only the Valley of Trials (M2 review COORD-8). */
export const SAMPLE_ROUTE_NAME = 'Sample: Durotar start (auto-generated)';
/** Shown wherever the sample route is, so it is never taken for advice. */
export const SAMPLE_ROUTE_NOTICE = 'Sample route (auto-generated, not a recommended route)';
/** `origin.ref` of the sample's steps (source `manual`: StepOrigin has no "generated" source yet). */
export const SAMPLE_ORIGIN_REF = 'sample-route';

const ORIGIN = { source: 'manual', ref: SAMPLE_ORIGIN_REF } as const;

/**
 * Where `HOLIDAY_QUEST_SORTS` is transcribed from: QuestieDB `constants.sortKeys`, the section
 * "Holidays and recurring events", at the pinned commit. The shipped data carries each quest's
 * `zoneOrSort` id but not the names of the sorts, so the set cannot be derived from it; the
 * SHA-256 is the manifest's for this input, and a test fails when a pin bump changes the file.
 */
export const HOLIDAY_QUEST_SORTS_SOURCE = {
  path: 'src/corrections/enum/quests.lua',
  lines: '67-80',
  commit: 'b6f5b07b0acf1c820993cbb0ce2521c912bb4c92',
  sha256: 'eb15f94f58be894772786706bb9c3db56756df1985d7ab93fc180d7567103ede',
} as const;

/**
 * QuestieDB's holiday and recurring-event QuestSort ids (a negative `zoneOrSort`): quests under
 * them run only while an event is on, so the sample leaves them out (M2 review COORD-8, code-F9).
 */
export const HOLIDAY_QUEST_SORTS: ReadonlySet<number> = new Set([
  -404, // WINTER_VEIL
  -402, // HARVEST_FESTIVAL
  -378, // CHILDRENS_WEEK
  -376, // LOVE_IS_IN_THE_AIR
  -375, // PILGRIMS_BOUNTY
  -374, // NOBLEGARDEN
  -370, // BREWFEST
  -369, // MIDSUMMER
  -366, // LUNAR_FESTIVAL
  -364, // DARKMOON_FAIRE
  -41, // DAY_OF_THE_DEAD
  -22, // SEASONAL
  -21, // HALLOWS_END
]);

/** Why the sample leaves a quest out that its region and level would take, or null. */
export function sampleExclusion(quest: Pick<QuestRecord, 'zoneOrSort' | 'flags'>): 'holiday' | 'repeatable' | null {
  if (quest.zoneOrSort !== null && HOLIDAY_QUEST_SORTS.has(quest.zoneOrSort)) return 'holiday';
  return quest.flags.repeatable ? 'repeatable' : null;
}

export interface SampleRouteSpec {
  /** Starters must have a spawn on this UiMap. */
  readonly uiMapId: UiMapId;
  /** Label of the region in texts. */
  readonly region: string;
  /** Quests whose required level is known and at most this. */
  readonly maxRequiredLevel: number;
}

export const DUROTAR_START_SAMPLE: SampleRouteSpec = {
  uiMapId: uiMapId(1411),
  region: 'Durotar (UiMap 1411, including the Valley of Trials)',
  maxRequiredLevel: 5,
};

/** Where a sample step happens: the entity, and its spawn when one is a zone point. */
export interface SampleStop {
  readonly via: EntityRef;
  readonly location: Location | null;
}

export interface SampleQuest {
  readonly quest: QuestRecord;
  readonly accept: SampleStop;
  /** Null when the quest names no finisher. */
  readonly turnIn: SampleStop | null;
}

function entityLabel(dataset: DatasetView, ref: EntityRef): string | null {
  switch (ref.kind) {
    case 'npc':
      return dataset.npc(ref.id)?.name ?? null;
    case 'object':
      return dataset.object(ref.id)?.name ?? null;
    case 'item':
      return dataset.item(ref.id)?.name ?? null;
  }
}

/** The entity's first published zone point on `onMap` (any UiMap when null), as a step location. */
function spawnLocation(dataset: DatasetView, ref: EntityRef, onMap: UiMapId | null): Location | null {
  for (const spawn of dataset.spawns(ref)) {
    const source = spawn.source;
    if (!('space' in source)) continue;
    if (onMap !== null && source.uiMapId !== onMap) continue;
    const point: SourcedPoint = source;
    return { source: point, label: entityLabel(dataset, ref), radius: null };
  }
  return null;
}

/** The first starter (NPC or object) with a spawn on the region's map, or null. */
function regionStarter(dataset: DatasetView, quest: QuestRecord, spec: SampleRouteSpec): SampleStop | null {
  for (const via of quest.starters) {
    if (via.kind === 'item') continue;
    const location = spawnLocation(dataset, via, spec.uiMapId);
    if (location !== null) return { via, location };
  }
  return null;
}

/** The first finisher, at a spawn in the region if it has one, else its first zone point anywhere. */
function finisherStop(dataset: DatasetView, quest: QuestRecord, spec: SampleRouteSpec): SampleStop | null {
  const [first] = quest.finishers;
  if (first === undefined) return null;
  for (const via of quest.finishers) {
    const location = spawnLocation(dataset, via, spec.uiMapId);
    if (location !== null) return { via, location };
  }
  for (const via of quest.finishers) {
    const location = spawnLocation(dataset, via, null);
    if (location !== null) return { via, location };
  }
  return { via: first, location: null };
}

/**
 * The sample's quests, in route order: effective level at the character's start level (unknown
 * last), then id. Quests with an unknown required level, or a race or class mask that cannot be
 * read, are left out rather than guessed in, and so are holiday and repeatable quests
 * (`sampleExclusion`).
 */
export function sampleQuests(
  dataset: DatasetView,
  character: Pick<CharacterProfile, 'race' | 'class' | 'startLevel'>,
  spec: SampleRouteSpec = DUROTAR_START_SAMPLE,
): readonly SampleQuest[] {
  const picked: { readonly entry: SampleQuest; readonly level: number }[] = [];
  for (const quest of dataset.quests()) {
    if (quest.minLevel === null || quest.minLevel > spec.maxRequiredLevel) continue;
    if (sampleExclusion(quest) !== null) continue;
    if (questOpenTo(quest, character) !== true) continue;
    const accept = regionStarter(dataset, quest, spec);
    if (accept === null) continue;
    const level = effectiveQuestLevel(character.startLevel, quest.level, quest.minLevel) ?? Number.POSITIVE_INFINITY;
    picked.push({ entry: { quest, accept, turnIn: finisherStop(dataset, quest, spec) }, level });
  }
  return picked.sort((a, b) => a.level - b.level || a.entry.quest.id - b.entry.quest.id).map((p) => p.entry);
}

/** The sample's explanation, the route's first step. */
export function sampleRouteNote(count: number, character: Pick<CharacterProfile, 'race' | 'class'>, spec: SampleRouteSpec): string {
  return (
    `${SAMPLE_ROUTE_NOTICE}: ${String(count)} quests whose starter spawns in ${spec.region}, with a required level of at most ` +
    `${String(spec.maxRequiredLevel)} and open to the character (${characterName(character)}) by race and class, ordered by quest level and then id. ` +
    "Repeatable quests and quests of QuestieDB's holiday and event categories are left out. " +
    'Each has an accept step at its starter and a turn-in step at its finisher; objectives, travel and prerequisites are not planned.'
  );
}

/** Accept and turn-in steps for the sample quests, after the explanatory note. */
export function sampleSteps(ids: IdSource, quests: readonly SampleQuest[], note: string): RouteStep[] {
  const steps: RouteStep[] = [makeNoteStep(ids, { text: note, origin: ORIGIN })];
  for (const { quest, accept, turnIn } of quests) {
    steps.push(makeAcceptStep(ids, { questId: quest.id, via: accept.via, location: accept.location, origin: ORIGIN }));
    steps.push(makeTurnInStep(ids, { questId: quest.id, via: turnIn?.via ?? null, location: turnIn?.location ?? null, origin: ORIGIN }));
  }
  return steps;
}

export interface SampleProjectOptions {
  readonly dataset: DatasetView;
  readonly nowIso: string;
  /** Defaults to a sequential source, so the sample is the same on every load of one dataset. */
  readonly ids?: IdSource;
  readonly character?: Partial<CharacterProfile>;
  readonly spec?: SampleRouteSpec;
}

/**
 * The sample project: a Horde Orc Warrior at level 1 (the defaults of `createEmptyProject`) with
 * the sample route. The start location stays unknown: the dataset does not say where a new
 * character appears. Deterministic for a given dataset, IdSource and time.
 */
export function createSampleProject(opts: SampleProjectOptions): ProjectV1 {
  const ids = opts.ids ?? sequentialIdSource();
  const spec = opts.spec ?? DUROTAR_START_SAMPLE;
  const identity = opts.dataset.identity;
  const project = createEmptyProject({
    ids,
    nowIso: opts.nowIso,
    name: SAMPLE_ROUTE_NAME,
    dataRevision: identity.dataRevision,
    gameBuild: identity.frameBuild,
    character: { faction: 'Horde', race: 'Orc', class: 'WARRIOR', startLevel: 1, ...opts.character },
  });
  const quests = sampleQuests(opts.dataset, project.character, spec);
  return {
    ...project,
    route: {
      ...project.route,
      description: `${SAMPLE_ROUTE_NOTICE}. Built at load from dataset revision ${identity.dataRevision.slice(0, 12)}.`,
      steps: sampleSteps(ids, quests, sampleRouteNote(quests.length, project.character, spec)),
    },
  };
}
