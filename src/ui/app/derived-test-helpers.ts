import { createDerivedStore, type DerivedResults, type DerivedState, type DerivedStoreHandle, IDLE_PATHS } from '../../app/derived';
import { projectRules } from '../../app/derived-context';
import type { Estimated } from '../../domain/estimate';
import type { StepId } from '../../domain/ids';
import type { ValidationIssue } from '../../domain/issues';
import type { ProjectV1 } from '../../domain/project';
import type { RuleKey } from '../../rules/ruleset';
import type { RouteMetrics, StepEstimate } from '../../sim/estimate';
import type { SimFact } from '../../sim/facts';

/**
 * Hand-built derived results for the ui's tests: the numbers a walk would publish, chosen per step,
 * so a test states exactly which estimate is assumed, unknown or pending. The effective rules are
 * the real ones (`projectRules`). Records are empty: the ui never reads them.
 */

export const known = (value: number, basis: 'source' | 'derived' | 'assumption' = 'derived', eraFallback = false): Estimated<number> => ({
  value,
  basis,
  eraFallback,
});

export const unknownValue: Estimated<number> = { value: null, basis: 'unknown', eraFallback: false };

/** What a test says about one step; everything else is a known, derived, zero-cost step at level 1. */
export interface StepSpec {
  readonly duration?: Estimated<number>;
  readonly xpGained?: Estimated<number>;
  readonly level?: number;
  readonly levelBasis?: Estimated<number>['basis'];
  readonly eraFallback?: boolean;
  readonly xpAfter?: number;
  readonly lowerBound?: boolean;
  readonly facts?: readonly SimFact[];
  readonly assumptionsUsed?: readonly RuleKey[];
  readonly travel?: number;
}

function estimateOf(stepId: StepId, index: number, spec: StepSpec, startSec: number): StepEstimate {
  const duration = spec.duration ?? known(0);
  const seconds = duration.value ?? 0;
  const travel = Math.min(spec.travel ?? 0, seconds);
  return {
    stepId,
    index,
    active: true,
    startSec,
    endSec: startSec + seconds,
    duration,
    xpGained: spec.xpGained ?? known(0),
    xpAfter: spec.xpAfter ?? 0,
    levelAfter: { value: spec.level ?? 1, basis: spec.levelBasis ?? 'source', eraFallback: spec.eraFallback ?? false },
    levelIsLowerBound: spec.lowerBound ?? false,
    breakdown: { travel, combat: 0, interaction: seconds - travel, objective: 0, waiting: 0 },
    assumptionsUsed: spec.assumptionsUsed ?? [],
    facts: spec.facts ?? [],
  };
}

export interface ResultsOptions {
  /** Per step, by index; missing steps are plain. */
  readonly steps?: readonly StepSpec[];
  readonly issues?: readonly ValidationIssue[];
  readonly revision?: number;
  readonly final?: boolean;
  readonly metrics?: Partial<RouteMetrics>;
}

/** Results for `project` as a walk of it would publish them. */
export function derivedResults(project: ProjectV1, options: ResultsOptions = {}): DerivedResults {
  const steps = project.route.steps;
  let time = 0;
  const estimates = steps.map((step, index) => {
    const estimate = estimateOf(step.id, index, options.steps?.[index] ?? {}, time);
    time = estimate.endSec;
    return estimate;
  });
  const issues = options.issues ?? [];
  const stepIssues = steps.map((step) => issues.filter((issue) => issue.stepId === step.id));
  const pendingLegs = estimates.reduce((n, e) => n + e.facts.filter((f) => f.kind === 'pending-leg').length, 0);
  const knownTime = estimates.reduce((n, e) => n + (e.duration.value ?? 0), 0);
  const xp = estimates.reduce((n, e) => n + (e.xpGained.value ?? 0), 0);
  const last = estimates.at(-1);
  const metrics: RouteMetrics = {
    duration: known(knownTime, 'assumption'),
    durationIsLowerBound: estimates.some((e) => e.duration.value === null),
    stepsWithUnknownTime: estimates.filter((e) => e.duration.value === null).length,
    xpGained: known(xp, 'assumption', true),
    unknownXpSteps: estimates.filter((e) => e.xpGained.value === null).length,
    levelReached: last?.levelAfter ?? known(project.character.startLevel, 'source'),
    levelIsLowerBound: last?.levelIsLowerBound ?? false,
    xpPerHour: knownTime > 0 ? known((xp * 3600) / knownTime, 'assumption', true) : unknownValue,
    shares: {
      travel: knownTime > 0 ? known(0.5, 'assumption') : unknownValue,
      combatAndObjective: knownTime > 0 ? known(0.25, 'assumption') : unknownValue,
      interaction: knownTime > 0 ? known(0.25, 'assumption') : unknownValue,
      waiting: knownTime > 0 ? known(0, 'assumption') : unknownValue,
    },
    pendingLegs,
    eraFallback: true,
    assumptionsUsed: ['killSeconds', 'runSpeed'],
    ...options.metrics,
  };
  const final = options.final ?? pendingLegs === 0;
  return {
    revision: options.revision ?? 0,
    project,
    records: [],
    estimates,
    metrics,
    issues,
    stepIssues,
    rules: projectRules(project.rulesetId, project.assumptions),
    travelModel: 'straight-line',
    pendingLegs,
    pendingSteps: estimates.filter((e) => e.facts.some((f) => f.kind === 'pending-leg')).length,
    final,
    walkedFrom: 0,
    timing: { walkMs: 0, metricsMs: 0, sinceChangeMs: 0 },
  };
}

/** A ready derived state around `results` (straight-line travel, nothing computing). */
export function readyState(results: DerivedResults, patch: Partial<DerivedState> = {}): DerivedState {
  return {
    status: 'ready',
    failure: null,
    results,
    selected: null,
    travel: { model: 'straight-line', reason: 'this deploy has no navigation data', revision: 'straight-line', unavailableMaps: [], unavailableAll: false },
    paths: IDLE_PATHS,
    ...patch,
  };
}

/**
 * A derived store holding `state`, with its path actions recorded. `resume` is what Resume
 * publishes: `running` at once, or `idle` first, as the real pipeline does until the walk that asks
 * for the pending legs again.
 */
export function derivedStoreWith(state: DerivedState, resume: 'running' | 'idle' = 'running'): DerivedStoreHandle & { readonly calls: string[] } {
  const handle = createDerivedStore(state);
  const calls: string[] = [];
  handle.attach({
    cancelPaths: () => {
      calls.push('cancel');
      handle.publish({ paths: { ...handle.store.getState().paths, state: 'paused' } });
    },
    resumePaths: () => {
      calls.push('resume');
      handle.publish({ paths: { ...handle.store.getState().paths, state: resume } });
    },
    computePaths: () => Promise.reject(new Error('not in these tests')),
    stateBefore: () => null,
  });
  return { ...handle, calls };
}

/** An issue as the validator emits it (every key present). */
export function issue(code: string, severity: ValidationIssue['severity'], stepId: StepId | null, message: string): ValidationIssue {
  return { code, severity, stepId, questId: null, message, data: null };
}
