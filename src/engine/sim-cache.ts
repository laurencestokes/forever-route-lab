import type { ObjectiveDef } from '../domain/dataset';
import type { EstimateBasis, Estimated } from '../domain/estimate';
import type { WorldPoint } from '../domain/points';
import type { EffectiveRules } from '../rules/precedence';
import { RULE_KEYS, type RuleKey } from '../rules/ruleset';
import { levelEstimate } from '../sim/estimate';
import { type Interaction, type InteractionTime, interactionTime } from '../sim/interaction';
import { type CompleteWork, completeWork, type ObjectiveLookup, type ObjectiveWork, objectiveWork, type ObjectiveWorkInput } from '../sim/objectives';
import { questXp, type QuestXpInput, type QuestXpResult } from '../sim/quest-xp';
import { type RidingState, type StepSpeeds, type TravelMode, travelSpeeds } from '../sim/travel';

/**
 * Memoised `src/sim` calls for one (effective rules, dataset) pair. The functions are pure and
 * their other inputs (the rules, the dataset) are fixed for the pair, so a result depends only on
 * the arguments in its key, and every walker of the pair shares one cache (`sharedSimCache`: a
 * context change that keeps the rules and the dataset, such as a new travel model, does not start
 * cold). Results are shared read-only objects; the engine never mutates them. Everything keyed by
 * a walker's own objects (a step's resolved point, the works built from it) is held weakly, so a
 * shared cache keeps nothing of a walker that is gone. This keeps a 10,000-step walk within the
 * ARCHITECTURE §14 budget, where the same speeds, interactions and objective work recur on most
 * steps.
 */
export interface SimCache {
  speeds(mode: TravelMode, riding: RidingState): StepSpeeds;
  interaction(kind: Interaction): InteractionTime;
  objective(input: ObjectiveWorkInput): ObjectiveWork;
  /** TIME-10 over `works` (results of `objective`). */
  complete(works: readonly ObjectiveWork[]): CompleteWork;
  questXp(input: QuestXpInput): QuestXpResult;
  /** `levelAfter` (SIMULATION §8): the level with the combined basis of every XP grant so far. */
  levelAfter(level: number, basis: EstimateBasis, eraFallback: boolean): Estimated<number>;
  /** Several `assumptionsUsed` lists as one, without duplicates, in RULE_KEYS order (as `mergeKeys`). */
  mergeUsed(lists: readonly (readonly RuleKey[])[]): readonly RuleKey[];
}

const EMPTY: readonly RuleKey[] = [];
const KEY_INDEX: ReadonlyMap<RuleKey, number> = new Map(RULE_KEYS.map((key, index) => [key, index]));
/** Rule-key indices below this go in `mergeUsed`'s low integer, the rest in its high one (each stays below 2^53). */
const SPLIT = 30;
if (RULE_KEYS.length > SPLIT + 53) throw new Error('mergeUsed keys its lists by two integers of at most 53 bits');

/** Item work at one level and place, by the step's point (the drop NPC is the nearest, TIME-9). */
interface ItemWorks {
  readonly byPoint: WeakMap<WorldPoint, ObjectiveWork>;
  none: ObjectiveWork | null;
}

/** A work block of several works, as a trie of weak maps over the works in order. */
interface CompleteNode {
  value: CompleteWork | null;
  next: WeakMap<ObjectiveWork, CompleteNode> | null;
}

const SIM_CACHES = new WeakMap<EffectiveRules, WeakMap<ObjectiveLookup, SimCache>>();

/** The one cache of a (rules, dataset) pair, shared by all its walkers (ARCHITECTURE §12.1: a context change re-walks cold, but pure results stay valid). */
export function sharedSimCache(rules: EffectiveRules, lookup: ObjectiveLookup): SimCache {
  let byLookup = SIM_CACHES.get(rules);
  if (byLookup === undefined) {
    byLookup = new WeakMap();
    SIM_CACHES.set(rules, byLookup);
  }
  let cache = byLookup.get(lookup);
  if (cache === undefined) {
    cache = createSimCache(rules, lookup);
    byLookup.set(lookup, cache);
  }
  return cache;
}

function interactionKey(kind: Interaction): string {
  switch (kind.kind) {
    case 'accept':
      return kind.firstInVisit ? 'accept1' : 'accept2';
    case 'turnin':
      return kind.rewardChoice ? 'turnin2' : 'turnin1';
    case 'vendor':
    case 'train':
    case 'bind':
    case 'flight-master':
    case 'note':
    case 'abandon':
      return kind.kind;
  }
}

