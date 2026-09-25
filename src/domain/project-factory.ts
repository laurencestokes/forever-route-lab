import type { Faction, RaceToken } from './character';
import { type IdSource, projectId, routeId } from './ids';
import { RACE_FACTION } from './masks';
import { type CharacterProfile, PROJECT_SCHEMA_VERSION, type ProjectV1, type RouteProfile } from './project';

export const DEFAULT_GAME_BUILD = '1.60.1.69893';
/** `dataRevision` of a project that has never been opened with a dataset. */
export const NO_DATA_REVISION = 'none';

const DEFAULT_RACE: Readonly<Record<Faction, RaceToken>> = { Horde: 'Orc', Alliance: 'Human' };

/**
 * Route profile defaults from the addon's own defaults (docs/RXP.md §8.2): XP rate 1, content
 * phase 6, XP step skipping on, hardcore off (as RXP forces on Forever). The Forever season is
 * unknown, so `season` is null. Group quests default to off, for a solo route.
 */
export const DEFAULT_ROUTE_PROFILE: RouteProfile = {
  xpRate: 1,
  season: null,
  phase: 6,
  hardcore: false,
  ssf: false,
  dungeons: [],
  groupQuests: false,
  xpStepSkipping: true,
  locale: 'enUS',
};

/**
 * A fresh level-1 character. When only one of race and faction is given, the other follows from
 * it (Horde defaults to Orc, Alliance to Human); both given are kept as given.
 */
export function defaultCharacter(overrides: Partial<CharacterProfile> = {}): CharacterProfile {
  const faction = overrides.faction ?? (overrides.race !== undefined ? RACE_FACTION[overrides.race] : 'Horde');
  return {
    faction,
    race: DEFAULT_RACE[faction],
    class: 'WARRIOR',
    sex: null,
    startLevel: 1,
    startXp: 0,
    startLocation: null,
    hearthLocation: null,
    knownFlightPaths: [],
    priorHistory: 'fresh',
    priorCompletedQuests: [],
    priorQuestLog: [],
    riding: 0,
    professions: {},
    reputation: null,
    ...overrides,
  };
}

export function createEmptyProject(opts: {
  readonly ids: IdSource;
  readonly nowIso: string;
  readonly name: string;
  readonly character?: Partial<CharacterProfile>;
  readonly dataRevision?: string;
  readonly gameBuild?: string;
}): ProjectV1 {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    game: 'wow-forever',
    gameBuild: opts.gameBuild ?? DEFAULT_GAME_BUILD,
    dataRevision: opts.dataRevision ?? NO_DATA_REVISION,
    rulesetId: 'forever-beta',
    id: projectId(opts.ids.next('project')),
    createdAt: opts.nowIso,
    updatedAt: opts.nowIso,
    route: { id: routeId(opts.ids.next('route')), name: opts.name, description: '', steps: [], groups: {} },
    character: defaultCharacter(opts.character),
    routeProfile: { ...DEFAULT_ROUTE_PROFILE, dungeons: [] },
    assumptions: {},
    customQuests: [],
    questOverrides: {},
    imports: [],
    ext: {},
  };
}
