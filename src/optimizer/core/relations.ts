import type { StatePredicate } from '../../domain/conditions';
import type { QuestId } from '../../domain/ids';
import type { RouteStep } from '../../domain/route';
import { routeGroup } from '../../domain/route-ops';
import { ridingSpellTier } from '../../rules/riding';
import { cumulativeXp, grindTargetTotal, xpCurveOf, type XpCurve } from '../../sim/xp';
import { namedQuests, type StepInfo, type Structure } from './section';
import type { AvailabilityDependencies } from './types';

/**
 * Precedence edges and the suffix guard (docs/research/optimizer-m7.md §3.5, §4.4). Edges point in
 * the direction the original walk had, so the incumbent satisfies all of them:
 *
 * - `require` (u → v): u must be scheduled before v;
 * - `order` (u → v): u must be scheduled before v, or dropped.
 */

export const REQUIRE = 0;
export const ORDER = 1;

export interface EdgeDraft {
  readonly from: number;
  readonly to: number;
  readonly kind: 0 | 1;
}

export function buildEdges(structure: Structure): EdgeDraft[] {
  const { units, input } = structure;
  const availability = input.availability;
  const edges = new Map<string, EdgeDraft>();
  const add = (from: number, to: number, kind: 0 | 1): void => {
    if (from === to || from < 0 || to < 0) return;
    if (from > to) throw new Error(`Edge ${String(from)} → ${String(to)} points against the original order`);
    const key = `${String(from)}>${String(to)}`;
    const known = edges.get(key);
    if (known === undefined || kind < known.kind) edges.set(key, { from, to, kind });
  };
  /** An `order` edge that keeps the side the two units had in the original. */
  const keepSide = (a: number, b: number): void => {
    if (a < b) add(a, b, ORDER);
    else add(b, a, ORDER);
  };

  const unitOf = new Map<number, number>();
  units.forEach((unit, u) => {
    for (const i of unit.steps) unitOf.set(i, u);
  });
  const info = (i: number): StepInfo => {
    const found = structure.steps.get(i);
    if (found === undefined) throw new Error(`No step info for ${String(i)}`);
    return found;
  };
  const stepsOf = (u: number): readonly StepInfo[] => (units[u]?.steps ?? []).map(info);
  /** The units holding a step of each kind that acts on a quest (the walk's chosen quest for any-of steps). */
  const acting = new Map<string, number[]>();
  const rewards: { readonly unit: number; readonly factionId: number; readonly value: number }[] = [];
  const trains: { readonly unit: number; readonly skillId: number | null; readonly spellId: number | null }[] = [];
  units.forEach((unit, u) => {
    for (const i of unit.steps) {
      const s = info(i);
      const quests = s.quest !== null ? [s.quest] : namedQuests(s.step);
      for (const q of quests) {
        const key = `${s.step.kind}|${String(q)}`;
        const list = acting.get(key) ?? [];
        if (list.at(-1) !== u) list.push(u);
        acting.set(key, list);
      }
      if (s.step.kind === 'turnin' && s.quest !== null) {
        for (const reward of input.context.dataset.quest(s.quest)?.reputationReward ?? []) rewards.push({ unit: u, factionId: reward.factionId, value: reward.value });
      }
      if (s.step.kind === 'train') trains.push({ unit: u, skillId: s.step.skillId, spellId: s.step.spellId });
    }
  });
  const unitsActing = (q: QuestId, kinds: readonly RouteStep['kind'][]): number[] => {
    const out: number[] = [];
    for (const kind of kinds) for (const u of acting.get(`${kind}|${String(q)}`) ?? []) if (!out.includes(u)) out.push(u);
    return out.sort((a, b) => a - b);
  };
  const questUnits = (q: QuestId): readonly number[] => {
    const k = structure.questIndex.get(q);
    return k === undefined ? [] : (structure.quests[k]?.units ?? []);
  };

  // The anchor chain, and blocks holding the section start or end (§3.6).
  let previous = -1;
  units.forEach((unit, u) => {
    if (!unit.anchor) return;
    if (previous >= 0) add(previous, u, REQUIRE);
    previous = u;
  });
  units.forEach((unit, u) => {
    if (unit.first) for (let v = u + 1; v < units.length; v += 1) add(u, v, REQUIRE);
    if (unit.last) for (let v = 0; v < u; v += 1) add(v, u, REQUIRE);
  });

  // Each quest's own units, in original order.
  for (const quest of structure.quests) {
    for (let k = 1; k < quest.units.length; k += 1) add(quest.units[k - 1] ?? -1, quest.units[k] ?? -1, REQUIRE);
  }

  const dependencyQuests = (deps: Omit<AvailabilityDependencies, 'breadcrumbTarget'>): QuestId[] => [
    ...deps.completed.flat(),
    ...deps.inLog,
    ...deps.takenOrDone,
    ...deps.blockers,
    ...(deps.parent === null ? [] : [deps.parent]),
  ];
  const keepSideWithQuests = (a: number, quests: readonly QuestId[]): void => {
    for (const q of quests) for (const x of questUnits(q)) keepSide(a, x);
  };
  const namedAndDependencies = (quests: readonly QuestId[]): QuestId[] => {
    const out = new Set<QuestId>();
    for (const q of quests) {
      out.add(q);
      const deps = availability.dependencies(q);
      for (const d of dependencyQuests(deps)) out.add(d);
      if (deps.breadcrumbTarget !== null) {
        out.add(deps.breadcrumbTarget.questId);
        for (const d of dependencyQuests(deps.breadcrumbTarget.dependencies)) out.add(d);
      }
    }
    return [...out];
  };

  /** VAL-8..18 relations of the quest accepted by unit `a` (§3.5 table rows 5-9). */
  const acceptRelations = (a: number, deps: Omit<AvailabilityDependencies, 'breadcrumbTarget'>): void => {
    for (const d of deps.completed.flat()) for (const t of unitsActing(d, ['turnin'])) if (t < a) add(t, a, REQUIRE);
    for (const p of deps.inLog) {
      for (const x of unitsActing(p, ['accept'])) if (x < a) add(x, a, REQUIRE);
      for (const t of unitsActing(p, ['turnin'])) if (t > a) add(a, t, ORDER);
    }
    for (const d of deps.takenOrDone) {
      const accepts = unitsActing(d, ['accept']).filter((x) => x < a);
      const turnIns = unitsActing(d, ['turnin']).filter((x) => x < a);
      for (const x of accepts.length > 0 ? accepts : turnIns) add(x, a, REQUIRE);
    }
    for (const d of deps.blockers) for (const x of unitsActing(d, ['accept', 'turnin', 'abandon'])) keepSide(a, x);
    // VAL-16: rewards that raise a minimum-reputation faction are `require`; the rest keep their side.
    const minFactions = new Set(deps.minReputation);
    const maxFactions = new Set(deps.maxReputation);
    for (const reward of rewards) {
      if (minFactions.has(reward.factionId)) {
        if (reward.value > 0) {
          if (reward.unit < a) add(reward.unit, a, REQUIRE);
        } else keepSide(a, reward.unit);
      }
      if (maxFactions.has(reward.factionId)) keepSide(a, reward.unit);
    }
    // VAL-15, VAL-17: train steps keep their side.
    for (const train of trains) {
      const teaches = (train.skillId !== null && deps.skills.includes(train.skillId)) || (train.spellId !== null && deps.spells.includes(train.spellId));
      if (teaches) keepSide(a, train.unit);
    }
  };

  const questsOfPredicates = (predicates: readonly StatePredicate[]): { readonly named: QuestId[]; readonly available: QuestId[] } => {
    const named: QuestId[] = [];
    const available: QuestId[] = [];
    for (const predicate of predicates) {
      if (predicate.kind !== 'questState') continue;
      named.push(...predicate.questIds);
      if (predicate.state === 'available') available.push(...predicate.questIds);
    }
    return { named, available };
  };

  const route = input.project.route;
  const groupUnits = new Map<string, number[]>();
  units.forEach((unit, u) => {
    for (const i of unit.steps) {
      const g = info(i).chain;
      if (g === null) continue;
      const list = groupUnits.get(g) ?? [];
      if (!list.includes(u)) list.push(u);
      groupUnits.set(g, list);
    }
  });

  units.forEach((unit, u) => {
    for (const i of unit.steps) {
      const s = info(i);
      const step = s.step;
      // Accept availability (a plain accept; any-of accepts keep every related unit on its side below).
      if (step.kind === 'accept' && s.active && step.anyOf === null && s.quest !== null) {
        const deps = availability.dependencies(s.quest);
        acceptRelations(u, deps);
        if (deps.breadcrumbTarget !== null) {
          for (const x of unitsActing(deps.breadcrumbTarget.questId, ['accept', 'turnin', 'abandon'])) keepSide(u, x);
          acceptRelations(u, deps.breadcrumbTarget.dependencies);
        }
      }
      // Any-of steps (§4.2): the named quests and their dependency lists keep their side.
      if ((step.kind === 'accept' || step.kind === 'turnin') && step.anyOf !== null) keepSideWithQuests(u, namedAndDependencies(namedQuests(step)));
      // Conditional steps: questState predicates keep their side; `available` ones with their dependencies.
      const group = step.groupId === null ? null : routeGroup(route, step.groupId);
      const predicates = [...(group?.rxp?.condition?.skipIf ?? []), ...(step.condition?.skipIf ?? [])];
      if (predicates.length > 0) {
        const { named, available } = questsOfPredicates(predicates);
        keepSideWithQuests(u, named);
        keepSideWithQuests(u, namedAndDependencies(available));
      }
      if (step.kind === 'turnin' && step.skipIfMissing) keepSideWithQuests(u, [step.questId]);
      if (step.kind === 'abandon') keepSideWithQuests(u, [step.questId]);
      // SIM-16: a complete before its quest's accept stays before it.
      if (step.kind === 'complete' && s.reason === 'SIM-16') for (const q of namedQuests(step)) for (const x of unitsActing(q, ['accept'])) keepSide(u, x);
      // A flight or transport priced with the original's waypoint state keeps its side with the group's units.
      if (s.dest.kind === 'table' && step.location !== null && step.groupId !== null) for (const x of groupUnits.get(step.groupId) ?? []) keepSide(u, x);
    }
  });

  // Unknown-XP turn-ins (§3.5, review OP-20): XP-granting units before them stay before them, or are dropped.
  const grantsXp = (u: number): boolean => stepsOf(u).some((s) => s.active && (s.step.kind === 'grind' || s.record.estimate.xpGained.value !== 0));
  units.forEach((unit, k) => {
    const unknownTurnIn = unit.steps.some((i) => info(i).step.kind === 'turnin' && info(i).record.estimate.facts.some((fact) => fact.kind === 'unknown-xp'));
    if (!unknownTurnIn) return;
    for (let x = 0; x < k; x += 1) if (grantsXp(x)) add(x, k, ORDER);
  });

  return [...edges.values()].sort((a, b) => a.to - b.to || a.from - b.from);
}

