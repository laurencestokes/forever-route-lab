import {
  isCurrent,
  pendingTravelReason,
  provisionalNote,
  type DerivedResults,
  type DerivedState,
  type PathsProgress,
  type PendingTravelReason,
  type TravelStatus,
} from '../../app/derived';
import { effectiveQuestLevel, questDifficultyAt, stepQuestIds } from '../../app/shell-support';
import type { DatasetView } from '../../domain/dataset';
import type { Estimated } from '../../domain/estimate';
import type { StepId } from '../../domain/ids';
import type { ValidationIssue } from '../../domain/issues';
import type { RouteStep } from '../../domain/route';
import type { EffectiveRules } from '../../rules/precedence';
import type { RuleBasis } from '../../rules/ruleset';
import type { StepEstimate } from '../../sim/estimate';
import type { SimFact, TransportDockFact, UnknownPositionCause } from '../../sim/facts';
import { NOT_SIMULATED, type RouteView, stepDetail, stepPlace } from '../app-model';
import { formatInteger, plural } from '../lib/format';
import { countIssues, type IssueCounts, NO_ISSUES } from '../lib/issues';
import { knownReadout, type Readout, readoutFromEstimate, unknownReadout } from '../lib/readout';
import { assumptionList, assumptionWords, type RuleParameter } from '../lib/rule-labels';
import type { PendingTravel } from '../markers/PendingMarker';
import type { GroupRowModel, RowIssue, RowMarkState, RowPlace, StepRowModel } from '../route/rows';
import type { SimulationStatusModel } from '../shell/SimulationStatus';
import type { XpBarProps } from '../shell/XpBar';

/**
 * The derived results (src/app/derived.ts: one engine walk per revision, with simulation and
 * validation) as the shell shows them: route-row estimates, the status bar's metrics, the XP bar,
 * the simulation's state and the issue counts. Pure functions of the derived state, the route view
 * and the dataset; no store, no React, so the panels stay presentational where they can.
 *
 * Unknown stays unknown: a number the walk could not work out is an unknown readout with its reason,
 * never 0. Every readout carries its basis (`assumed` for an assumption, `eraFallback` for Era values
 * standing in for Forever ones), from the estimate it came from.
 */

// Reasons ---------------------------------------------------------------------------------------

export { NOT_SIMULATED };

/** Before the simulation's code has loaded and walked the route once. */
export const SIMULATION_LOADING = 'Not simulated yet: the route simulation is loading';

/** A step added since the published walk: it is simulated with the next one. */
export const STEP_NOT_WALKED = 'Not simulated yet: the route is being simulated again after the last edit';

/** Why derived numbers are unknown when there are no results to read them from. */
export function noResultsReason(state: Pick<DerivedState, 'status' | 'failure'> | null): string {
  if (state === null) return NOT_SIMULATED;
  if (state.status === 'failed') return state.failure ?? 'The route simulation failed';
  return SIMULATION_LOADING;
}

const TIME_UNKNOWN: Readonly<Record<Extract<SimFact, { readonly kind: 'time-unknown' }>['reason'], string>> = {
  'reputation-objective': 'A reputation objective has no time estimate',
  'item-without-source': 'An item objective has no drop source in the data',
  'above-max-level': 'The target is past the level cap',
  'gray-mob': 'The mobs give no XP at this level, so the grind never ends',
};

/**
 * Why the position a step moves from is unknown (the `position-unknown` fact's cause, TIME-2;
 * review ENG-02, UI-16): the travel from there has no time.
 */
const POSITION_UNKNOWN: Readonly<Record<UnknownPositionCause, string>> = {
  'start-unset': 'The route has no start location, so the travel from it cannot be estimated',
  'start-unresolved': 'The start location cannot be placed on the map, so the travel from it cannot be estimated',
  'zone-travel': 'An earlier travel step has no location, so the travel from there cannot be estimated',
  'death-skip': 'An earlier death skip leaves the position unknown, so the travel from there cannot be estimated',
  unresolved: 'An earlier place cannot be located, so the travel from there cannot be estimated',
  'several-spawns': 'An earlier NPC or object has several spawns and the way to it started from an unknown place, so which one was reached is unknown',
  'hearth-unbound': 'An earlier hearth had no bind point, so the travel from there cannot be estimated',
  'flight-unresolved': 'An earlier flight’s destination cannot be placed, so the travel from there cannot be estimated',
  'transport-arrival': 'An earlier transport arrives somewhere unknown, so the travel from there cannot be estimated',
};

type CarriedFact = Extract<SimFact, { readonly kind: 'objectives-carried' }>;

/** The step's carried objective work (D-040), or null. */
function carriedOf(facts: readonly SimFact[]): CarriedFact | null {
  for (const fact of facts) if (fact.kind === 'objectives-carried') return fact;
  return null;
}

/** `objective 1`, `objectives 1 and 3`: 0-based indices as the 1-based numbers the quest log shows. */
function objectiveWords(indices: readonly number[]): string {
  return `${indices.length === 1 ? 'objective' : 'objectives'} ${listWords(indices.map((index) => String(index + 1)))}`;
}

/**
 * What a turn-in's numbers include when it carries objective work no Complete step finishes
 * (SIMULATION TIME-11, D-040), in a sentence; null when it carries none. A duration override stands
 * in for the carried time, and an objective without a time estimate leaves it out; the kill XP is
 * always included.
 */
export function carriedWorkSentence(facts: readonly SimFact[]): string | null {
  const carried = carriedOf(facts);
  if (carried === null) return null;
  const which = `${objectiveWords(carried.objectives)}, which no Complete step finishes`;
  switch (carried.time) {
    case 'counted':
      return `This turn-in includes the time and kill XP of ${which}; the travel to that work is not included`;
    case 'overridden':
      return `This turn-in includes the kill XP of ${which}; the step’s duration override stands in for the time of that work`;
    case 'unknown':
      return `This turn-in includes the kill XP of ${which}; the time of that work cannot be estimated`;
  }
}

/**
 * What an accept's objectives include (TIME-10, D-040): items a Complete step collected before the
 * quest was accepted count at once. Null for other steps.
 */
function itemsBeforeAcceptSentence(facts: readonly SimFact[]): string | null {
  for (const fact of facts) {
    if (fact.kind !== 'objectives-before-accept') continue;
    const one = fact.objectives.length === 1;
    const words = objectiveWords(fact.objectives);
    return `${words.charAt(0).toUpperCase()}${words.slice(1)} ${one ? 'counts' : 'count'} as soon as the quest is accepted: a Complete step collected ${one ? 'its' : 'their'} items before this accept`;
  }
  return null;
}

