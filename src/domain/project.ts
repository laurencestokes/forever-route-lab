import type { AssumptionOverrides } from './assumptions';
import type { ClassToken, Faction, RaceToken, Sex } from './character';
import type { QuestRecord, QuestXp } from './dataset';
import type { ProjectId, QuestId } from './ids';
import type { Location } from './points';
import type { Route, TaxiNodeRef } from './route';

/**
 * Native project format, schema version 1 (docs/ARCHITECTURE.md §8.2). Version 1 is UNSTABLE
 * until the end of Milestone 6: fields may change without migrations until then. From Milestone 7
 * every change adds a migration to src/project/migrations.ts.
 */
export const PROJECT_SCHEMA_VERSION = 1 as const;

export type RulesetId = 'forever-beta' | 'era-1.15';

export interface CharacterProfile {
  readonly faction: Faction;
  readonly race: RaceToken;
  readonly class: ClassToken;
  readonly sex: Sex | null;
  readonly startLevel: number;
  readonly startXp: number;
  readonly startLocation: Location | null;
  readonly hearthLocation: Location | null;
  readonly knownFlightPaths: readonly TaxiNodeRef[];
  /**
   * What happened before the route starts. `fresh`: a new character. `listed`: exactly the quests
   * below. `unknown`: a mid-level start without a list, so unmet prerequisites become
   * `-unverifiable` warnings instead of errors.
   */
  readonly priorHistory: 'fresh' | 'listed' | 'unknown';
  readonly priorCompletedQuests: readonly QuestId[];
  readonly priorQuestLog: readonly QuestId[];
  /** Riding trained before the route: 0 none, 1 apprentice, 2 journeyman. */
  readonly riding: 0 | 1 | 2;
  /** Skill id (as a decimal string) to skill value. */
  readonly professions: Readonly<Record<string, number>>;
  /** Faction id (as a decimal string) to starting standing; null means unknown. */
  readonly reputation: Readonly<Record<string, number>> | null;
}

/** RXP load-time variables (RXP.md §8.2, §15.5), also used for our own variant filtering. */
export interface RouteProfile {
  readonly xpRate: number;
  readonly season: number | null;
  readonly phase: number | null;
  readonly hardcore: boolean;
  readonly ssf: boolean;
  readonly dungeons: readonly string[];
  readonly groupQuests: boolean;
  readonly xpStepSkipping: boolean;
  readonly locale: string;
}

/**
 * A quest the dataset lacks (for example new Forever content) or a user replacement for one.
 * Real ids stay positive; invented quests use negative ids.
 */
export type CustomQuest = Omit<QuestRecord, 'provenance' | 'xp'> & {
  readonly xp: QuestXp | null;
  readonly provenance: QuestRecord['provenance'] & { readonly source: 'custom' };
  /** Where the quest is picked up and handed in when the dataset has no entity for it. */
  readonly starterLocation: Location | null;
  readonly finisherLocation: Location | null;
};

/** Per-quest user values layered over the dataset (for example an observed Forever XP value). */
export interface QuestOverride {
  readonly xp: QuestXp | null;
  readonly objectiveCounts: readonly (number | null)[] | null;
  readonly foreverStatus: 'user-declared-new' | 'user-declared-changed' | null;
}

/** An imported RXP guide kept verbatim so unedited guides export byte-identically. */
export interface RxpImport {
  readonly id: string;
  readonly name: string;
  /** SHA-256 hex of the imported text. */
  readonly sourceHash: string;
  readonly text: string;
  readonly options: {
    /** Frame for percent coordinates on the four UiMaps that differ between Era and Forever. */
    readonly changedZoneFrame: 'forever' | 'era';
    /** Present when the text came from a Lua `RegisterGuide(...)` wrapper. */
    readonly lua: { readonly groupArg: string | null; readonly defaultFor: string | null } | null;
  };
}

export interface ProjectV1 {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  readonly game: 'wow-forever';
  /** Data frame build the project was made against, e.g. '1.60.1.69893'. */
  readonly gameBuild: string;
  /** Manifest `dataRevision` of the dataset last loaded with this project. */
  readonly dataRevision: string;
  readonly rulesetId: RulesetId;
  readonly id: ProjectId;
  /** ISO-8601 timestamps, stamped by the app shell (pure code has no clock). */
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly route: Route;
  readonly character: CharacterProfile;
  readonly routeProfile: RouteProfile;
  readonly assumptions: AssumptionOverrides;
  readonly customQuests: readonly CustomQuest[];
  /** Keyed by quest id as a decimal string (JSON object keys are strings). */
  readonly questOverrides: Readonly<Record<string, QuestOverride>>;
  readonly imports: readonly RxpImport[];
  /** Reserved for extensions such as planned-vs-actual telemetry. */
  readonly ext: Readonly<Record<string, unknown>>;
}

export type Project = ProjectV1;

export const questOverrideKey = (id: QuestId): string => String(id);

/**
 * The project's override for quest `id`, or null. Looks at own keys only, so the lookup never
 * returns an Object.prototype member (see routeGroup in route-ops.ts).
 */
export function questOverride(project: Pick<ProjectV1, 'questOverrides'>, id: QuestId): QuestOverride | null {
  const key = questOverrideKey(id);
  if (!Object.hasOwn(project.questOverrides, key)) return null;
  return project.questOverrides[key] ?? null;
}