export function createSimCache(rules: EffectiveRules, lookup: ObjectiveLookup): SimCache {
  const speeds = new WeakMap<RidingState, Map<TravelMode, StepSpeeds>>();
  const interactions = new Map<string, InteractionTime>();
  /** By objective definition, then by `level × 3 + place` (open world 0, dungeon 1, raid 2), then (item objectives) by the step's point. */
  const objectives = new WeakMap<ObjectiveDef, Map<number, ObjectiveWork | ItemWorks>>();
  /** The works this cache made: only blocks of those are memoised. */
  const memoised = new WeakSet<ObjectiveWork>();
  /** Work blocks by their first work, then the rest in order. */
  const completes = new WeakMap<ObjectiveWork, CompleteNode>();
  /** By `questId × 256 + level`. */
  const questXps = new Map<number, QuestXpResult>();
  const marks = new Uint8Array(RULE_KEYS.length);
  /** Merged lists by their key set (`mergeUsed`): low bits, then high bits. */
  const interned = new Map<number, Map<number, readonly RuleKey[]>>();
  let lastLevel: Estimated<number> | null = null;

  const remember = (work: ObjectiveWork): ObjectiveWork => {
    memoised.add(work);
    return work;
  };

  return {
    speeds(mode, riding) {
      let byMode = speeds.get(riding);
      if (byMode === undefined) {
        byMode = new Map();
        speeds.set(riding, byMode);
      }
      let value = byMode.get(mode);
      if (value === undefined) {
        value = travelSpeeds(mode, riding, rules);
        byMode.set(mode, value);
      }
      return value;
    },
    interaction(kind) {
      const key = interactionKey(kind);
      let value = interactions.get(key);
      if (value === undefined) {
        value = interactionTime(kind, rules);
        interactions.set(key, value);
      }
      return value;
    },
    objective(input) {
      if (input.countOverride !== null || !Number.isInteger(input.playerLevel)) return objectiveWork(input, lookup, rules);
      let byLevel = objectives.get(input.objective);
      if (byLevel === undefined) {
        byLevel = new Map();
        objectives.set(input.objective, byLevel);
      }
      const key = input.playerLevel * 3 + (input.place === 'dungeon' ? 1 : input.place === 'raid' ? 2 : 0);
      let entry = byLevel.get(key);
      if (input.objective.kind === 'item') {
        // The drop NPC is the one nearest the step's point (TIME-9), so item work also keys on it.
        if (entry === undefined || !('byPoint' in entry)) {
          entry = { byPoint: new WeakMap(), none: null };
          byLevel.set(key, entry);
        }
        const at = input.at;
        let work = at === null ? entry.none : entry.byPoint.get(at);
        if (work === undefined || work === null) {
          work = remember(objectiveWork(input, lookup, rules));
          if (at === null) entry.none = work;
          else entry.byPoint.set(at, work);
        }
        return work.questId === input.questId && work.index === input.index ? work : objectiveWork(input, lookup, rules);
      }
      if (entry === undefined || 'byPoint' in entry) {
        entry = remember(objectiveWork(input, lookup, rules));
        byLevel.set(key, entry);
      }
      return entry.questId === input.questId && entry.index === input.index ? entry : objectiveWork(input, lookup, rules);
    },
    complete(works) {
      const [first] = works;
      if (first === undefined || !works.every((work) => memoised.has(work))) return completeWork(works, rules);
      let node = completes.get(first);
      if (node === undefined) {
        node = { value: null, next: null };
        completes.set(first, node);
      }
      for (let i = 1; i < works.length; i += 1) {
        const work = works[i];
        if (work === undefined) return completeWork(works, rules);
        node.next ??= new WeakMap();
        let child = node.next.get(work);
        if (child === undefined) {
          child = { value: null, next: null };
          node.next.set(work, child);
        }
        node = child;
      }
      node.value ??= completeWork(works, rules);
      return node.value;
    },
    questXp(input) {
      if (!Number.isInteger(input.playerLevel) || input.playerLevel < 0 || input.playerLevel > 255) return questXp(input, rules);
      const key = input.questId * 256 + input.playerLevel;
      let value = questXps.get(key);
      if (value === undefined) {
        value = questXp(input, rules);
        questXps.set(key, value);
      }
      return value;
    },
    levelAfter(level, basis, eraFallback) {
      if (lastLevel !== null && lastLevel.value === level && lastLevel.basis === basis && lastLevel.eraFallback === eraFallback) return lastLevel;
      lastLevel = levelEstimate(level, { basis, eraFallback });
      return lastLevel;
    },
    mergeUsed(lists) {
      let nonEmpty: readonly RuleKey[] | null = null;
      let several = false;
      for (const list of lists) {
        if (list.length === 0) continue;
        if (nonEmpty === null) nonEmpty = list;
        else if (list !== nonEmpty) several = true;
      }
      // One list from src/sim is already sorted and free of duplicates.
      if (nonEmpty === null) return EMPTY;
      if (!several) return nonEmpty;
      let low = marks.length;
      let high = -1;
      for (const list of lists) {
        for (const key of list) {
          const index = KEY_INDEX.get(key);
          if (index === undefined) continue;
          marks[index] = 1;
          if (index < low) low = index;
          if (index > high) high = index;
        }
      }
      // The set of marked indices as two exact integers (sums of powers of two, no bitwise
      // operators): steps that read the same keys share one list, which the metrics then skip.
      let lowBits = 0;
      let highBits = 0;
      for (let index = low; index <= high; index += 1) {
        if (marks[index] !== 1) continue;
        if (index < SPLIT) lowBits += 2 ** index;
        else highBits += 2 ** (index - SPLIT);
      }
      let byHigh = interned.get(lowBits);
      if (byHigh === undefined) {
        byHigh = new Map();
        interned.set(lowBits, byHigh);
      }
      let out = byHigh.get(highBits);
      if (out === undefined) {
        const keys: RuleKey[] = [];
        for (let index = low; index <= high; index += 1) {
          if (marks[index] !== 1) continue;
          const key = RULE_KEYS[index];
          if (key !== undefined) keys.push(key);
        }
        out = keys;
        byHigh.set(highBits, out);
      }
      for (let index = low; index <= high; index += 1) marks[index] = 0;
      return out;
    },
  };
}