/** Where a dock's position comes from, as Details words it (SIMULATION TIME-7). */
function dockWords(dock: TransportDockFact): string {
  switch (dock.pointFrom) {
    case 'inferred': {
      // TIME-7 (D-052 item 1): the walks end at the berth's boarding point; the step between them is timed at run speed.
      const boarding = dock.boardingYd === null || dock.boardingYd === 0 ? '' : `, boarding on walkable ground ${formatInteger(Math.round(dock.boardingYd))} yd from the berth`;
      return `${dock.name}, dock position inferred from ${dock.record ?? 'the client taxi file'}${boarding}`;
    }
    case 'user':
      return `${dock.name}, at the dock you entered`;
    case 'dock-npc':
      return `${dock.name}, at its dock master`;
    case null:
      return `${dock.name}, dock position unknown`;
  }
}

/**
 * The Details "Transport" sentence of a transport step (SIMULATION TIME-7; map-presentation.md §10,
 * MP-R32): the service ridden and where each dock's position comes from, with its client record
 * when it is inferred; null for other steps.
 */
export function transportSentence(facts: readonly SimFact[]): string | null {
  for (const fact of facts) {
    if (fact.kind !== 'transport-ride') continue;
    const [departure, arrival] = fact.docks;
    const docks = [departure, arrival].flatMap((dock) => (dock === undefined ? [] : [`${dock.end === 'departure' ? 'from' : 'to'} ${dockWords(dock)}`]));
    const boarding = fact.docks.some((dock) => dock.boardingYd !== null && dock.boardingYd > 0) ? ', and the step between berth and boarding point timed at run speed (assumed)' : '';
    return `${fact.name}: ${docks.join('; ')}; wait and ride times assumed${boarding}`;
  }
  return null;
}

/** The Details "Objective work" sentence of a step (D-040): a turn-in's carried work, or an accept's items collected before it. */
export function objectiveWorkSentence(facts: readonly SimFact[]): string | null {
  return carriedWorkSentence(facts) ?? itemsBeforeAcceptSentence(facts);
}

/**
 * Why a step's time is unknown, from what the simulation recorded (SIMULATION TIME-13): a sentence,
 * shown after "Unknown: ". The step's own causes come first, then an unknown position it moved from.
 * An objective a turn-in carries (D-040) says so.
 */
export function unknownTimeReason(facts: readonly SimFact[]): string {
  for (const fact of facts) {
    if (fact.kind !== 'time-unknown') continue;
    const objective = fact.objective;
    const carried = objective === null ? null : carriedOf(facts);
    if (objective !== null && carried !== null && carried.questId === fact.questId && carried.objectives.includes(objective)) {
      return `${TIME_UNKNOWN[fact.reason]}: this turn-in carries its work, because no Complete step finishes ${objectiveWords([objective])}`;
    }
    return TIME_UNKNOWN[fact.reason];
  }
  for (const fact of facts) {
    if (fact.kind === 'grind-zero-rate') return 'The grind is set to 0 XP per hour, so it never reaches its level';
    if (fact.kind === 'unresolved-location') return 'A place of this step cannot be located';
    if (fact.kind === 'cross-world-no-transport') return 'The step changes world map without a transport, so the travel cannot be estimated';
    if (fact.kind === 'flight-unresolved') return 'A flight end does not match one flight master with a position, so the flight cannot be estimated';
    if (fact.kind === 'hearth-cooldown' && fact.upperBound) return 'The hearthstone may still be on cooldown, and an earlier step’s unknown time makes the wait unknown';
  }
  for (const fact of facts) {
    if (fact.kind === 'position-unknown') return POSITION_UNKNOWN[fact.cause];
  }
  return 'Part of this step’s time cannot be estimated';
}

/** Why a step's XP is unknown (SIMULATION XP-4). */
export function unknownXpReason(facts: readonly SimFact[]): string {
  for (const fact of facts) {
    if (fact.kind !== 'unknown-xp') continue;
    return fact.reason === 'no-record' ? 'The quest’s XP is not in the data' : 'The quest’s level is unknown, so its XP cannot be worked out';
  }
  return 'This step’s XP cannot be worked out';
}

// Levels ----------------------------------------------------------------------------------------

/** XP from `level` to the next, or null at the cap or past the table (SIMULATION XP-1, XP-3). */
export function xpToNextLevel(rules: EffectiveRules, level: number): number | null {
  if (level >= rules.values.maxLevel.value) return null;
  const need = rules.values.xpToNextLevel.value[level - 1];
  return need === undefined || need <= 0 ? null : need;
}

/**
 * The level as the rows show it: 12.4 is level 12 and 40% of the way to 13 (`formatLevel`
 * truncates, so it never reads as the next level before the ding). At the cap it is the level.
 */
export function fractionalLevel(rules: EffectiveRules, level: number, xp: number): number {
  const need = xpToNextLevel(rules, level);
  if (need === null) return level;
  return level + Math.min(Math.max(xp, 0) / need, 0.999);
}

/** A level estimate as a readout, fractional with its XP, `≥` while XP is missing. */
export function levelReadout(rules: EffectiveRules, level: Estimated<number>, xp: number, lowerBound: boolean): Readout<number> {
  if (level.value === null || level.basis === 'unknown') return unknownReadout('The level cannot be worked out');
  return knownReadout(fractionalLevel(rules, level.value, xp), {
    lowerBound,
    assumed: level.basis === 'assumption',
    eraFallback: level.eraFallback,
  });
}

// Steps -----------------------------------------------------------------------------------------

/** The walk's numbers for one step, as the rows and Details show them. */
export interface StepDerived {
  readonly projectedLevel: Readout<number>;
  readonly duration: Readout<number>;
  readonly xpGained: Readout<number>;
  /**
   * Why the step's travel time is provisional (its time uses the straight-line estimate): for a
   * pending travel leg, the paths' state (`path` while it is computed, `retrying`, `paused` or
   * `failed`, UI-04); `checking`, the navigation data is still being checked and the step travels.
   * Null when final.
   */
  readonly pending: PendingTravel | null;
  /** The assumptions and Era values the step read, in words; null for none. */
  readonly assumptions: string | null;
  readonly issues: readonly ValidationIssue[];
  /** The character's level as the step starts, and whether it is a lower bound. */
  readonly levelBefore: { readonly level: number; readonly lowerBound: boolean } | null;
  /**
   * What the step's numbers include of objective work no step of its own prices (D-040), in a
   * sentence: a turn-in's carried work, or an accept's items collected before it; else null.
   */
  readonly objectiveWork: string | null;
  /** A transport step's service and its docks' provenance (TIME-7, MP-R32), in a sentence; else null. */
  readonly transport: string | null;
}

