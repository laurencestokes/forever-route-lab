import type { Truth } from '../domain/conditions';
import type { QuestRecord } from '../domain/dataset';
import type { QuestId } from '../domain/ids';
import type { RouteStep } from '../domain/route';
import { routeGroup } from '../domain/route-ops';
import { evaluatePredicate, type PredicateContext } from '../engine/conditions';
import { cloneState } from '../engine/state';
import type { EngineDataset, ReadonlyCharacterState, WalkProject, WalkVisitor } from '../engine/types';
import type { AvailabilityDependencies, CompileAvailability, SectionProbe, StepProbe } from '../optimizer/types';
import { cumulativeXp, xpCurveOf } from '../sim/xp';
import { type AcceptChecks, type AcceptFinding, acceptTruth, type AvailabilitySubject } from '../validate/availability';
import { isRegisteredCode } from '../validate/codes';
import type { ValidatorContext } from '../validate/validator';

/**
 * The validator's availability for an optimiser run (docs/research/optimizer-m7.md §4.2, §5.1):
 *
 * - `compileAvailability`: what compile needs from `src/validate` (optimizer/core reads it as types
 *   only): each quest's dependency lists, and the truth of a set of finding codes.
 * - `createSectionProbe`: the baseline walk's probe visitor, recording at every section and suffix
 *   step the state scalars, the availability findings of each accept's quests (through the
 *   validator's own `check`, on the live state, in one call) and each skip predicate's truth, and a
 *   copy of the state after the last section step.
 *
 * `availabilityDependencies` belongs beside `check` in src/validate/availability.ts (plan M7.0,
 * with its coverage test over the committed dataset). Until it lands, `dependenciesOf` here reads
 * the same record fields `check` reads, rule by rule.
 */

type Dependencies = Omit<AvailabilityDependencies, 'breadcrumbTarget'>;

const NO_DEPENDENCIES: Dependencies = {
  completed: [],
  inLog: [],
  takenOrDone: [],
  blockers: [],
  minLevel: null,
  maxLevel: null,
  parent: null,
  skills: [],
  spells: [],
  minReputation: [],
  maxReputation: [],
};

/** The quests whose `nextQuestInChain` is each quest (VAL-21 reads them in the log). */
function previousIndex(dataset: ValidatorContext['dataset']): ReadonlyMap<QuestId, readonly QuestId[]> {
  const out = new Map<QuestId, QuestId[]>();
  for (const quest of dataset.quests?.() ?? []) {
    const next = quest.prerequisites.nextQuestInChain;
    if (next === null) continue;
    const list = out.get(next);
    if (list === undefined) out.set(next, [quest.id]);
    else list.push(quest.id);
  }
  return out;
}

/**
 * What `check` reads of one quest's record (src/validate/availability.ts), by relation:
 * VAL-8/9 `completed` (a group entry with its exclusive alternatives), VAL-10 `inLog` and the level
 * lift, VAL-18 starting-with `takenOrDone`, and the `blockers` of VAL-11, 12, 13 (taken), 14, 18
 * (until-completed, disabled-by) and 21 (the chain's previous steps in the log).
 */
export function dependenciesOf(record: QuestRecord | undefined, dataset: Pick<EngineDataset, 'quest'>, previous: ReadonlyMap<QuestId, readonly QuestId[]>): Dependencies {
  if (record === undefined) return NO_DEPENDENCIES;
  const pre = record.prerequisites;
  const req = record.requirements;
  const completed: QuestId[][] = [];
  if (pre.preQuestSingle.length > 0) completed.push([...pre.preQuestSingle]);
  else {
    for (const entry of pre.preQuestGroup) {
      const id = Math.abs(entry) as QuestId;
      completed.push(entry > 0 ? [id, ...(dataset.quest(id)?.prerequisites.exclusiveTo ?? [])] : [id]);
    }
  }
  const blockers = new Set<QuestId>();
  for (const id of pre.exclusiveTo) if (id !== record.id) blockers.add(id);
  for (const id of pre.breadcrumbs) blockers.add(id);
  for (const id of [pre.nextQuestInChain, pre.breadcrumbForQuestId, pre.availableUntilCompleted, pre.disabledByQuest]) if (id !== null) blockers.add(id);
  for (const id of previous.get(record.id) ?? []) if (id !== record.id) blockers.add(id);
  return {
    completed,
    inLog: pre.parentQuest === null ? [] : [pre.parentQuest],
    takenOrDone: pre.availableStartingWith === null ? [] : [pre.availableStartingWith],
    blockers: [...blockers].sort((a, b) => a - b),
    minLevel: record.minLevel,
    maxLevel: record.maxLevel,
    parent: pre.parentQuest,
    skills: req.skill === null ? [] : [req.skill.skillId],
    spells: req.spell === null ? [] : [Math.abs(req.spell)],
    // One faction may carry both bounds (`check` reads them as one range).
    minReputation: req.minReputation === null ? [] : [req.minReputation.factionId],
    maxReputation: req.maxReputation === null ? [] : [req.maxReputation.factionId],
  };
}

