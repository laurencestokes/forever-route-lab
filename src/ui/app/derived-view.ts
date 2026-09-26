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
import type { EffectiveRules } from '../../rules/precedence';
import type { StepEstimate } from '../../sim/estimate';
import type { SimFact, UnknownPositionCause } from '../../sim/facts';
import { NOT_SIMULATED, type RouteView } from '../app-model';
import { formatInteger, plural } from '../lib/format';
import { countIssues, type IssueCounts, NO_ISSUES } from '../lib/issues';
import { knownReadout, type Readout, readoutFromEstimate, unknownReadout } from '../lib/readout';
import { assumptionList, assumptionWords, type RuleParameter } from '../lib/rule-labels';
import type { PendingTravel } from '../markers/PendingMarker';
import type { StepRowModel } from '../route/rows';
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

/**
 * Why a step's time is unknown, from what the simulation recorded (SIMULATION TIME-13): a sentence,
 * shown after "Unknown: ". The step's own causes come first, then an unknown position it moved from.
 */
export function unknownTimeReason(facts: readonly SimFact[]): string {
  for (const fact of facts) {
    if (fact.kind === 'time-unknown') return TIME_UNKNOWN[fact.reason];
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

/**
 * Fills the route rows with the walk's numbers as they render (`RouteList deriveRow`): only the
 * mounted rows ask, so a new walk costs the rows in view. The quest chip is taken at the level
 * the step starts at, marked uncertain while that level is a lower bound. Undefined without a
 * derived store: the rows keep their own "not simulated" values.
 */
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

/** Whether two filled-in models of the same row show the same thing (every field a walk fills in). */
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

export function createRowDeriver(
  view: Pick<RouteView, 'steps' | 'numberOfStep' | 'rowSteps'>,
  dataset: Pick<DatasetView, 'quest'>,
  state: RowSource | null,
): ((row: StepRowModel, index: number) => StepRowModel) | undefined {
  const derive = createRowDeriverOnce(view, dataset, state);
  return derive === undefined ? undefined : (row, rowIndex) => stableRow(row, derive(row, rowIndex));
}

function createRowDeriverOnce(
  view: Pick<RouteView, 'steps' | 'numberOfStep' | 'rowSteps'>,
  dataset: Pick<DatasetView, 'quest'>,
  state: RowSource | null,
): ((row: StepRowModel, index: number) => StepRowModel) | undefined {
  if (state === null) return undefined;
  const results = state.results;
  if (results === null) {
    const unknown = unknownReadout<number>(noResultsReason(state));
    return (row) => ({ ...row, projectedLevel: unknown, duration: unknown, xpGained: unknown });
  }
  const indexOf = createStepIndex(results, view);
  const notWalked = unknownReadout<number>(STEP_NOT_WALKED);
  const reason = pendingTravelReason(state);
  return (row, rowIndex) => {
    const id = view.rowSteps[rowIndex]?.[0];
    const index = id === undefined ? null : indexOf(id);
    const derived = index === null ? null : stepDerivedAt(results, index, reason);
    if (derived === null) return { ...row, projectedLevel: notWalked, duration: notWalked, xpGained: notWalked, pending: null, assumptions: null, issues: NO_ISSUES };
    const step = index === null ? undefined : view.steps[index];
    let quest = row.quest;
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
    return {
      ...row,
      quest,
      projectedLevel: derived.projectedLevel,
      duration: derived.duration,
      xpGained: derived.xpGained,
      pending: derived.pending,
      assumptions: derived.assumptions,
      issues: derived.issues.length === 0 ? NO_ISSUES : countIssues(derived.issues),
    };
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
