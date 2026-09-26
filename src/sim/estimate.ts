import type { Estimated } from '../domain/estimate';
import type { StepId } from '../domain/ids';
import type { RuleKey } from '../rules/ruleset';
import type { SimFact } from './facts';
import { RULE_KEYS } from '../rules/ruleset';
import { type Basis, combine, RULE_KEY_INDEX, withBasis } from './provenance';

/**
 * Per-step estimates and route metrics (docs/ARCHITECTURE.md §9.3, docs/SIMULATION.md TIME-13, §8).
 * The engine walks the route and builds one `StepEstimate` per step from the parts the time, XP and
 * travel functions return; `aggregateRouteMetrics` sums them.
 */

/** Seconds per kind of work (ARCHITECTURE §9.3). Only known parts are recorded (TIME-13). */
export interface StepBreakdown {
  readonly travel: number;
  readonly combat: number;
  readonly interaction: number;
  readonly objective: number;
  readonly waiting: number;
}

export type TimeBucket = keyof StepBreakdown;

export const TIME_BUCKETS: readonly TimeBucket[] = ['travel', 'combat', 'interaction', 'objective', 'waiting'];

/** One priced piece of a step's time. */
export interface TimePart {
  readonly bucket: TimeBucket;
  readonly seconds: Estimated<number>;
}

export interface StepDuration {
  /** Unknown when any part is unknown (TIME-13); otherwise the sum with the combined basis. */
  readonly duration: Estimated<number>;
  /** The known parts per bucket. */
  readonly breakdown: StepBreakdown;
  /** What the step adds to `timeSec`: the known parts only (TIME-13). */
  readonly knownSeconds: number;
}

const ZERO_STEP: Estimated<number> = { value: 0, basis: 'derived', eraFallback: false };
const UNKNOWN_STEP: Estimated<number> = { value: null, basis: 'unknown', eraFallback: false };

/**
 * TIME-13: a step's duration from its parts. No parts is 0 s, `derived`; one part keeps its own
 * estimate; several are summed with the combined basis (`sumEstimates`, computed inline: it runs
 * once per step of every walk).
 */
export function stepDuration(parts: readonly TimePart[]): StepDuration {
  const breakdown = { travel: 0, combat: 0, interaction: 0, objective: 0, waiting: 0 };
  let knownSeconds = 0;
  let unknown = false;
  let assumed = false;
  let eraFallback = false;
  for (const part of parts) {
    const seconds = part.seconds;
    if (seconds.value === null) {
      unknown = true;
      continue;
    }
    breakdown[part.bucket] += seconds.value;
    knownSeconds += seconds.value;
    if (seconds.basis === 'assumption') assumed = true;
    if (seconds.eraFallback) eraFallback = true;
  }
  let duration: Estimated<number>;
  if (parts.length === 1) duration = parts[0]?.seconds ?? ZERO_STEP;
  else if (parts.length === 0) duration = ZERO_STEP;
  else if (unknown) duration = UNKNOWN_STEP;
  else duration = { value: knownSeconds, basis: assumed ? 'assumption' : 'derived', eraFallback };
  return { duration, breakdown, knownSeconds };
}

/**
 * TIME-8: a `durationOverride` replaces the step's own work (interaction, objective and combat
 * parts) with one part of `override` seconds in `bucket`, basis `assumption`; travel and waiting
 * are still computed. Kill XP is not affected (TIME-9).
 */
export function applyDurationOverride(parts: readonly TimePart[], override: number, bucket: 'interaction' | 'objective' | 'combat'): TimePart[] {
  if (!Number.isFinite(override) || override < 0) throw new RangeError(`Invalid duration override ${String(override)}`);
  const kept = parts.filter((part) => part.bucket === 'travel' || part.bucket === 'waiting');
  return [...kept, { bucket, seconds: { value: override, basis: 'assumption', eraFallback: false } }];
}

/** `levelAfter` (SIMULATION §8): the level with the combined basis of every XP grant so far. */
export function levelEstimate(level: number, xpBasis: Basis): Estimated<number> {
  return withBasis(level, xpBasis);
}