const NO_STEP_ISSUES: readonly ValidationIssue[] = [];

/**
 * What a step's 0 s reads when it reads no parameter: TIME-8 prices a note and an abandon at 0 s,
 * and the simulation marks that as an assumption without a rule key, so the marker would otherwise
 * name nothing (UI-20).
 */
const NO_TIME_RULE: Partial<Readonly<Record<string, string>>> = {
  note: 'the rule that a note takes no time (SIMULATION TIME-8)',
  abandon: 'the rule that abandoning a quest takes no time (SIMULATION TIME-8)',
};

/** The parameters a step read, in words; for an assumed number that read none, the rule it rests on. */
function stepAssumptionWords(results: DerivedResults, index: number, estimate: StepEstimate): string | null {
  const words = assumptionWords(estimate.assumptionsUsed, results.rules);
  if (words !== null || estimate.duration.basis !== 'assumption') return words;
  const kind = results.project.route.steps[index]?.kind;
  return kind === undefined ? null : (NO_TIME_RULE[kind] ?? null);
}

/** A pending leg's marker for the route's pending reason (`pendingTravelReason`). */
const PENDING_LEG: Readonly<Record<PendingTravelReason, PendingTravel>> = {
  computing: 'path',
  retrying: 'retrying',
  paused: 'paused',
  failed: 'failed',
  checking: 'path',
};

/** Why a step's travel time is provisional, or null (see `StepDerived.pending`). */
function pendingOf(estimate: StepEstimate, reason: PendingTravelReason): PendingTravel | null {
  if (estimate.facts.some((fact) => fact.kind === 'pending-leg')) return PENDING_LEG[reason];
  return reason === 'checking' && estimate.breakdown.travel > 0 ? 'checking' : null;
}

/**
 * The estimate of step `index` of `results` in the shell's words. `reason`: why pending travel is
 * pending (`pendingTravelReason` of the derived state); with `checking` (the navigation data is
 * still being checked) every step that travels has a provisional time.
 */
export function stepDerivedAt(results: DerivedResults, index: number, reason: PendingTravelReason = 'computing'): StepDerived | null {
  const estimate: StepEstimate | undefined = results.estimates[index];
  if (estimate === undefined) return null;
  const { rules } = results;
  const previous = index === 0 ? undefined : results.estimates[index - 1];
  let levelBefore: StepDerived['levelBefore'] = null;
  if (index === 0) levelBefore = { level: results.project.character.startLevel, lowerBound: false };
  else if (previous !== undefined && previous.levelAfter.value !== null) {
    levelBefore = { level: previous.levelAfter.value, lowerBound: previous.levelIsLowerBound };
  }
  return {
    projectedLevel: levelReadout(rules, estimate.levelAfter, estimate.xpAfter, estimate.levelIsLowerBound),
    duration: readoutFromEstimate(estimate.duration, unknownTimeReason(estimate.facts)),
    xpGained: readoutFromEstimate(estimate.xpGained, unknownXpReason(estimate.facts)),
    pending: pendingOf(estimate, reason),
    assumptions: stepAssumptionWords(results, index, estimate),
    issues: results.stepIssues[index] ?? NO_STEP_ISSUES,
    levelBefore,
    objectiveWork: objectiveWorkSentence(estimate.facts),
    transport: transportSentence(estimate.facts),
  };
}

/** What Details shows of the walk at one step: its numbers, or why there are none. */
export type StepNumbers = { readonly kind: 'known'; readonly value: StepDerived } | { readonly kind: 'unknown'; readonly readout: Readout<number> };

const NOT_SIMULATED_NUMBERS: StepNumbers = { kind: 'unknown', readout: unknownReadout(NOT_SIMULATED) };

/** The walk's numbers at step `stepId` (Details), or why there are none. */
export function stepNumbersOf(state: DerivedState | null, view: Pick<RouteView, 'steps' | 'numberOfStep'>, stepId: StepId | null): StepNumbers {
  if (state === null) return NOT_SIMULATED_NUMBERS;
  const results = state.results;
  if (results === null) return { kind: 'unknown', readout: unknownReadout(noResultsReason(state)) };
  const index = stepId === null ? null : createStepIndex(results, view)(stepId);
  const value = index === null ? null : stepDerivedAt(results, index, pendingTravelReason(state));
  return value === null ? { kind: 'unknown', readout: unknownReadout(STEP_NOT_WALKED) } : { kind: 'known', value };
}

const sameReadout = (a: Readout<number>, b: Readout<number>): boolean =>
  a === b ||
  (a.value === b.value &&
    a.unknownReason === b.unknownReason &&
    a.lowerBound === b.lowerBound &&
    a.upperBound === b.upperBound &&
    a.assumed === b.assumed &&
    a.eraFallback === b.eraFallback);

const sameIssue = (a: ValidationIssue, b: ValidationIssue): boolean => a === b || (a.code === b.code && a.severity === b.severity && a.message === b.message);

/**
 * Whether two step readings show the same thing, so Details re-renders only when its step's numbers
 * or issues change, not at every walk (a walk while walking paths are computed re-runs many times).
 */
export function sameStepNumbers(a: StepNumbers, b: StepNumbers): boolean {
  if (a === b) return true;
  if (a.kind === 'unknown') return b.kind === 'unknown' && sameReadout(a.readout, b.readout);
  if (b.kind === 'unknown') return false;
  const x = a.value;
  const y = b.value;
  return (
    sameReadout(x.projectedLevel, y.projectedLevel) &&
    sameReadout(x.duration, y.duration) &&
    sameReadout(x.xpGained, y.xpGained) &&
    x.pending === y.pending &&
    x.assumptions === y.assumptions &&
    x.objectiveWork === y.objectiveWork &&
    x.issues.length === y.issues.length &&
    x.issues.every((issue, i) => {
      const other = y.issues[i];
      return other !== undefined && sameIssue(issue, other);
    })
  );
}

/** The step's index in `results`, by id: the route view's own index while the walk is of these steps. */
export function createStepIndex(results: DerivedResults, view: Pick<RouteView, 'steps' | 'numberOfStep'>): (id: StepId) => number | null {
  if (results.project.route.steps === view.steps) {
    return (id) => {
      const number = view.numberOfStep.get(id);
      return number === undefined ? null : number - 1;
    };
  }
  // The route changed since this walk (it is on its way): look steps up by id, built on first use.
  let byId: Map<StepId, number> | null = null;
  return (id) => {
    byId ??= new Map(results.estimates.map((estimate, i) => [estimate.stepId, i]));
    return byId.get(id) ?? null;
  };
}

