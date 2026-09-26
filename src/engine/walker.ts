import { routeGroup } from '../domain/route-ops';
import { markedKeys } from '../rules/precedence';
import { ruleInput } from '../sim/provenance';
import {
  accumulateMetrics,
  copyMetricsAccumulator,
  type MetricsAccumulator,
  metricsOf,
  newMetricsAccumulator,
  type RouteMetrics,
  type StepEstimate,
} from '../sim/estimate';
import { xpCurveOf } from '../sim/xp';
import { createBasicAcceptPolicy } from './accept';
import { createWalkEnv, type LegRecorder, recordingModel, type WalkEnv } from './env';
import { enumerateLegs } from './legs';
import { createPlaces } from './places';
import { sharedSimCache } from './sim-cache';
import { type Checkpoint, checkpointOf, cloneState, createInitialState, restoreCheckpoint, type WalkerState } from './state';
import { runStep, stepActivity } from './steps';
import type { EngineContext, ReadonlyCharacterState, RouteWalk, StepRecord, StepVisit, TravelPair, WalkProject, WalkVisitor } from './types';

/**
 * The route walker (docs/ARCHITECTURE.md §9.2). One state machine walks the route and feeds the
 * simulation, validation and route context, so they cannot disagree.
 *
 * - It mutates one working state and gives visitors a read-only view of it, before and after each
 *   step, with the step's record (estimate, delta, legs).
 * - It keeps a cloned checkpoint every `CHECKPOINT_INTERVAL` steps for the project revision it
 *   last walked. The next walk re-walks from the last checkpoint at or before the first changed
 *   step (a step or its group replaced; the character, route profile or custom quests replaced
 *   re-walk everything), or continues from the working state when steps were only appended.
 * - `stateBefore(i)` answers "the state at the selected step" from the nearest checkpoint.
 *
 * Deterministic: no clock, no randomness; the same project and context give the same records.
 */

export const CHECKPOINT_INTERVAL = 256;

export interface RouteWalker {
  readonly context: EngineContext;
  /** Walks `project`, re-using what the previous walk computed before its first change. */
  walk(project: WalkProject, visitors?: readonly WalkVisitor[]): RouteWalk;
  /**
   * Makes the next walk re-compute from `fromIndex` (default 0), for changes the walker cannot see:
   * for example navigation legs that arrived in the leg table behind the same travel model.
   */
  invalidate(fromIndex?: number): void;
  /**
   * A copy of the state before step `index` of the last walk; `index` equal to the step count gives
   * the state after the last step. Rebuilt from the nearest checkpoint at or before `index`.
   */
  stateBefore(index: number): ReadonlyCharacterState;
  /** The distinct legs the last walk asked the travel model for (terrain-navigation.md §9.4). */
  legs(): TravelPair[];
  /** The step indices of the checkpoints held (each the state before that step). */
  checkpointIndices(): number[];
}

/** The first step index whose inputs differ between two projects (the step count when none do). */
function firstChange(previous: WalkProject, next: WalkProject): number {
  if (previous.character !== next.character || previous.routeProfile !== next.routeProfile || previous.customQuests !== next.customQuests) return 0;
  const before = previous.route.steps;
  const after = next.route.steps;
  if (previous.route === next.route) return after.length;
  const sameGroups = previous.route.groups === next.route.groups;
  const shared = Math.min(before.length, after.length);
  for (let i = 0; i < shared; i += 1) {
    const step = after[i];
    if (step === undefined || before[i] !== step) return i;
    if (!sameGroups && step.groupId !== null && routeGroup(previous.route, step.groupId) !== routeGroup(next.route, step.groupId)) return i;
  }
  return shared;
}