// =============================================================================================
// The suffix guard (§4.4)

export interface SuffixGuard {
  readonly deltaLo: number;
  readonly deltaHi: number;
  readonly originalEndTotal: number;
  readonly logRule: 'equal' | 'at-most';
  readonly originalLogCount: number;
}

const totalAt = (curve: XpCurve, level: number, xp: number): number => cumulativeXp(curve, Math.max(1, Math.min(level, curve.cumulative.length))) + xp;

export function suffixGuard(structure: Structure): SuffixGuard {
  const { input, last } = structure;
  const { project, context } = input;
  const steps = project.route.steps;
  const records = structure.walk.records;
  const curve = xpCurveOf(context.rules);
  const xpStepSkipping = project.routeProfile.xpStepSkipping;
  let deltaLo = Number.NEGATIVE_INFINITY;
  let deltaHi = Number.POSITIVE_INFINITY;
  /** Past a grind to a level both walks reach, the XP no longer differs; the log still does. */
  let xpSettled = false;
  const threshold = (total: number, xp: number): void => {
    if (xpSettled) return;
    if (xp >= total) deltaLo = Math.max(deltaLo, total - xp);
    else deltaHi = Math.min(deltaHi, total - xp);
  };
  const levelTotal = (level: number): number | null => (level < 1 || level > curve.cumulative.length ? null : cumulativeXp(curve, level));
  const questGates = (q: QuestId, xp: number): void => {
    const record = context.dataset.quest(q);
    if (record === undefined) return;
    const gates = [record];
    const target = record.prerequisites.breadcrumbForQuestId;
    const targetRecord = target === null ? undefined : context.dataset.quest(target);
    if (targetRecord !== undefined) gates.push(targetRecord);
    for (const gate of gates) {
      if (gate.minLevel !== null) {
        const t = levelTotal(gate.minLevel);
        if (t !== null) threshold(t, xp);
      }
      if (gate.maxLevel !== null && gate.maxLevel > 0) {
        const t = levelTotal(gate.maxLevel + 1);
        if (t !== null) threshold(t, xp);
      }
    }
  };
  let readers = false;
  for (let i = last + 1; i < steps.length; i += 1) {
    const step = steps[i];
    const record = records[i];
    if (step === undefined || record === undefined) continue;
    const xp = totalAt(curve, record.delta.levelBefore, record.delta.xpBefore);
    const group = step.groupId === null ? null : routeGroup(project.route, step.groupId);
    const predicates = [...(group?.rxp?.condition?.skipIf ?? []), ...(step.condition?.skipIf ?? [])];
    for (const predicate of predicates) {
      if (predicate.kind === 'levelAtLeast') {
        if (!predicate.negate && !xpStepSkipping) continue;
        const t = levelTotal(predicate.level);
        if (t !== null) threshold(t + (predicate.xp ?? 0), xp);
      } else if (predicate.kind === 'questState' && predicate.state === 'available') {
        readers = true;
        for (const q of predicate.questIds) questGates(q, xp);
      }
    }
    switch (step.kind) {
      case 'accept':
        if (step.anyOf !== null) readers = true;
        for (const q of namedQuests(step)) questGates(q, xp);
        break;
      case 'turnin':
        if (step.anyOf !== null) readers = true;
        break;
      case 'train': {
        const spellTier = ridingSpellTier(context.rules.values.ridingSpells.value, step.spellId);
        if (step.skill === 'riding' || spellTier !== null) {
          const rank = step.rank !== null && Number.isInteger(step.rank) && step.rank >= 1 ? step.rank : null;
          const tier = Math.min(2, rank ?? spellTier ?? 1) === 1 ? 1 : 2;
          const level = context.rules.values.mountLevels.value[tier - 1];
          const t = level === undefined ? null : levelTotal(level);
          if (t !== null) threshold(t, xp);
        }
        break;
      }
      case 'grind':
        if (step.until.kind === 'level') {
          const t = grindTargetTotal(curve, step.until);
          if (t !== null) {
            threshold(t, xp);
            // Below the target both walks grind to it, so the XP after it is the same.
            if (xp < t) xpSettled = true;
          }
        }
        break;
      case 'complete':
      case 'abandon':
      case 'travel':
      case 'hearth':
      case 'flight':
      case 'vendor':
      case 'note':
        break;
    }
  }
  const end = structure.endState;
  return {
    deltaLo,
    deltaHi,
    originalEndTotal: totalAt(curve, end.level, end.xp),
    logRule: readers ? 'equal' : 'at-most',
    originalLogCount: end.questLog.size,
  };
}