/** What the rows read of the derived state: the paths' state and failure, never their progress (`sameRowSource`). */
export type RowSource = Pick<DerivedState, 'status' | 'failure' | 'results'> & {
  readonly travel: Pick<TravelStatus, 'model'>;
  readonly paths: Pick<PathsProgress, 'state' | 'failure'>;
};

/** Whether two derived states give the rows the same numbers (the route panel's selector equality, PERF-11). */
export function sameRowSource(a: RowSource | null, b: RowSource | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.results === b.results && a.status === b.status && a.failure === b.failure && pendingTravelReason(a) === pendingTravelReason(b);
}

/** Whether two filled-in models of the same row show the same thing (every field a walk or line 2 fills in). */
function sameDerivedRow(a: StepRowModel, b: StepRowModel): boolean {
  const qa = a.quest;
  const qb = b.quest;
  return (
    sameReadout(a.projectedLevel, b.projectedLevel) &&
    sameReadout(a.duration, b.duration) &&
    sameReadout(a.xpGained, b.xpGained) &&
    a.pending === b.pending &&
    a.assumptions === b.assumptions &&
    a.issues.error === b.issues.error &&
    a.issues.warning === b.issues.warning &&
    a.issues.info === b.issues.info &&
    a.detail === b.detail &&
    (a.place ?? null) === (b.place ?? null) &&
    a.mark === b.mark &&
    a.levelUp === b.levelUp &&
    (a.issue === b.issue || (a.issue !== null && b.issue !== null && a.issue.severity === b.issue.severity && a.issue.message === b.issue.message && a.issue.short === b.issue.short)) &&
    (qa === qb ||
      (qa !== null && qb !== null && qa.level === qb.level && qa.difficulty === qb.difficulty && qa.uncertain === qb.uncertain && qa.provenance === qb.provenance))
  );
}

/**
 * The last model filled in for each row (keyed by the row built for the route, which a walk never
 * rebuilds). A new walk that leaves a row's numbers as they were hands back the same object, so the
 * route list's memoised rows skip it (PERF-11): a re-walk while walking paths are computed then
 * re-renders only the rows whose numbers changed.
 */
const lastDerivedRow = new WeakMap<StepRowModel, StepRowModel>();

function stableRow(row: StepRowModel, next: StepRowModel): StepRowModel {
  const last = lastDerivedRow.get(row);
  if (last !== undefined && sameDerivedRow(last, next)) return last;
  lastDerivedRow.set(row, next);
  return next;
}

/**
 * Line 2's words (where the step happens, `stepDetail`), formatted when a row first mounts and kept
 * per dataset view, then per step object (docs/research/ui-refresh.md §10.1; review UR-10): a new
 * view (another character, custom quests, overrides) starts a new cache, and an edited step is a
 * new object. The words read the dataset's zone names only, not the map geometry, so the view is
 * the whole key. Building the rows (`buildRouteView`) formats none of them.
 */
const lineTwoCache = new WeakMap<object, WeakMap<RouteStep, string | null>>();

export function lineTwoOf(dataset: DatasetView, step: RouteStep): string | null {
  let byStep = lineTwoCache.get(dataset);
  if (byStep === undefined) {
    byStep = new WeakMap();
    lineTwoCache.set(dataset, byStep);
  }
  const known = byStep.get(step);
  if (known !== undefined) return known;
  const words = stepDetail(step, dataset);
  byStep.set(step, words);
  return words;
}

const placeCache = new WeakMap<object, WeakMap<RouteStep, RowPlace | null>>();

/** Line 2's short place (`stepPlace`: who and the zone, no coordinates; review UI-01), cached as `lineTwoOf` is, so a kept row keeps the same object. */
export function lineTwoPlaceOf(dataset: DatasetView, step: RouteStep): RowPlace | null {
  let byStep = placeCache.get(dataset);
  if (byStep === undefined) {
    byStep = new WeakMap();
    placeCache.set(dataset, byStep);
  }
  const known = byStep.get(step);
  if (known !== undefined) return known;
  const place = stepPlace(step, dataset);
  byStep.set(step, place);
  return place;
}

/**
 * Doubts at a step that make a quest mark "may be" (ui-refresh.md §5.2; the list map-presentation.md
 * §7.2 uses): the accept checks' `-uncertain` and `-unverifiable` codes, VAL013 and VAL021.
 */
export function isDoubtCode(code: string): boolean {
  return code.endsWith('-uncertain') || code.endsWith('-unverifiable') || code.startsWith('VAL013') || code.startsWith('VAL021');
}

const SEVERITY_ORDER = ['error', 'warning', 'info'] as const;

/**
 * The worst issue at a step: its first error, else its first warning, else its first info; null for
 * none. `shorten` gives line 2's short form (the results' `shortIssue`, review UI-01); without it the
 * row shows the message.
 */
export function worstIssue(issues: readonly ValidationIssue[], shorten?: (issue: ValidationIssue) => string): RowIssue | null {
  for (const severity of SEVERITY_ORDER) {
    const issue = issues.find((candidate) => candidate.severity === severity);
    if (issue !== undefined) return shorten === undefined ? { severity, message: issue.message } : { severity, message: issue.message, short: shorten(issue) };
  }
  return null;
}

/**
 * A quest step's mark at the walk (ui-refresh.md §5.2): an error at the step locks it; a doubt
 * makes it "may be"; otherwise an accept is available and a turn-in ready. A turn-in whose
 * objectives are carried (D-040, VAL030, a warning) stays ready: line 2 says the warning.
 */
export function rowMarkOf(kind: StepRowModel['kind'], issues: readonly ValidationIssue[]): RowMarkState | null {
  if (kind !== 'accept' && kind !== 'turnin') return null;
  if (issues.some((issue) => issue.severity === 'error')) return 'locked';
  if (issues.some((issue) => isDoubtCode(issue.code))) return 'uncertain';
  return kind === 'accept' ? 'available' : 'ready';
}

/**
 * Fills the route rows with the walk's numbers as they render (`RouteList deriveRow`): only the
 * mounted rows ask, so a new walk costs the rows in view. The quest chip is taken at the level
 * the step starts at, marked uncertain while that level is a lower bound; the quest mark takes its
 * state from the step's issues, line 2 its words (cached) or the worst issue's, and the level
 * column its level-up. Without a derived store the rows keep their own "not simulated" values and
 * only line 2 is filled in.
 */
