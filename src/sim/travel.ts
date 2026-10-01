import type { Estimated } from '../domain/estimate';
import type { TrainStep, TravelStep } from '../domain/route';
import type { TravelEndpoint, TravelMethod, TravelModel, TravelSpeeds, TravelWarning } from '../domain/travel';
import { distanceYards } from '../geo/distance';
import { type EffectiveRules, markedKeys } from '../rules/precedence';
import { ridingSpellTier } from '../rules/riding';
import type { RuleKey } from '../rules/ruleset';
import type { SimFact } from './facts';
import { type Basis, basisOf, combine, mergeKeys, ruleInput, withBasis } from './provenance';

/**
 * Movement (docs/SIMULATION.md TIME-1..TIME-3): speeds from the ruleset and the riding state, and
 * ground legs through the injected `TravelModel` (TIME-2 as edited for terrain navigation,
 * terrain-navigation.md §18). The walker decides where a move starts and ends; these functions
 * price it.
 */

export interface RidingState {
  /** 0 none, 1 apprentice, 2 journeyman. */
  readonly trained: 0 | 1 | 2;
  readonly speedBonus: number;
}

/** The speed bonus of a riding tier (`mountSpeedBonus[tier - 1]`, 0 for none). */
export function ridingSpeedBonus(trained: 0 | 1 | 2, rules: EffectiveRules): number {
  if (trained === 0) return 0;
  const bonus = rules.values.mountSpeedBonus.value[trained - 1];
  if (bonus === undefined) throw new RangeError(`The ruleset has no mount speed bonus for riding tier ${String(trained)}`);
  return bonus;
}

/** TIME-3 start: `character.riding` applied as declared. */
export function initialRiding(trained: 0 | 1 | 2, rules: EffectiveRules): RidingState {
  return { trained, speedBonus: ridingSpeedBonus(trained, rules) };
}

export interface RidingTraining {
  /** False when the step is not a riding step (neither `skill: 'riding'` nor a riding spell id). */
  readonly recognised: boolean;
  readonly tier: 1 | 2 | null;
  /** The riding state after the step (unchanged when the level is too low and known). */
  readonly riding: RidingState;
  readonly used: readonly RuleKey[];
  readonly facts: readonly SimFact[];
}

/**
 * TIME-3: a `train` step and riding. Tier: `rank` when given, else the spell's tier, else
 * `trained + 1`, capped at 2. Below the tier's mount level the step changes nothing and records
 * `riding-too-low`, unless XP is uncertain (`unknownXpEvents > 0`): then the tier is applied and
 * the fact is `uncertain`. The step's trainer time is `interactionTime({ kind: 'train' })`.
 */
export function trainRiding(
  step: Pick<TrainStep, 'skill' | 'spellId' | 'rank'>,
  state: { readonly level: number; readonly unknownXpEvents: number; readonly riding: RidingState },
  rules: EffectiveRules,
): RidingTraining {
  const spellTier = ridingSpellTier(rules.values.ridingSpells.value, step.spellId);
  if (step.skill !== 'riding' && spellTier === null) {
    return { recognised: false, tier: null, riding: state.riding, used: [], facts: [] };
  }
  const read: RuleKey[] = ['mountLevels', 'mountSpeedBonus'];
  if (spellTier !== null) read.push('ridingSpells');
  const rank = step.rank !== null && Number.isInteger(step.rank) && step.rank >= 1 ? step.rank : null;
  const tier: 1 | 2 = Math.min(2, rank ?? spellTier ?? state.riding.trained + 1) === 1 ? 1 : 2;
  const requiredLevel = rules.values.mountLevels.value[tier - 1] ?? 0;
  const facts: SimFact[] = [];
  if (state.level < requiredLevel) {
    const uncertain = state.unknownXpEvents > 0;
    facts.push({ kind: 'riding-too-low', tier, requiredLevel, level: state.level, uncertain });
    if (!uncertain) return { recognised: true, tier, riding: state.riding, used: markedKeys(rules, read), facts };
  }
  const trained: 1 | 2 = Math.max(state.riding.trained, tier) === 1 ? 1 : 2;
  return { recognised: true, tier, riding: initialRiding(trained, rules), used: markedKeys(rules, read), facts };
}

/** How a step travels (TIME-2): quest, vendor, train and grind steps travel as `'auto'`. */
export type TravelMode = TravelStep['mode'];

export interface StepSpeeds {
  readonly speeds: TravelSpeeds;
  readonly mounted: boolean;
  /** Provenance of the ground speed (run speed and, when mounted, the mount bonus). */
  readonly basis: Basis;
  readonly used: readonly RuleKey[];
  readonly facts: readonly SimFact[];
}

/**
 * TIME-1/TIME-2: the speeds of a move. Mounted means mode `'mount'`, or `'auto'` (and
 * `'transport'`, for its walks) with riding trained; `'mount'` before riding is trained travels on
 * foot and records `mount-untrained`. `'walk'` is on foot at run speed, not the 2.5 yd/s walk.
 * Swimming is at `swimSpeed` whether mounted or not (navigation legs only).
 */
