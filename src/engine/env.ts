import type { StepCondition, Truth } from '../domain/conditions';
import type { Estimated } from '../domain/estimate';
import type { QuestId } from '../domain/ids';
import type { CustomQuest } from '../domain/project';
import type { TravelModel } from '../domain/travel';
import type { EffectiveRules } from '../rules/precedence';
import type { RuleKey } from '../rules/ruleset';
import type { TaxiNodeKey, TravelGraph } from '../rules/travel-graph';
import type { TimePart } from '../sim/estimate';
import type { SimFact } from '../sim/facts';
import type { Basis } from '../sim/provenance';
import type { XpCurve } from '../sim/xp';
import { type ConditionSubject, evaluateStaticCondition, type PredicateContext } from './conditions';
import type { Places } from './places';
import type { SimCache } from './sim-cache';
import type { AcceptPolicy, EngineContext, EngineDataset, LegUse, ObjectiveMark, TravelPair, WalkProject } from './types';

/**
 * The walk environment: the context and project inputs every step reads, built once per project
 * inputs, and the per-step work accumulator.
 */

/** Collects the legs the travel model is asked for while a step runs (leg enumeration). */
export interface LegRecorder {
  /** Null until the running step asks for its first leg. */
  current: TravelPair[] | null;
}

/**
 * What the level after an XP grant reads besides the grant (XP-1..3, SIMULATION §8): the XP table
 * always, and the cap when it bounded the grant. Their provenance joins the level's, and their
 * marked keys (`assumption` or `era-assumed`) the step's `assumptionsUsed`.
 */
export interface LevelInputs {
  readonly table: Basis;
  readonly tableKeys: readonly RuleKey[];
  readonly cap: Basis;
  readonly capKeys: readonly RuleKey[];
}

export interface WalkEnv {
  readonly context: EngineContext;
  readonly dataset: EngineDataset;
  readonly rules: EffectiveRules;
  readonly curve: XpCurve;
  readonly levelInputs: LevelInputs;
  readonly graph: TravelGraph;
  readonly places: Places;
  /** The context's travel model, recording every leg it is asked for into `recorder`. */
  readonly model: TravelModel;
  readonly recorder: LegRecorder;
  /** Memoised `src/sim` calls (the rules and dataset are fixed for a walker). */
  readonly sim: SimCache;
  readonly acceptPolicy: AcceptPolicy;
  readonly project: WalkProject;
  readonly subject: ConditionSubject;
  readonly predicates: PredicateContext;
  readonly customQuests: ReadonlyMap<QuestId, CustomQuest>;
  /** Filter and variant truth of a condition (independent of the walk, so cached). */
  staticTruth(condition: StepCondition | null): Truth;
}

/** A travel model that records each `leg` request before answering it. */
export function recordingModel(model: TravelModel, recorder: LegRecorder): TravelModel {
  return {
    id: model.id,
    revision: model.revision,
    leg(from, to, speeds) {
      (recorder.current ??= []).push({ from, to });
      return model.leg(from, to, speeds);
    },
    path: (from, to) => model.path(from, to),
  };
}

export function createWalkEnv(
  base: Omit<WalkEnv, 'project' | 'subject' | 'predicates' | 'customQuests' | 'staticTruth'>,
  project: WalkProject,
): WalkEnv {
  const subject: ConditionSubject = { character: project.character, routeProfile: project.routeProfile };
  const cache = new WeakMap<StepCondition, Truth>();
  const customQuests = new Map<QuestId, CustomQuest>();
  for (const quest of project.customQuests) customQuests.set(quest.id, quest);
  return {
    ...base,
    project,
    subject,
    predicates: { priorHistory: project.character.priorHistory, xpStepSkipping: project.routeProfile.xpStepSkipping, acceptPolicy: base.acceptPolicy },
    customQuests,
    staticTruth(condition) {
      if (condition === null) return 'true';
      let truth = cache.get(condition);
      if (truth === undefined) {
        truth = evaluateStaticCondition(condition, subject);
        cache.set(condition, truth);
      }
      return truth;
    },
  };
}

/** What one step accumulates while it runs. */
export interface StepWork {
  readonly parts: TimePart[];
  readonly used: (readonly RuleKey[])[];
  readonly facts: SimFact[];
  readonly legs: LegUse[];
  unresolvedReported: boolean;
  /** Whether `position-unknown` was recorded (once per step). */
  positionReported: boolean;
  /** A bound `hearth use` cast: the route clock since the cast starts again (TIME-4). */
  hearthCast: boolean;
  questId: QuestId | null;
  accepted: QuestId | null;
  turnedIn: QuestId | null;
  abandoned: QuestId | null;
  assumedInLog: QuestId[] | null;
  objectivesDone: ObjectiveMark[] | null;
  flightPathsLearned: TaxiNodeKey[] | null;
  spellsLearned: number[] | null;
  skillsLearned: number[] | null;
  hearthChanged: boolean;
  ridingChanged: boolean;
  unknownXpReset: boolean;
  /** The step's XP (quest or kill XP, or a grind's); 0 for steps that grant none. */
  xpGained: Estimated<number>;
}

export const ZERO_XP: Estimated<number> = { value: 0, basis: 'derived', eraFallback: false };

export function newStepWork(): StepWork {
  return {
    parts: [],
    used: [],
    facts: [],
    legs: [],
    unresolvedReported: false,
    positionReported: false,
    hearthCast: false,
    questId: null,
    accepted: null,
    turnedIn: null,
    abandoned: null,
    assumedInLog: null,
    objectivesDone: null,
    flightPathsLearned: null,
    spellsLearned: null,
    skillsLearned: null,
    hearthChanged: false,
    ridingChanged: false,
    unknownXpReset: false,
    xpGained: ZERO_XP,
  };
}

/** SIM-3, at most once per step (TIME-2). */
export function reportUnresolved(work: StepWork): void {
  if (work.unresolvedReported) return;
  work.unresolvedReported = true;
  work.facts.push({ kind: 'unresolved-location' });
}