export function createRowDeriver(
  view: Pick<RouteView, 'steps' | 'numberOfStep' | 'rowSteps'>,
  dataset: DatasetView,
  state: RowSource | null,
): (row: StepRowModel, index: number) => StepRowModel {
  const derive = createRowDeriverOnce(view, dataset, state);
  // A deriver lives for one walk and one route view: the list asks it again at every render (a
  // selection change, a scroll), and a row it has filled in comes back at once.
  const filled = new WeakMap<StepRowModel, StepRowModel>();
  return (row, rowIndex) => {
    const known = filled.get(row);
    if (known !== undefined) return known;
    const next = stableRow(row, derive(row, rowIndex));
    filled.set(row, next);
    return next;
  };
}

/** The step a row stands for, by the route view (the walk may be of an older route). */
function rowStep(view: Pick<RouteView, 'steps' | 'numberOfStep' | 'rowSteps'>, rowIndex: number): RouteStep | undefined {
  const id = view.rowSteps[rowIndex]?.[0];
  const number = id === undefined ? undefined : view.numberOfStep.get(id);
  return number === undefined ? undefined : view.steps[number - 1];
}

function createRowDeriverOnce(
  view: Pick<RouteView, 'steps' | 'numberOfStep' | 'rowSteps'>,
  dataset: DatasetView,
  state: RowSource | null,
): (row: StepRowModel, index: number) => StepRowModel {
  const withLineTwo = (row: StepRowModel, rowIndex: number): StepRowModel => {
    const step = rowStep(view, rowIndex);
    const detail = step === undefined ? null : lineTwoOf(dataset, step);
    const place = step === undefined ? null : lineTwoPlaceOf(dataset, step);
    return detail === row.detail && place === (row.place ?? null) ? row : { ...row, detail, place };
  };
  if (state === null) return withLineTwo;
  const results = state.results;
  if (results === null) {
    const unknown = unknownReadout<number>(noResultsReason(state));
    return (row, rowIndex) => ({ ...withLineTwo(row, rowIndex), projectedLevel: unknown, duration: unknown, xpGained: unknown });
  }
  const indexOf = createStepIndex(results, view);
  const notWalked = unknownReadout<number>(STEP_NOT_WALKED);
  const reason = pendingTravelReason(state);
  return (row, rowIndex) => {
    const base = withLineTwo(row, rowIndex);
    const id = view.rowSteps[rowIndex]?.[0];
    const index = id === undefined ? null : indexOf(id);
    const derived = index === null ? null : stepDerivedAt(results, index, reason);
    if (derived === null) {
      return { ...base, projectedLevel: notWalked, duration: notWalked, xpGained: notWalked, pending: null, assumptions: null, issues: NO_ISSUES, issue: null, levelUp: null };
    }
    const step = index === null ? undefined : view.steps[index];
    let quest = base.quest;
    if (quest !== null && step !== undefined && derived.levelBefore !== null && results.project.route.steps === view.steps) {
      const first = stepQuestIds(step)[0];
      const record = first === undefined ? undefined : dataset.quest(first);
      if (record !== undefined) {
        const level = derived.levelBefore.level;
        quest = {
          ...quest,
          level: effectiveQuestLevel(level, record.level, record.minLevel),
          difficulty: questDifficultyAt(level, record.level, record.minLevel),
          uncertain: derived.levelBefore.lowerBound,
        };
      }
    }
    const after = derived.projectedLevel.value;
    const before = derived.levelBefore;
    const levelUp = after !== null && before !== null && Math.floor(after) > before.level ? Math.floor(after) : null;
    return {
      ...base,
      quest,
      projectedLevel: derived.projectedLevel,
      duration: derived.duration,
      xpGained: derived.xpGained,
      pending: derived.pending,
      assumptions: derived.assumptions,
      issues: derived.issues.length === 0 ? NO_ISSUES : countIssues(derived.issues),
      issue: worstIssue(derived.issues, shortIssueFor(results, step)),
      mark: rowMarkOf(base.kind, derived.issues) ?? base.mark,
      levelUp,
    };
  };
}

/** Line 2's short form of a step's issues, from the results (`DerivedResults.shortIssue`, built in the pipeline's chunk; review UI-01). */
function shortIssueFor(results: DerivedResults, step: RouteStep | undefined): ((issue: ValidationIssue) => string) | undefined {
  const shorten = results.shortIssue;
  if (shorten === undefined) return undefined;
  const stepQuest = step === undefined ? null : (stepQuestIds(step)[0] ?? null);
  return (issue) => shorten(issue, stepQuest);
}

// Group header rows -------------------------------------------------------------------------------

const lastDerivedGroup = new WeakMap<GroupRowModel, GroupRowModel>();

/**
 * Fills a group header with the level span of its steps (ui-refresh.md §6.3): the level after its
 * first step and after its last, from the walk; null without results. The same object comes back
 * while the span reads the same, so the memoised header does not re-render.
 */
export function createGroupDeriver(
  view: Pick<RouteView, 'steps' | 'numberOfStep' | 'rowSteps'>,
  state: RowSource | null,
): ((row: GroupRowModel, index: number) => GroupRowModel) | undefined {
  const results = state?.results ?? null;
  if (state === null || results === null) return undefined;
  const indexOf = createStepIndex(results, view);
  const reason = pendingTravelReason(state);
  return (row, rowIndex) => {
    const ids = view.rowSteps[rowIndex] ?? [];
    const first = ids[0];
    const last = ids.at(-1);
    const from = first === undefined ? null : indexOf(first);
    const to = last === undefined ? null : indexOf(last);
    const a = from === null ? null : stepDerivedAt(results, from, reason);
    const b = to === null ? null : stepDerivedAt(results, to, reason);
    const span = a === null || b === null ? null : { from: a.projectedLevel, to: b.projectedLevel };
    const known = lastDerivedGroup.get(row);
    if (known !== undefined && (known.levelSpan === span || (known.levelSpan !== null && span !== null && sameReadout(known.levelSpan.from, span.from) && sameReadout(known.levelSpan.to, span.to)))) return known;
    const next = { ...row, levelSpan: span };
    lastDerivedGroup.set(row, next);
    return next;
  };
}

// Route metrics -----------------------------------------------------------------------------------

/** A basis in words, for the summary's Basis column. */
export function basisWords(estimate: Pick<Estimated<unknown>, 'basis' | 'eraFallback'>): string {
  const base =
    estimate.basis === 'source'
      ? 'from the data'
      : estimate.basis === 'derived'
        ? 'worked out from the data and rules'
        : estimate.basis === 'assumption'
          ? 'depends on assumptions'
          : 'unknown';
  return estimate.eraFallback ? `${base}; uses Era values` : base;
}

