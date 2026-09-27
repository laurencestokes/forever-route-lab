import type { EntityRef, ItemRecord, NpcRecord, SpawnPoint } from '../../domain/dataset';
import type { ItemId, NpcId, QuestId } from '../../domain/ids';
import { grind } from '../../sim/grind';
import { completeWork, type ObjectiveLookup, type ObjectiveWork, objectiveWork } from '../../sim/objectives';
import { questXp } from '../../sim/quest-xp';
import { initialRiding, trainRiding } from '../../sim/travel';
import { xpCurveOf, type XpCurve } from '../../sim/xp';
import type { GrindSpec, PricingSlice, SearchProblem, WorkBlock } from './types';

/**
 * Level-dependent pricing in the worker (docs/research/optimizer-m7.md §5.5, §6.2): the `src/sim`
 * functions themselves, called lazily with the pricing slice the problem carries. What depends on
 * the level alone is memoised per (block, level) and (quest, level) in typed arrays; grinds and
 * hearth waits depend on more than the level and are priced per transition. The memo entries are
 * pure functions of the problem, so the order in which they fill cannot change results.
 */

const UNKNOWN_SECONDS = { value: null, basis: 'unknown', eraFallback: false } as const;
const ZERO_XP = { value: 0, basis: 'derived', eraFallback: false } as const;

/** The pricing slice as the `ObjectiveLookup` `src/sim` reads. */
export function sliceLookup(slice: PricingSlice): ObjectiveLookup {
  const npcs = new Map<number, NpcRecord>(slice.npcs.map((npc) => [npc.id, npc]));
  const items = new Map<number, ItemRecord>(slice.items.map((item) => [item.id, item]));
  const spawns = new Map<string, readonly SpawnPoint[]>(slice.spawns.map((entry) => [entry.key, entry.spawns]));
  return {
    npc: (id: NpcId) => npcs.get(id),
    item: (id: ItemId) => items.get(id),
    spawns: (ref: EntityRef) => spawns.get(`${ref.kind}:${String(ref.id)}`) ?? [],
  };
}

export interface GrindPrice {
  /** −1 when unknown (above the table, a gray mob, a zero rate). */
  readonly ms: number;
  readonly xpGained: number;
  readonly level: number;
  readonly xpInto: number;
  readonly resets: boolean;
}

export class Pricing {
  readonly curve: XpCurve;
  private readonly lookup: ObjectiveLookup;
  private readonly slots: number;
  /** Per (block, level): seconds in ms (−1 unknown), NaN until computed. */
  private readonly blockMs: Float64Array;
  private readonly blockXp: Float64Array;
  /** Per (quest, level): quest XP (−1 unknown), NaN until computed. */
  private readonly questXpMemo: Float64Array;

  constructor(private readonly problem: Pick<SearchProblem, 'rules' | 'pricing'>) {
    this.curve = xpCurveOf(problem.rules);
    this.lookup = sliceLookup(problem.pricing);
    this.slots = this.curve.maxLevel + 2;
    this.blockMs = new Float64Array(problem.pricing.blocks.length * this.slots).fill(Number.NaN);
    this.blockXp = new Float64Array(problem.pricing.blocks.length * this.slots).fill(Number.NaN);
    this.questXpMemo = new Float64Array(problem.pricing.questXp.length * this.slots).fill(Number.NaN);
  }

  /** Bytes of the memo tables (search stats). */
  get memoBytes(): number {
    return this.blockMs.byteLength + this.blockXp.byteLength + this.questXpMemo.byteLength;
  }

  private slot(level: number): number {
    return Math.max(0, Math.min(this.slots - 1, level));
  }

  private priceBlock(index: number, level: number): void {
    const spec: WorkBlock | undefined = this.problem.pricing.blocks[index];
    if (spec === undefined) throw new RangeError(`No work block ${String(index)}`);
    const rules = this.problem.rules;
    const works: ObjectiveWork[] = spec.works.map((work) =>
      objectiveWork({ questId: work.questId as QuestId, index: work.index, objective: work.objective, countOverride: null, playerLevel: level, at: work.at, place: work.place }, this.lookup, rules),
    );
    for (let k = 0; k < spec.unknowns; k += 1) {
      works.push({ questId: 0 as QuestId, index: -1, seconds: UNKNOWN_SECONDS, killXp: ZERO_XP, workCount: null, npcId: null, used: [], facts: [] });
    }
    const block = completeWork(works, rules);
    const at = index * this.slots + this.slot(level);
    this.blockMs[at] = block.seconds.value === null ? -1 : Math.round(block.seconds.value * 1000);
    this.blockXp[at] = block.killXp.value ?? 0;
  }

  /** A work block's time at `level`, ms (−1 unknown): TIME-9, TIME-10. */
  blockSeconds(index: number, level: number): number {
    const at = index * this.slots + this.slot(level);
    if (Number.isNaN(this.blockMs[at] ?? Number.NaN)) this.priceBlock(index, level);
    return this.blockMs[at] ?? -1;
  }

  /** A work block's kill XP at `level` (never unknown). */
  blockKillXp(index: number, level: number): number {
    const at = index * this.slots + this.slot(level);
    if (Number.isNaN(this.blockXp[at] ?? Number.NaN)) this.priceBlock(index, level);
    return this.blockXp[at] ?? 0;
  }

  /** A quest's XP at the turn-in level (−1 unknown): QXP-1..7. */
  questXp(index: number, level: number): number {
    const at = index * this.slots + this.slot(level);
    let value = this.questXpMemo[at] ?? Number.NaN;
    if (Number.isNaN(value)) {
      const spec = this.problem.pricing.questXp[index];
      if (spec === undefined) throw new RangeError(`No quest XP ${String(index)}`);
      const result = questXp(
        { questId: spec.questId as QuestId, xp: spec.xp, requiredLevel: spec.requiredLevel, dungeonQuest: spec.dungeonQuest, playerLevel: level },
        this.problem.rules,
      );
      value = result.xp.value === null ? -1 : result.xp.value;
      this.questXpMemo[at] = value;
    }
    return value;
  }

  /** The riding tier after a riding `train` step (TIME-3). */
  train(index: number, level: number, unknownXp: number, tier: number): number {
    const spec = this.problem.pricing.trains[index];
    if (spec === undefined) throw new RangeError(`No train ${String(index)}`);
    const riding = initialRiding(tier === 1 ? 1 : tier === 2 ? 2 : 0, this.problem.rules);
    const result = trainRiding(
      spec.step,
      { level, unknownXpEvents: unknownXp, riding },
      this.problem.rules,
    );
    return result.recognised ? result.riding.trained : tier;
  }

  /** A grind (TIME-12) from a state: per transition, never memoised (it reads the XP into the level). */
  grind(spec: GrindSpec, level: number, xpInto: number, unknownXp: number): GrindPrice {
    if (level > this.curve.cumulative.length) return { ms: -1, xpGained: 0, level, xpInto, resets: false };
    const result = grind({ until: spec.until, mobLevel: spec.mobLevel, xpPerHour: spec.xpPerHour, state: { level, xp: xpInto }, unknownXpEvents: unknownXp, place: spec.place }, this.curve, this.problem.rules);
    const gained = result.xpGained.value ?? 0;
    return {
      ms: result.seconds.value === null ? -1 : Math.round(result.seconds.value * 1000),
      xpGained: gained,
      level: gained > 0 ? result.state.level : level,
      xpInto: gained > 0 ? result.state.xp : xpInto,
      resets: result.resetsUnknownXp,
    };
  }
}