export interface StepEstimate {
  readonly stepId: StepId;
  readonly index: number;
  /** False for a step filtered out; `'unknown'` when its condition is unknown (it stays active, SIM-13). */
  readonly active: boolean | 'unknown';
  readonly startSec: number;
  readonly endSec: number;
  readonly duration: Estimated<number>;
  readonly xpGained: Estimated<number>;
  /** XP into `levelAfter` (the known-XP lower bound while `levelIsLowerBound`). */
  readonly xpAfter: number;
  readonly levelAfter: Estimated<number>;
  /** True while `unknownXpEvents > 0` (XP-4). */
  readonly levelIsLowerBound: boolean;
  readonly breakdown: StepBreakdown;
  /** Rule keys with basis `assumption` or `era-assumed` the step read (SIMULATION §8). */
  readonly assumptionsUsed: readonly RuleKey[];
  /** What the validator turns into issues, and what the UI shows as pending (src/sim/facts.ts). */
  readonly facts: readonly SimFact[];
}

export interface RouteMetrics {
  /** The known sum of step durations (TIME-13). */
  readonly duration: Estimated<number>;
  /** True when some step's time is unknown: the route takes at least `duration`. */
  readonly durationIsLowerBound: boolean;
  readonly stepsWithUnknownTime: number;
  /** Known XP gained over the route (quest and kill XP). */
  readonly xpGained: Estimated<number>;
  /** Steps whose XP was unknown; the XP and level are then lower bounds. */
  readonly unknownXpSteps: number;
  readonly levelReached: Estimated<number>;
  readonly levelIsLowerBound: boolean;
  /** Known XP per hour of known time; unknown when no known time has passed. */
  readonly xpPerHour: Estimated<number>;
  /** Fractions of the known time (null when it is 0), each with the basis of its parts. */
  readonly shares: {
    readonly travel: Estimated<number>;
    readonly combatAndObjective: Estimated<number>;
    readonly interaction: Estimated<number>;
    readonly waiting: Estimated<number>;
  };
  /** Legs still being computed (their seconds are the fallback). */
  readonly pendingLegs: number;
  readonly eraFallback: boolean;
  readonly assumptionsUsed: readonly RuleKey[];
}

/**
 * The running sums of `aggregateRouteMetrics` over a prefix of the estimates: the known seconds per
 * bucket, the known XP, the counts, the combined bases as flags (no per-step objects), and the
 * rule keys as marks by RULE_KEYS index. The summation order is the estimates' order, so a sum
 * continued from a stored prefix equals a full one exactly.
 */
export interface MetricsAccumulator {
  travel: number;
  combat: number;
  interaction: number;
  objective: number;
  waiting: number;
  seconds: number;
  xp: number;
  stepsWithUnknownTime: number;
  unknownXpSteps: number;
  pendingLegs: number;
  durationAssumed: boolean;
  durationEraFallback: boolean;
  xpAssumed: boolean;
  xpEraFallback: boolean;
  /** 1 at the RULE_KEYS index of every key some step listed. */
  readonly keys: Uint8Array;
}

export function newMetricsAccumulator(): MetricsAccumulator {
  return {
    travel: 0,
    combat: 0,
    interaction: 0,
    objective: 0,
    waiting: 0,
    seconds: 0,
    xp: 0,
    stepsWithUnknownTime: 0,
    unknownXpSteps: 0,
    pendingLegs: 0,
    durationAssumed: false,
    durationEraFallback: false,
    xpAssumed: false,
    xpEraFallback: false,
    keys: new Uint8Array(RULE_KEYS.length),
  };
}

export function copyMetricsAccumulator(from: MetricsAccumulator): MetricsAccumulator {
  return { ...from, keys: from.keys.slice() };
}