/** A world map's name for sentences (`Kalimdor`), from the map panel's surfaces; null when it has none. */
export type MapNameOf = (mapId: number) => string | null;

/** `A`, `A and B`, `A, B and C`. */
function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

/**
 * World maps in words: `Kalimdor (world map 1)`, keeping the id for diagnosis, or `world map 36`
 * for a map with no name (UI.md §9 rule 12). A generic `World map 36` surface name counts as none.
 */
export function mapWords(ids: readonly number[], mapName: MapNameOf = () => null): string {
  return listWords(
    ids.map((id) => {
      const name = mapName(id);
      return name === null || /^world map \d+$/i.test(name) ? `world map ${String(id)}` : `${name} (world map ${String(id)})`;
    }),
  );
}

export interface RouteMetricsView {
  readonly duration: Readout<number>;
  readonly xpGained: Readout<number>;
  readonly levelReached: Readout<number>;
  readonly xpPerHour: Readout<number>;
  readonly travelShare: Readout<number>;
  readonly workShare: Readout<number>;
  readonly interactionShare: Readout<number>;
  readonly waitingShare: Readout<number>;
  /** Each metric's basis in words, by the keys above. */
  readonly basis: Readonly<Record<'duration' | 'xpGained' | 'levelReached' | 'xpPerHour' | 'shares', string>>;
  /** Why the times are not final yet (`provisionalNote`), or null. */
  readonly provisional: string | null;
  /** Sentences for the summary: what is not counted, what the numbers read, which travel model. */
  readonly notes: readonly string[];
  /** Every ruleset parameter the route reads that is an assumption or an Era value, with its origin (UI-13). */
  readonly parameters: readonly RuleParameter[];
}

/** The travel model in a sentence, for the summary; `mapName` names the maps whose navigation failed. */
export function travelSentence(state: Pick<DerivedState, 'travel'>, mapName?: MapNameOf): string {
  const travel = state.travel;
  switch (travel.model) {
    case 'checking':
      return 'Travel times are straight-line estimates while the navigation data is checked.';
    case 'straight-line':
      return `Navigation data is unavailable${travel.reason === null ? '' : ` (${travel.reason})`}: every travel time is a straight-line estimate.`;
    case 'navigation':
      if (travel.unavailableAll) return 'Navigation failed for every map: every travel time is a straight-line estimate.';
      if (travel.unavailableMaps.length > 0) {
        return `Walking legs follow the navigation data, except on ${mapWords(travel.unavailableMaps, mapName)}, whose navigation files could not be used: straight-line estimates there.`;
      }
      return 'Walking legs follow the navigation data (straight lines only where it has no path, each with a warning).';
  }
}

const NO_PARAMETERS: readonly RuleParameter[] = [];

const carriedCounts = new WeakMap<readonly StepEstimate[], number>();

/**
 * How many turn-ins of a walk count the time of objective work they carry (D-040), counted once
 * per walk: not those whose duration override stands in for it, nor those whose time is unknown
 * (the unknown-time note counts them).
 */
function carriedTurnIns(estimates: readonly StepEstimate[]): number {
  let count = carriedCounts.get(estimates);
  if (count === undefined) {
    count = 0;
    for (const estimate of estimates) if (carriedOf(estimate.facts)?.time === 'counted') count += 1;
    carriedCounts.set(estimates, count);
  }
  return count;
}

/**
 * XP per hour with its bound (UI-10): it divides the known XP by the known time. Unknown time makes
 * the true rate at most this (`≤`), unknown XP at least this (`≥`); with both it is bounded in no
 * known direction, so it is unknown, with the rate over the known steps in the reason.
 */
function xpPerHourReadout(m: DerivedResults['metrics'], noTime: string): Readout<number> {
  const timeLower = m.durationIsLowerBound;
  const xpLower = m.unknownXpSteps > 0;
  if (timeLower && xpLower && m.xpPerHour.value !== null && m.xpPerHour.basis !== 'unknown') {
    return unknownReadout(
      `${plural(m.stepsWithUnknownTime, 'step')} with unknown time and ${plural(m.unknownXpSteps, 'step')} with unknown XP are not counted, so the true rate could be higher or lower than the ${formatInteger(Math.round(m.xpPerHour.value))} XP per hour of the known steps`,
    );
  }
  return readoutFromEstimate(m.xpPerHour, noTime, { upperBound: timeLower && !xpLower, lowerBound: xpLower && !timeLower });
}

/**
 * The route's metrics (ARCHITECTURE §9.3) with their bases; unknown with the reason while nothing
 * is simulated. `mapName` names world maps in the travel sentence.
 */