export function travelSpeeds(mode: TravelMode, riding: RidingState, rules: EffectiveRules): StepSpeeds {
  const { runSpeed, swimSpeed, mountSpeedBonus } = rules.values;
  const facts: SimFact[] = [];
  if (mode === 'mount' && riding.trained === 0) facts.push({ kind: 'mount-untrained' });
  const mounted = riding.trained > 0 && mode !== 'walk';
  const read: RuleKey[] = mounted ? ['runSpeed', 'mountSpeedBonus'] : ['runSpeed'];
  const inputs = mounted ? [ruleInput(runSpeed), ruleInput(mountSpeedBonus)] : [ruleInput(runSpeed)];
  return {
    speeds: { groundYps: runSpeed.value * (1 + (mounted ? riding.speedBonus : 0)), swimYps: swimSpeed.value },
    mounted,
    basis: combine(inputs, false),
    used: markedKeys(rules, read),
    facts,
  };
}

const NO_FACTS: readonly SimFact[] = [];
/** By rules, then by the speeds' `used` list: a leg's `used` per (straight-line?, navigation?) slot. */
const LEG_USED = new WeakMap<EffectiveRules, WeakMap<readonly RuleKey[], (readonly RuleKey[] | undefined)[]>>();

/**
 * A leg's `used`: `speedsUsed` with `groundDetourFactor` (a straight-line leg) and `swimSpeed`
 * (the navigation model) when marked. Memoised per input: every leg of a walk asks for one of four
 * lists, and one shared list also lets the engine's merges skip it.
 */
function legUsed(rules: EffectiveRules, speedsUsed: readonly RuleKey[], straight: boolean, navigation: boolean): readonly RuleKey[] {
  let byRules = LEG_USED.get(rules);
  if (byRules === undefined) {
    byRules = new WeakMap();
    LEG_USED.set(rules, byRules);
  }
  let slots = byRules.get(speedsUsed);
  if (slots === undefined) {
    slots = [];
    byRules.set(speedsUsed, slots);
  }
  const slot = (straight ? 1 : 0) + (navigation ? 2 : 0);
  let used = slots[slot];
  if (used === undefined) {
    const read: RuleKey[] = [];
    if (straight) read.push('groundDetourFactor');
    if (navigation) read.push('swimSpeed');
    used = mergeKeys(speedsUsed, markedKeys(rules, read));
    slots[slot] = used;
  }
  return used;
}

/** Where a ground move could not be priced, or how it was. */
export type GroundOutcome = 'leg' | 'arrived' | 'cross-map' | 'from-unknown' | 'to-unknown';

export interface GroundTravel {
  /** Unknown unless `outcome` is `leg` or `arrived` (TIME-13). */
  readonly seconds: Estimated<number>;
  readonly outcome: GroundOutcome;
  /** Straight-line yards between the endpoints, or null when unknown or across maps. */
  readonly straightYards: number | null;
  readonly method: TravelMethod | null;
  readonly pending: boolean;
  readonly warnings: readonly TravelWarning[];
  readonly used: readonly RuleKey[];
  /** `travel-warning` per warning and `pending-leg`, in that order. */
  readonly facts: readonly SimFact[];
}

const notPriced = (outcome: GroundOutcome, straightYards: number | null = null): GroundTravel => ({
  seconds: { value: null, basis: 'unknown', eraFallback: false },
  outcome,
  straightYards,
  method: null,
  pending: false,
  warnings: [],
  used: [],
  facts: [],
});

/**
 * TIME-2 (terrain-navigation.md §18): a ground move priced by the `TravelModel`.
 *
 * - From an unknown position (`from` null) or to an unresolved one (`to` null): unknown; the walker
 *   records SIM-3 where TIME-2 says so.
 * - Across world maps: unknown with outcome `cross-map`; the walker then tries the TravelGraph
 *   (hearth, transport, entrance edge) and records SIM-4 if none applies.
 * - Within the arrival radius (`radius` yards, `Location.radius` or `Waypoint.radius`): 0 s, no leg.
 * - Otherwise `leg.seconds × max(0, d − radius) / d`, where `d` is the straight-line distance: the
 *   straight-line model gives exactly `(d − radius) × groundDetourFactor / speed`, and a navigation
 *   leg is shortened in the same proportion (an assumption). The leg's basis combines with the
 *   speeds' basis; its warnings and pending flag pass through as facts.
 */
export function groundTravel(
  from: TravelEndpoint | null,
  to: TravelEndpoint | null,
  radius: number | null,
  speeds: StepSpeeds,
  model: TravelModel,
  rules: EffectiveRules,
): GroundTravel {
  if (from === null) return notPriced('from-unknown');
  if (to === null) return notPriced('to-unknown');
  const yards = distanceYards(from.point, to.point);
  if (yards === null) return notPriced('cross-map');
  const reach = Math.max(0, yards - Math.max(0, radius ?? 0));
  if (reach === 0) {
    return { ...notPriced('arrived', yards), seconds: withBasis(0, speeds.basis), used: speeds.used };
  }
  const leg = model.leg(from, to, speeds.speeds);
  let facts: readonly SimFact[] = NO_FACTS;
  if (leg.warnings.length > 0 || leg.pending) {
    const list: SimFact[] = leg.warnings.map((warning) => ({ kind: 'travel-warning', warning }));
    if (leg.pending) list.push({ kind: 'pending-leg' });
    facts = list;
  }
  const legSeconds = leg.seconds.value;
  const seconds =
    legSeconds === null
      ? withBasis<number>(null, basisOf(leg.seconds))
      : withBasis((legSeconds * reach) / yards, combine([basisOf(leg.seconds), speeds.basis]));
  return {
    seconds,
    outcome: 'leg',
    straightYards: yards,
    method: leg.method,
    pending: leg.pending,
    warnings: leg.warnings,
    used: legUsed(rules, speeds.used, leg.method === 'straight-line', model.id === 'navigation'),
    facts,
  };
}

