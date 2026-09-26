import type { DatasetView, NpcRecord, ObjectiveDef } from '../domain/dataset';
import type { Estimated } from '../domain/estimate';
import type { NpcId, QuestId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import { distanceYards } from '../geo/distance';
import { type EffectiveRules, markedKeys } from '../rules/precedence';
import type { RuleKey } from '../rules/ruleset';
import type { SimFact } from './facts';
import { type KillPlace, killXp, mobLevelOf } from './kill-xp';
import { ASSUMPTION, type Basis, basisOf, combine, mergeKeys, ruleInput, UNKNOWN, withBasis } from './provenance';

/**
 * Objective work (docs/SIMULATION.md TIME-9..TIME-11). QuestieDB has no objective counts, so each
 * target gets one assumed work count, used for both its time and its kill XP (DSO-05): time and XP
 * stay consistent. The kill XP of a step is granted once, after the work (a simplification).
 */

/** What the objective rules read from the dataset (the project's `DatasetView` satisfies it). */
export type ObjectiveLookup = Pick<DatasetView, 'npc' | 'item' | 'spawns'>;

export interface ObjectiveWorkInput {
  readonly questId: QuestId;
  /** Index into the quest's objectives (Questie ObjectiveData order). */
  readonly index: number;
  readonly objective: ObjectiveDef;
  /** A user-entered count (`QuestOverride.objectiveCounts`); null falls back to the def's count, then the assumption. */
  readonly countOverride: number | null;
  /** The level at the start of the step (the lower bound while XP is uncertain). */
  readonly playerLevel: number;
  /** The step's resolved location, used to choose the drop NPC nearest to it. */
  readonly at: WorldPoint | null;
  readonly place: KillPlace;
}

export interface ObjectiveWork {
  readonly questId: QuestId;
  readonly index: number;
  /** `s` of TIME-9; unknown for reputation objectives and items without a known source. */
  readonly seconds: Estimated<number>;
  /** `x` of TIME-9: the kill XP of the work, 0 for work without kills. Never unknown. */
  readonly killXp: Estimated<number>;
  /** The kill count `k` or use count `u`, or null for work without a count. */
  readonly workCount: number | null;
  /** The NPC whose kills give the XP (`kill`, `killCredit` root, or the chosen drop NPC). */
  readonly npcId: NpcId | null;
  readonly used: readonly RuleKey[];
  readonly facts: readonly SimFact[];
}

/** The drop NPC of an item (TIME-9): the one with a spawn nearest to `at`, else the lowest NPC id. */
export function dropNpcFor(dropNpcs: readonly NpcId[], lookup: ObjectiveLookup, at: WorldPoint | null): NpcId | null {
  const sorted = [...dropNpcs].sort((a, b) => a - b);
  if (at === null) return sorted[0] ?? null;
  let best: NpcId | null = null;
  let bestYards = Number.POSITIVE_INFINITY;
  for (const id of sorted) {
    for (const spawn of lookup.spawns({ kind: 'npc', id })) {
      const yards = spawn.world === null ? null : distanceYards(at, spawn.world);
      if (yards !== null && yards < bestYards) {
        best = id;
        bestYards = yards;
      }
    }
  }
  return best ?? sorted[0] ?? null;
}

const zeroXp: Estimated<number> = { value: 0, basis: 'derived', eraFallback: false };

/**
 * TIME-9: the work of one objective target at its location.
 *
 * | kind | count | seconds | kill XP |
 * |---|---|---|---|
 * | `kill`, `killCredit` (root NPC) | `k = count ?? objectiveKillCount` | `k × killSeconds` | `k × killXp` |
 * | `item` with an NPC drop | `k = ceil((count ?? objectiveItemCount) / itemDropChance)` | `k × (killSeconds + lootSeconds)` | `k × killXp` of the drop NPC |
 * | `item` with only object sources; `object` | `u = count ?? objectiveUseCount` | `u × (objectUseSeconds + objectSearchSeconds)` | 0 |
 * | `spell`, `event` | none | `eventObjectiveSeconds` | 0 |
 * | `reputation`; `item` without a known source | none | unknown (`time-unknown`) | 0 |
 */
export function objectiveWork(input: ObjectiveWorkInput, lookup: ObjectiveLookup, rules: EffectiveRules): ObjectiveWork {
  const values = rules.values;
  const def = input.objective;
  const base = { questId: input.questId, index: input.index };
  const userCount = input.countOverride ?? ('count' in def ? def.count : null);

  const kills = (npcId: NpcId, k: number, secondsEach: number, secondsKeys: readonly RuleKey[], countKeys: readonly RuleKey[]): ObjectiveWork => {
    const npc: NpcRecord | undefined = lookup.npc(npcId);
    const mob = mobLevelOf(npc, values.mobLevelChoice.value, input.playerLevel);
    const each = killXp({ playerLevel: input.playerLevel, mobLevel: mob.level, rank: npc?.rank ?? null, place: input.place }, rules);
    const read = [...secondsKeys, ...countKeys, 'mobLevelChoice' as const];
    const inputs: Basis[] = [ASSUMPTION, ...secondsKeys.map((key) => ruleInput(values[key]))];
    return {
      ...base,
      seconds: withBasis(k * secondsEach, combine(inputs)),
      killXp: withBasis(k * each.xp, combine([ASSUMPTION, each.basis])),
      workCount: k,
      npcId,
      used: mergeKeys(markedKeys(rules, read), each.used),
      facts: mob.assumed ? [{ kind: 'mob-level-assumed', npcId }] : [],
    };
  };

  const uses = (u: number, countKeys: readonly RuleKey[]): ObjectiveWork => ({
    ...base,
    seconds: withBasis(u * (values.objectUseSeconds.value + values.objectSearchSeconds.value), combine([ASSUMPTION, ruleInput(values.objectUseSeconds)])),
    killXp: zeroXp,
    workCount: u,
    npcId: null,
    used: markedKeys(rules, ['objectUseSeconds', 'objectSearchSeconds', ...countKeys]),
    facts: [],
  });

  const unknown = (reason: 'reputation-objective' | 'item-without-source'): ObjectiveWork => ({
    ...base,
    seconds: withBasis<number>(null, UNKNOWN),
    killXp: zeroXp,
    workCount: null,
    npcId: null,
    used: [],
    facts: [{ kind: 'time-unknown', part: 'objective', reason, questId: input.questId, objective: input.index }],
  });

  switch (def.kind) {
    case 'kill':
    case 'killCredit': {
      const npcId = def.kind === 'kill' ? def.npcId : def.rootNpcId;
      const k = userCount ?? values.objectiveKillCount.value;
      return kills(npcId, k, values.killSeconds.value, ['killSeconds'], userCount === null ? ['objectiveKillCount'] : []);
    }
    case 'item': {
      const item = lookup.item(def.itemId);
      const npcId = item === undefined ? null : dropNpcFor(item.dropNpcs, lookup, input.at);
      if (npcId !== null) {
        const wanted = userCount ?? values.objectiveItemCount.value;
        const k = Math.ceil(wanted / values.itemDropChance.value);
        const countKeys: RuleKey[] = userCount === null ? ['objectiveItemCount', 'itemDropChance'] : ['itemDropChance'];
        return kills(npcId, k, values.killSeconds.value + values.lootSeconds.value, ['killSeconds', 'lootSeconds'], countKeys);
      }
      if (item !== undefined && item.dropObjects.length > 0) {
        return uses(userCount ?? values.objectiveUseCount.value, userCount === null ? ['objectiveUseCount'] : []);
      }
      return unknown('item-without-source');
    }
    case 'object':
      return uses(userCount ?? values.objectiveUseCount.value, userCount === null ? ['objectiveUseCount'] : []);
    case 'spell':
    case 'event':
      return {
        ...base,
        seconds: withBasis(values.eventObjectiveSeconds.value, ruleInput(values.eventObjectiveSeconds)),
        killXp: zeroXp,
        workCount: null,
        npcId: null,
        used: markedKeys(rules, ['eventObjectiveSeconds']),
        facts: [],
      };
    case 'reputation':
      return unknown('reputation-objective');
  }
}

export interface CompleteWork {
  /** `S` of TIME-10; unknown when any target's time is unknown (TIME-13). */
  readonly seconds: Estimated<number>;
  /** `floor(f × Σ x)`, over the known targets with `f = 1` when `S` is unknown. */
  readonly killXp: Estimated<number>;
  /** The time-and-XP factor `f = S / Σ s` (1 when `Σ s` is 0 or `S` is unknown). */
  readonly factor: number;
  readonly used: readonly RuleKey[];
  readonly facts: readonly SimFact[];
}

/**
 * TIME-10: several targets in one `complete` step are one work block,
 * `S = max(s) + objectiveConcurrency × (Σ s − max(s))`, and kill XP is scaled by the same factor
 * `f = S / Σ s`. Targets already done are left out by the caller (they contribute nothing).
 */
export function completeWork(targets: readonly ObjectiveWork[], rules: EffectiveRules): CompleteWork {
  const concurrency = rules.values.objectiveConcurrency;
  const facts = targets.flatMap((target) => target.facts);
  const used = mergeKeys(...targets.map((target) => target.used), targets.length > 1 ? markedKeys(rules, ['objectiveConcurrency']) : []);
  const xpBasis = combine(targets.map((target) => basisOf(target.killXp)));
  const xpSum = targets.reduce((sum, target) => sum + (target.killXp.value ?? 0), 0);
  const times = targets.map((target) => target.seconds.value);
  if (times.some((seconds) => seconds === null)) {
    return { seconds: withBasis<number>(null, UNKNOWN), killXp: withBasis(Math.floor(xpSum), xpBasis), factor: 1, used, facts };
  }
  const known = times as number[];
  const total = known.reduce((sum, seconds) => sum + seconds, 0);
  const largest = known.length === 0 ? 0 : Math.max(...known);
  const seconds = largest + concurrency.value * (total - largest);
  const factor = total === 0 ? 1 : seconds / total;
  const inputs = targets.map((target) => basisOf(target.seconds));
  if (targets.length > 1) inputs.push(ruleInput(concurrency));
  return {
    seconds: targets.length === 0 ? withBasis(0, combine([])) : withBasis(seconds, combine(inputs, targets.length > 1)),
    killXp: withBasis(Math.floor(factor * xpSum), targets.length > 1 ? combine([xpBasis, ruleInput(concurrency)]) : xpBasis),
    factor,
    used,
    facts,
  };
}

/**
 * TIME-11: a `partial` step (RXP sticky and `#completewith` windows) costs its override or 0 s
 * ("incidental"), gives no kill XP and marks nothing; the finishing step carries the work.
 */
export function partialWork(durationOverride: number | null): { readonly seconds: Estimated<number>; readonly killXp: Estimated<number> } {
  return { seconds: { value: durationOverride ?? 0, basis: 'assumption', eraFallback: false }, killXp: zeroXp };
}