/** The truth of findings with these codes, as `acceptTruth` reads them (an unregistered code blocks). */
export function codesTruth(codes: readonly string[]): Truth {
  const findings: AcceptFinding[] = [];
  for (const code of codes) {
    if (!isRegisteredCode(code)) return 'false';
    findings.push({ code, questId: 0 as QuestId, data: null, words: {} });
  }
  return acceptTruth(findings);
}

/** `CompileAvailability` over the validator's context (§4.2). */
export function compileAvailability(context: Pick<ValidatorContext, 'dataset'>): CompileAvailability {
  const dataset = context.dataset;
  let previous: ReadonlyMap<QuestId, readonly QuestId[]> | null = null;
  const cache = new Map<QuestId, AvailabilityDependencies>();
  return {
    dependencies(questId) {
      const hit = cache.get(questId);
      if (hit !== undefined) return hit;
      previous ??= previousIndex(dataset);
      const record = dataset.quest(questId);
      const target = record?.prerequisites.breadcrumbForQuestId ?? null;
      const out: AvailabilityDependencies = {
        ...dependenciesOf(record, dataset, previous),
        breadcrumbTarget: target === null ? null : { questId: target, dependencies: dependenciesOf(dataset.quest(target), dataset, previous) },
      };
      cache.set(questId, out);
      return out;
    },
    truth: codesTruth,
  };
}

/** The quests an accept step names: the quest, then each any-of candidate. */
const acceptQuests = (step: RouteStep): QuestId[] =>
  step.kind !== 'accept' ? [] : step.anyOf === null ? [step.questId] : [step.questId, ...step.anyOf.filter((id) => id !== step.questId)];

export interface SectionProbeInput {
  readonly checks: AcceptChecks;
  readonly subject: AvailabilitySubject;
  readonly project: WalkProject;
  readonly rules: ValidatorContext['rules'];
  /** The walk's accept policy (the validator's), for `available` predicates. */
  readonly predicates: Pick<PredicateContext, 'acceptPolicy'>;
  /** Route indices: the probe records from `first` on, and copies the state after `last`. */
  readonly section: { readonly first: number; readonly last: number };
}

/**
 * The baseline walk's probe visitor (§4.2, §5.1). The walk must visit every step from the section
 * start (a walk from the cast window, or from 0). With an empty section (`last < first`) the end
 * state is the state before `first`.
 */
export function createSectionProbe(input: SectionProbeInput): { readonly visitor: WalkVisitor; result(): SectionProbe } {
  const { checks, subject, project, section } = input;
  const steps = new Map<number, StepProbe>();
  let endState: ReadonlyCharacterState | null = null;
  const curve = xpCurveOf(input.rules);
  const predicateContext: PredicateContext = {
    priorHistory: project.character.priorHistory,
    xpStepSkipping: project.routeProfile.xpStepSkipping,
    acceptPolicy: input.predicates.acceptPolicy,
  };
  const visitor: WalkVisitor = {
    begin({ fromIndex }) {
      for (const index of [...steps.keys()]) if (index >= fromIndex) steps.delete(index);
      if (fromIndex <= Math.max(section.first, section.last)) endState = null;
    },
    enter(visit) {
      if (visit.index === section.first && section.last < section.first) endState = cloneState(visit.state);
      if (visit.index < section.first) return;
      const state = visit.state;
      const group = visit.step.groupId === null ? null : routeGroup(project.route, visit.step.groupId);
      const predicates = [...(group?.rxp?.condition?.skipIf ?? []), ...(visit.step.condition?.skipIf ?? [])];
      const quests = acceptQuests(visit.step);
      for (const predicate of predicates) if (predicate.kind === 'questState' && predicate.state === 'available') quests.push(...predicate.questIds);
      steps.set(visit.index, {
        index: visit.index,
        active: visit.active,
        level: state.level,
        xp: state.xp,
        knownTotal: cumulativeXp(curve, Math.min(state.level, curve.cumulative.length)) + state.xp,
        unknownXpEvents: state.unknownXpEvents,
        logCount: state.questLog.size,
        availability:
          quests.length === 0
            ? null
            : quests.map((questId) => {
                const findings = checks.check(questId, state, subject, false);
                return { questId, truth: acceptTruth(findings), codes: findings.map((finding) => finding.code) };
              }),
        predicates: predicates.length === 0 ? null : predicates.map((predicate) => evaluatePredicate(predicate, state, predicateContext)),
        chosen: null,
      });
    },
    leave(visit, record) {
      const known = steps.get(visit.index);
      if (known !== undefined && (visit.step.kind === 'accept' || visit.step.kind === 'turnin') && visit.step.anyOf !== null) steps.set(visit.index, { ...known, chosen: record.delta.questId });
      if (visit.index === section.last) endState = cloneState(visit.state);
    },
    end(walk) {
      // A section that ends the route with no step (all of it dropped): the state after the prefix.
      if (endState === null && section.last < section.first && section.first >= walk.records.length) endState = cloneState(walk.final);
    },
  };
  return {
    visitor,
    result() {
      if (endState === null) throw new Error('The walk did not reach the section end');
      return { steps, endState };
    },
  };
}