export function createRouteWalker(context: EngineContext): RouteWalker {
  const recorder: LegRecorder = { current: null };
  const places = createPlaces(context);
  const curve = xpCurveOf(context.rules);
  const base = {
    context,
    dataset: context.dataset,
    rules: context.rules,
    curve,
    levelInputs: {
      table: curve.basis,
      tableKeys: markedKeys(context.rules, ['xpToNextLevel']),
      cap: ruleInput(context.rules.values.maxLevel),
      capKeys: markedKeys(context.rules, ['maxLevel']),
    },
    graph: context.graph,
    places,
    model: recordingModel(context.travel, recorder),
    recorder,
    sim: sharedSimCache(context.rules, context.dataset),
    acceptPolicy: context.acceptPolicy ?? createBasicAcceptPolicy(context.dataset),
  };

  let previous: WalkProject | null = null;
  let env: WalkEnv | null = null;
  let records: StepRecord[] = [];
  let estimates: StepEstimate[] = [];
  let checkpoints: Checkpoint[] = [];
  let working: WalkerState | null = null;
  /** How many steps the working state has run. */
  let workingAt = 0;
  let dirtyFrom = Number.POSITIVE_INFINITY;

  const initial = (project: WalkProject): WalkerState => createInitialState(project.character, { dataset: context.dataset, rules: context.rules, graph: context.graph, places });

  function walk(project: WalkProject, visitors: readonly WalkVisitor[] = []): RouteWalk {
    const steps = project.route.steps;
    const changed = previous === null ? 0 : firstChange(previous, project);
    if (env === null || previous === null || changed === 0 || previous.character !== project.character || previous.routeProfile !== project.routeProfile || previous.customQuests !== project.customQuests) {
      env = createWalkEnv(base, project);
    }
    const walkEnv = env;
    let from = Math.min(changed, dirtyFrom, steps.length);
    dirtyFrom = Number.POSITIVE_INFINITY;

    let state: WalkerState;
    if (working === null || from === 0) {
      from = 0;
      checkpoints = [];
      state = initial(project);
    } else if (from === workingAt) {
      state = working;
    } else {
      const k = Math.max(0, Math.min(Math.floor(from / CHECKPOINT_INTERVAL), checkpoints.length - 1));
      const saved = checkpoints[k];
      if (saved === undefined) {
        from = 0;
        checkpoints = [];
        state = initial(project);
      } else {
        from = k * CHECKPOINT_INTERVAL;
        checkpoints = checkpoints.slice(0, k + 1);
        state = restoreCheckpoint(saved, working);
      }
    }
    working = state;
    previous = project;
    // Until the loop finishes, the working state matches no step count (a visitor may throw).
    workingAt = -1;
    records = records.slice(0, from);
    estimates = estimates.slice(0, from);
    for (const visitor of visitors) visitor.begin?.({ fromIndex: from, state: state.state, project });

    for (let index = from; index < steps.length; index += 1) {
      const step = steps[index];
      if (step === undefined) continue;
      if (index % CHECKPOINT_INTERVAL === 0 && index / CHECKPOINT_INTERVAL === checkpoints.length) checkpoints.push(checkpointOf(state));
      const group = step.groupId === null ? null : routeGroup(project.route, step.groupId);
      const active = stepActivity(walkEnv, state.state, state.memo, step, group);
      const visit: StepVisit | null = visitors.length === 0 ? null : { index, step, group, active, state: state.state };
      if (visit !== null) for (const visitor of visitors) visitor.enter?.(visit);
      const record = runStep(walkEnv, state.state, state.memo, step, index, group, active);
      records.push(record);
      estimates.push(record.estimate);
      if (visit !== null) for (const visitor of visitors) visitor.leave?.(visit, record);
    }
    workingAt = steps.length;
    recorder.current = null;

    const result: RouteWalk = { project, records, estimates, fromIndex: from, final: state.state };
    for (const visitor of visitors) visitor.end?.(result);
    return result;
  }

  function stateBefore(index: number): ReadonlyCharacterState {
    if (previous === null || env === null || working === null) throw new Error('stateBefore needs a walk first');
    const steps = previous.route.steps;
    if (!Number.isInteger(index) || index < 0 || index > steps.length) {
      throw new RangeError(`Invalid step index ${String(index)}: expected an integer from 0 to ${String(steps.length)}`);
    }
    if (index === workingAt) return cloneState(working.state);
    const k = Math.min(Math.floor(index / CHECKPOINT_INTERVAL), checkpoints.length - 1);
    const saved = checkpoints[k];
    const scratch = saved === undefined ? initial(previous) : restoreCheckpoint(saved, working);
    for (let i = saved === undefined ? 0 : k * CHECKPOINT_INTERVAL; i < index; i += 1) {
      const step = steps[i];
      if (step === undefined) continue;
      const group = step.groupId === null ? null : routeGroup(previous.route, step.groupId);
      runStep(env, scratch.state, scratch.memo, step, i, group, stepActivity(env, scratch.state, scratch.memo, step, group));
    }
    recorder.current = null;
    return scratch.state;
  }

  return {
    context,
    walk,
    invalidate(fromIndex = 0) {
      dirtyFrom = Math.min(dirtyFrom, Math.max(0, fromIndex));
    },
    stateBefore,
    legs: () => enumerateLegs(records),
    checkpointIndices: () => checkpoints.map((_, k) => k * CHECKPOINT_INTERVAL),
  };
}

/** A one-off walk (no re-use between calls). */
export function walkRoute(project: WalkProject, context: EngineContext, visitors: readonly WalkVisitor[] = []): RouteWalk {
  return createRouteWalker(context).walk(project, visitors);
}

/**
 * The metric sums after each `CHECKPOINT_INTERVAL` steps of a walk, keyed by the last estimate of
 * the prefix. A walker keeps every estimate before the first changed step and makes new ones from
 * there, so an estimate object at an index stands for the same prefix in every walk of that walker
 * lineage (the index is checked too): a re-walk's metrics continue from the last stored prefix
 * before its changes, as its steps continue from a checkpoint.
 */
const METRIC_PREFIXES = new WeakMap<StepEstimate, { readonly index: number; readonly acc: MetricsAccumulator }>();

/**
 * Route metrics of a walk (ARCHITECTURE §9.3), from the character's start level: the same result as
 * `aggregateRouteMetrics(walk.estimates, …)`, summed from the last stored prefix (PERF-07: an edit
 * near the end re-sums at most one interval, not the route).
 */
export function walkMetrics(walk: RouteWalk): RouteMetrics {
  const estimates = walk.estimates;
  let acc: MetricsAccumulator | null = null;
  let from = 0;
  for (let end = Math.floor(estimates.length / CHECKPOINT_INTERVAL) * CHECKPOINT_INTERVAL; end > 0; end -= CHECKPOINT_INTERVAL) {
    const last = estimates[end - 1];
    const stored = last === undefined ? undefined : METRIC_PREFIXES.get(last);
    if (stored?.index === end - 1) {
      acc = copyMetricsAccumulator(stored.acc);
      from = end;
      break;
    }
  }
  acc ??= newMetricsAccumulator();
  for (let end = (Math.floor(from / CHECKPOINT_INTERVAL) + 1) * CHECKPOINT_INTERVAL; end <= estimates.length; end += CHECKPOINT_INTERVAL) {
    accumulateMetrics(acc, estimates, from, end);
    from = end;
    const last = estimates[end - 1];
    if (last !== undefined) METRIC_PREFIXES.set(last, { index: end - 1, acc: copyMetricsAccumulator(acc) });
  }
  accumulateMetrics(acc, estimates, from, estimates.length);
  return metricsOf(acc, estimates, { level: walk.project.character.startLevel });
}