/** Adds `estimates[from..to)` to `acc`. A list of keys seen just before is skipped (steps share lists). */
export function accumulateMetrics(acc: MetricsAccumulator, estimates: readonly StepEstimate[], from: number, to: number): void {
  let lastKeys: readonly RuleKey[] | null = null;
  for (let i = from; i < to; i += 1) {
    const step = estimates[i];
    if (step === undefined) continue;
    const b = step.breakdown;
    acc.travel += b.travel;
    acc.combat += b.combat;
    acc.interaction += b.interaction;
    acc.objective += b.objective;
    acc.waiting += b.waiting;
    acc.seconds += b.travel + b.combat + b.interaction + b.objective + b.waiting;
    const d = step.duration;
    if (d.value === null) acc.stepsWithUnknownTime += 1;
    else {
      if (d.basis === 'assumption') acc.durationAssumed = true;
      if (d.eraFallback) acc.durationEraFallback = true;
    }
    const g = step.xpGained;
    if (g.value === null) acc.unknownXpSteps += 1;
    else {
      acc.xp += g.value;
      if (g.basis === 'assumption') acc.xpAssumed = true;
      if (g.eraFallback) acc.xpEraFallback = true;
    }
    for (const fact of step.facts) if (fact.kind === 'pending-leg') acc.pendingLegs += 1;
    const keys = step.assumptionsUsed;
    if (keys.length === 0 || keys === lastKeys) continue;
    lastKeys = keys;
    for (const key of keys) {
      const index = RULE_KEY_INDEX.get(key);
      if (index !== undefined) acc.keys[index] = 1;
    }
  }
}

/** The metrics of an accumulator over all of `estimates` (the last one gives the level reached). */
export function metricsOf(acc: MetricsAccumulator, estimates: readonly StepEstimate[], start: { readonly level: number }): RouteMetrics {
  const assumptionsUsed: RuleKey[] = [];
  for (let index = 0; index < acc.keys.length; index += 1) {
    const key = RULE_KEYS[index];
    if (acc.keys[index] === 1 && key !== undefined) assumptionsUsed.push(key);
  }
  const last = estimates.at(-1);
  const seconds = acc.seconds;
  const xp = acc.xp;
  // combine() of the known durations' and grants' bases: computed sums, so `derived` unless assumed.
  const durationBasis: Basis = { basis: acc.durationAssumed ? 'assumption' : 'derived', eraFallback: acc.durationEraFallback };
  const xpBasis: Basis = { basis: acc.xpAssumed ? 'assumption' : 'derived', eraFallback: acc.xpEraFallback };
  const duration = withBasis(seconds, durationBasis);
  const xpGained = withBasis(xp, xpBasis);
  const levelReached = last === undefined ? withBasis(start.level, combine([], false)) : last.levelAfter;
  const share = (part: number, bases: Basis): Estimated<number> => (seconds > 0 ? withBasis(part / seconds, bases) : withBasis<number>(null, bases));
  return {
    duration,
    durationIsLowerBound: acc.stepsWithUnknownTime > 0,
    stepsWithUnknownTime: acc.stepsWithUnknownTime,
    xpGained,
    unknownXpSteps: acc.unknownXpSteps,
    levelReached,
    levelIsLowerBound: last?.levelIsLowerBound ?? false,
    xpPerHour: seconds > 0 ? withBasis((xp * 3600) / seconds, combine([durationBasis, xpBasis])) : withBasis<number>(null, durationBasis),
    shares: {
      travel: share(acc.travel, durationBasis),
      combatAndObjective: share(acc.combat + acc.objective, durationBasis),
      interaction: share(acc.interaction, durationBasis),
      waiting: share(acc.waiting, durationBasis),
    },
    pendingLegs: acc.pendingLegs,
    eraFallback: durationBasis.eraFallback || xpBasis.eraFallback || levelReached.eraFallback,
    assumptionsUsed,
  };
}

/**
 * Route metrics from the step estimates (ARCHITECTURE §9.3): duration, XP, level reached, XP per
 * hour and the shares of travel, combat and objective work, interaction and waiting, each with its
 * basis. `start` is the character's starting level (basis `source`).
 */
export function aggregateRouteMetrics(estimates: readonly StepEstimate[], start: { readonly level: number }): RouteMetrics {
  const acc = newMetricsAccumulator();
  accumulateMetrics(acc, estimates, 0, estimates.length);
  return metricsOf(acc, estimates, start);
}