export function routeMetricsView(state: DerivedState | null, editorRevision: number | null, mapName?: MapNameOf): RouteMetricsView {
  const results = state?.results ?? null;
  if (state === null || results === null) {
    const unknown = unknownReadout<number>(noResultsReason(state));
    const basis = 'unknown';
    return {
      duration: unknown,
      xpGained: unknown,
      levelReached: unknown,
      xpPerHour: unknown,
      travelShare: unknown,
      workShare: unknown,
      interactionShare: unknown,
      waitingShare: unknown,
      basis: { duration: basis, xpGained: basis, levelReached: basis, xpPerHour: basis, shares: basis },
      provisional: null,
      notes: [noResultsReason(state)],
      parameters: NO_PARAMETERS,
    };
  }
  const m = results.metrics;
  const last = results.estimates.at(-1);
  const levelReached =
    last === undefined
      ? levelReadout(results.rules, { value: results.project.character.startLevel, basis: 'source', eraFallback: false }, results.project.character.startXp, false)
      : levelReadout(results.rules, m.levelReached, last.xpAfter, m.levelIsLowerBound);
  const noTime = 'No known time has passed';
  const notes: string[] = [];
  const provisional = provisionalNote(state);
  if (provisional !== null) notes.push(provisional);
  if (editorRevision !== null && !isCurrent(state, editorRevision)) notes.push('Updating: these numbers are for the route as it was a moment ago.');
  if (state.status === 'failed' && state.failure !== null) notes.push(state.failure);
  if (m.stepsWithUnknownTime > 0) notes.push(`${plural(m.stepsWithUnknownTime, 'step')} with unknown time ${m.stepsWithUnknownTime === 1 ? 'is' : 'are'} not counted: the route takes at least this long.`);
  if (m.unknownXpSteps > 0) notes.push(`${plural(m.unknownXpSteps, 'step')} with unknown XP ${m.unknownXpSteps === 1 ? 'is' : 'are'} not counted: the XP and level are at least these.`);
  const carried = carriedTurnIns(results.estimates);
  if (carried > 0) {
    notes.push(
      `${plural(carried, 'turn-in')} ${carried === 1 ? 'includes' : 'include'} the time and kill XP of objectives no Complete step finishes, but not the travel to them, so the route may take longer.`,
    );
  }
  notes.push('XP per hour and the shares are over the known time and XP.');
  notes.push(travelSentence(state, mapName));
  // Over the known time only: with some steps' time unknown the shares are partial, bounded in no
  // direction (UI-10), and their basis says so.
  const partial = m.stepsWithUnknownTime > 0 ? `of the known time only (${plural(m.stepsWithUnknownTime, 'step')} with unknown time not counted); ` : '';
  const rate =
    m.durationIsLowerBound && m.unknownXpSteps === 0
      ? 'at most this: steps with unknown time are not counted; '
      : m.unknownXpSteps > 0 && !m.durationIsLowerBound
        ? 'at least this: steps with unknown XP are not counted; '
        : '';
  return {
    duration: readoutFromEstimate(m.duration, 'No step’s time is known', { lowerBound: m.durationIsLowerBound }),
    xpGained: readoutFromEstimate(m.xpGained, 'No step’s XP is known', { lowerBound: m.unknownXpSteps > 0 }),
    levelReached,
    xpPerHour: xpPerHourReadout(m, noTime),
    travelShare: readoutFromEstimate(m.shares.travel, noTime),
    workShare: readoutFromEstimate(m.shares.combatAndObjective, noTime),
    interactionShare: readoutFromEstimate(m.shares.interaction, noTime),
    waitingShare: readoutFromEstimate(m.shares.waiting, noTime),
    basis: {
      duration: basisWords(m.duration),
      xpGained: basisWords(m.xpGained),
      levelReached: basisWords(last === undefined ? { basis: 'source', eraFallback: false } : m.levelReached),
      xpPerHour: `${rate}${basisWords(m.xpPerHour)}`,
      shares: `${partial}${basisWords(m.shares.travel)}`,
    },
    provisional,
    notes,
    parameters: m.assumptionsUsed.length === 0 ? NO_PARAMETERS : assumptionList(m.assumptionsUsed, results.rules),
  };
}

// The XP bar ----------------------------------------------------------------------------------------

/** The XP bar at the active step (after it), else at the end of the route, else at its start. */
export function xpBarAt(
  state: DerivedState | null,
  view: Pick<RouteView, 'steps' | 'numberOfStep'>,
  active: { readonly stepId: StepId; readonly number: number } | null,
  start: { readonly level: number; readonly xp: number },
): XpBarProps {
  const results = state?.results ?? null;
  const startBar: XpBarProps = { level: start.level, xp: start.xp, xpToNext: null, lowerBound: false, label: 'Level at the start of the route' };
  if (results === null) {
    const reason = noResultsReason(state);
    return { ...startBar, lowerBound: true, lowerBoundReason: `the character's start level; ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`, unknownReason: reason, label: 'Projected level' };
  }
  const rules = results.rules;
  let index: number | null;
  let label: string;
  if (active !== null) {
    index = createStepIndex(results, view)(active.stepId);
    label = `Level after step ${formatInteger(active.number)}`;
    if (index === null) return { level: null, xp: null, xpToNext: null, lowerBound: false, unknownReason: STEP_NOT_WALKED, label };
  } else {
    index = results.estimates.length - 1;
    label = 'Level at the end of the route';
  }
  const estimate = index < 0 ? undefined : results.estimates[index];
  if (estimate === undefined) {
    return { ...startBar, xpToNext: xpToNextLevel(rules, start.level), atCap: xpToNextLevel(rules, start.level) === null };
  }
  const level = estimate.levelAfter.value;
  if (level === null) return { level: null, xp: null, xpToNext: null, lowerBound: false, unknownReason: 'The level cannot be worked out', label };
  const need = xpToNextLevel(rules, level);
  return {
    level,
    xp: estimate.xpAfter,
    xpToNext: need,
    atCap: need === null,
    lowerBound: estimate.levelIsLowerBound,
    lowerBoundReason: 'XP from quests whose XP is unknown is not counted',
    assumed: estimate.levelAfter.basis === 'assumption',
    eraFallback: estimate.levelAfter.eraFallback,
    label,
  };
}

// The simulation's state ------------------------------------------------------------------------------

/** While a run has not reported how many legs it computes (UI-08): no count, never "0 of 0". */
export const COUNTING_LEGS_DETAIL = 'Counting the walking legs to compute; until they are computed, their times are straight-line estimates.';

/**
 * The computing state; a total of 0 is not known yet, so it is said as counting, without numbers.
 * `failure`: the run waits to ask again after a failure that may pass (UI-04), said first.
 */
function computingOf(done: number, total: number, failure: string | null = null): SimulationStatusModel {
  const retry = failure === null ? '' : `Waiting to ask again after a failure that may pass (${failure}). `;
  if (total <= 0) return { state: 'computing', done: null, total: null, detail: `${retry}${COUNTING_LEGS_DETAIL}` };
  return {
    state: 'computing',
    done,
    total,
    detail: `${retry}${formatInteger(done)} of ${plural(total, 'walking leg')} computed; until then their times are straight-line estimates.`,
  };
}

/**
 * What the status bar says about the simulation and its travel model (`SimulationStatus`).
 * `mapName` names the world maps whose navigation failed.
 */
export function simulationStatusOf(state: DerivedState | null, mapName?: MapNameOf): SimulationStatusModel {
  if (state === null) return { state: 'ready' };
  if (state.status === 'loading') return { state: 'loading', detail: SIMULATION_LOADING };
  if (state.status === 'failed') return { state: 'failed', detail: state.failure ?? 'The route simulation failed' };
  const { paths, travel, results } = state;
  const pendingLegs = results?.pendingLegs ?? 0;
  if (paths.state === 'running') return computingOf(paths.done, paths.total, paths.failure);
  if (paths.state === 'paused') {
    return {
      state: 'paused',
      pending: pendingLegs,
      detail: `Computing walking paths is paused: ${plural(pendingLegs, 'leg')} ${pendingLegs === 1 ? 'keeps its' : 'keep their'} straight-line ${pendingLegs === 1 ? 'estimate' : 'estimates'} until you resume.`,
    };
  }
  if (travel.model === 'checking') return { state: 'checking', detail: 'Checking for navigation data; travel times are straight-line estimates meanwhile.' };
  if (travel.model === 'straight-line') return { state: 'straight-line', text: 'Straight-line estimates', detail: travelSentence(state, mapName) };
  if (paths.state === 'failed') {
    return {
      state: 'straight-line',
      text: 'Some straight-line estimates',
      detail: `Some walking paths could not be computed${paths.failure === null ? '' : ` (${paths.failure})`}: their legs keep straight-line estimates.`,
    };
  }
  // Idle while legs are still pending under navigation: a run is about to start (after Resume, or
  // the walk that asks for the legs) or its last answers are being folded into the times. The times
  // are not final (`provisionalNote` says so), so the item keeps saying it, with Cancel, instead of
  // vanishing between two states and taking keyboard focus with it (UI-03).
  if (results !== null && !results.final && (pendingLegs > 0 || results.pendingSteps > 0) && !travel.unavailableAll) {
    return paths.total > 0 && paths.done >= paths.total ? computingOf(paths.done, paths.total) : computingOf(0, 0);
  }
  if (travel.unavailableAll || travel.unavailableMaps.length > 0) {
    return { state: 'straight-line', text: travel.unavailableAll ? 'Straight-line estimates' : 'Some straight-line estimates', detail: travelSentence(state, mapName) };
  }
  return { state: 'ready' };
}

/** Whether two simulation states read the same (the status item's selector equality: a progress tick re-renders only it). */
export function sameSimulationStatus(a: SimulationStatusModel, b: SimulationStatusModel): boolean {
  if (a === b) return true;
  if (a.state !== b.state) return false;
  switch (a.state) {
    case 'ready':
      return true;
    case 'computing':
      return b.state === 'computing' && a.done === b.done && a.total === b.total && a.detail === b.detail;
    case 'paused':
      return b.state === 'paused' && a.pending === b.pending && a.detail === b.detail;
    case 'straight-line':
      return b.state === 'straight-line' && a.text === b.text && a.detail === b.detail;
    case 'loading':
    case 'failed':
    case 'checking':
      return 'detail' in b && a.detail === b.detail;
  }
}

// Issues ----------------------------------------------------------------------------------------------

const countsCache = new WeakMap<readonly ValidationIssue[], IssueCounts>();

/** Issue counts of the latest results (cached per issue list), or null while nothing is checked. */
export function validationCounts(state: DerivedState | null): IssueCounts | null {
  const issues = state?.results?.issues;
  if (issues === undefined) return null;
  let counts = countsCache.get(issues);
  if (counts === undefined) {
    counts = countIssues(issues);
    countsCache.set(issues, counts);
  }
  return counts;
}

// The quest log after the active step ---------------------------------------------------------------

/** The quest log after the selection's focus step (`DerivedState.selected`), as the status bar and the Quest log tab count it. */
export interface QuestLogCount {
  readonly stepId: StepId;
  /** No step is selected: the count is after the last step, at the end of the route (D-050 item 2). */
  readonly atEnd: boolean;
  readonly size: number;
  readonly capacity: number;
  readonly capacityBasis: RuleBasis;
  readonly capacityFrom: 'project' | 'ruleset';
}

/** The count, or null without a walked focus step; compare with `sameQuestLogCount`. */
export function questLogCountOf(state: DerivedState | null): QuestLogCount | null {
  const selected = state?.selected ?? null;
  const results = state?.results ?? null;
  if (selected === null || results === null) return null;
  const capacity = results.rules.values.questLogCapacity;
  return { stepId: selected.stepId, atEnd: selected.atEnd, size: selected.after.questLog.size, capacity: capacity.value, capacityBasis: capacity.basis, capacityFrom: capacity.from };
}

export function sameQuestLogCount(a: QuestLogCount | null, b: QuestLogCount | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.stepId === b.stepId &&
      a.atEnd === b.atEnd &&
      a.size === b.size &&
      a.capacity === b.capacity &&
      a.capacityBasis === b.capacityBasis &&
      a.capacityFrom === b.capacityFrom)
  );
}

const CAPACITY_BASIS: Readonly<Record<RuleBasis, string>> = {
  'client-data': 'client data',
  official: 'official',
  reported: 'reported',
  'era-assumed': 'an Era value',
  assumption: 'an assumption',
};

/** The quest log in words: `4 / 40` (`≥4 / 40` while the log before the route is not known), its basis, and the tab's count. */
export interface QuestLogWords {
  /** The short form: `4 / 40`, `≥4 / 40`, or `?`. */
  readonly text: string;
  /** The sentence (tooltip, spoken): the count, the step, the capacity's basis, or why it is unknown. */
  readonly detail: string;
  /** The Quest log tab's count ("4", "≥4"), or null while unknown. */
  readonly badge: string | null;
  /** The tab's spoken count: "4 quests after step 12". */
  readonly badgeLabel: string | null;
}

/** Whose quest log it is: "after step 12", or, with no step selected, "at the end of the route (after step 55)" (D-050 item 2). */
export function questLogWhere(count: Pick<QuestLogCount, 'atEnd'>, stepNumber: number): string {
  const step = `step ${formatInteger(stepNumber)}`;
  return count.atEnd ? `at the end of the route (after ${step})` : `after ${step}`;
}

/**
 * The quest log after the active step in words (ui-refresh.md §5.5, §8). `priorHistory` is the
 * character's: when the log before the route is `unknown`, the count is a lower bound. Unknown stays
 * unknown: without a walked step it says why, never "0".
 */
export function questLogWords(count: QuestLogCount | null, stepNumber: number | null, priorHistory: 'fresh' | 'listed' | 'unknown', why: string): QuestLogWords {
  if (count === null || stepNumber === null) return { text: '?', detail: `Quest log unknown: ${why}.`, badge: null, badgeLabel: null };
  const bound = priorHistory === 'unknown';
  const after = questLogWhere(count, stepNumber);
  const basis = count.capacityFrom === 'project' ? 'your project’s value' : CAPACITY_BASIS[count.capacityBasis];
  const size = formatInteger(count.size);
  const capacity = formatInteger(count.capacity);
  const lower = bound ? ' The quests in the log before the route are not known, so there may be more.' : '';
  return {
    text: `${bound ? '≥' : ''}${size} / ${capacity}`,
    detail: `In the quest log ${after}: ${bound ? 'at least ' : ''}${size} of ${capacity} quests (capacity ${capacity}: ${basis}).${lower}`,
    badge: `${bound ? '≥' : ''}${size}`,
    badgeLabel: `${bound ? 'at least ' : ''}${plural(count.size, 'quest')} ${after}`,
  };
}
