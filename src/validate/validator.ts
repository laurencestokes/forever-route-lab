import type { DatasetView } from '../domain/dataset';
import type { QuestId } from '../domain/ids';
import type { ValidationIssue } from '../domain/issues';
import type { CharacterProfile } from '../domain/project';
import type { AcceptPolicy, EngineContext, EngineDataset, RouteWalk, StepRecord, StepVisit, WalkProject, WalkVisitor } from '../engine/types';
import { startLevelAndXp } from '../engine/state';
import { walkRoute } from '../engine/walker';
import type { EffectiveRules } from '../rules/precedence';
import { type TaxiNodeKey, taxiNodeByKey, type TravelGraph } from '../rules/travel-graph';
import { type AcceptChecks, type AcceptFinding, availabilitySubject, type AvailabilitySubject, createAcceptChecks, createAvailabilityPolicy } from './availability';
import { type FactContext, factIssues, pendingLegsIssue } from './facts';
import { compareIssues, createIssue, NO_ISSUES, orderStepIssues, questLabel } from './issue';
import { abandonIssues, completeIssues, type ReducedXpCache, type TurnInBefore, turnInIssues } from './quest-steps';

/**
 * The route validator (docs/ARCHITECTURE.md §9.4, docs/SIMULATION.md §7): a visitor of the engine's
 * walk (ARCHITECTURE §9.2), so validation, simulation and route context read one walk and cannot
 * disagree.
 *
 * - `enter` checks an accept's candidates against the state before the step (SIMULATION §7.2)
 *   and notes what a turn-in's checks need from that state.
 * - `leave` reads the step's record: the candidate the walker chose, the quests it assumed were in
 *   the log (`priorHistory: 'unknown'`), and the simulation facts (SIM-1..21, VAL-30's incidental
 *   and carried objectives).
 * - `end` adds the route-level issues: DATA001 for custom quests that replace dataset quests,
 *   SIM-22 while navigation legs are pending, and SIM-23 for a start XP beyond the start level.
 *
 * Issues are kept per step, so a re-walk from a checkpoint re-validates only the steps it visits.
 * The order is stable: route-level issues first, then by step, and within a step by code, quest id
 * and message.
 */

export interface ValidatorContext {
  /** The project's dataset view (custom quests and overrides applied), as the walker reads it. */
  readonly dataset: EngineDataset & Partial<Pick<DatasetView, 'quests'>>;
  readonly rules: EffectiveRules;
  /** The view without the project's custom quests, for DATA001 (ARCHITECTURE §5.5); null skips it. */
  readonly baseDataset?: Pick<DatasetView, 'quest'> | null;
  /** The walk's TravelGraph, to name taxi nodes in messages; absent: nodes are named by key. */
  readonly graph?: TravelGraph | null;
}

export interface RouteValidator {
  /**
   * The availability rules as the engine's `AcceptPolicy`: give it to the walker
   * (`EngineContext.acceptPolicy`) so any-of accepts and `available` predicates agree with the
   * validator. It reads the character of the walk the visitor was given.
   */
  readonly acceptPolicy: AcceptPolicy;
  /** Pass it to every walk of the walker: `walker.walk(project, [validator.visitor])`. */
  readonly visitor: WalkVisitor;
  /** Every issue of the last walk, in the stable order. */
  issues(): readonly ValidationIssue[];
  /** The issues of step `index` of the last walk (empty for an index out of range). */
  stepIssues(index: number): readonly ValidationIssue[];
  /** The route-level issues of the last walk (`stepId` null). */
  routeIssues(): readonly ValidationIssue[];
}

const NO_FINDINGS: readonly AcceptFinding[] = [];

/** What the availability and LINT-4 checks cache: it depends on the dataset and the rules only. */
interface CheckCaches {
  readonly checks: AcceptChecks;
  readonly reducedXp: ReducedXpCache;
}

const CHECK_CACHES = new WeakMap<ValidatorContext['dataset'], WeakMap<EffectiveRules, CheckCaches>>();

/** One set of check caches per (dataset, rules), shared by every validator of the pair (a context change that keeps both does not start cold). */
function sharedChecks(context: ValidatorContext): CheckCaches {
  let byRules = CHECK_CACHES.get(context.dataset);
  if (byRules === undefined) {
    byRules = new WeakMap();
    CHECK_CACHES.set(context.dataset, byRules);
  }
  let caches = byRules.get(context.rules);
  if (caches === undefined) {
    caches = { checks: createAcceptChecks({ dataset: context.dataset, rules: context.rules }), reducedXp: new Map() };
    byRules.set(context.rules, caches);
  }
  return caches;
}

export function createRouteValidator(context: ValidatorContext): RouteValidator {
  const { dataset, rules } = context;
  const baseDataset = context.baseDataset ?? null;
  const { checks, reducedXp } = sharedChecks(context);
  const graph = context.graph ?? null;
  const factContext: FactContext = {
    rules,
    names: dataset,
    taxiName: graph === null ? null : (key) => taxiNodeByKey(graph, key as TaxiNodeKey)?.names[0] ?? null,
  };
  let subject: AvailabilitySubject | null = null;
  let subjectCharacter: CharacterProfile | null = null;
  const perStep: (readonly ValidationIssue[])[] = [];
  let route: readonly ValidationIssue[] = NO_ISSUES;
  let flat: readonly ValidationIssue[] | null = null;
  // Set by `enter`, read by `leave` of the same step: an accept's findings per candidate (the
  // first candidate without a map, the others in one), and what a turn-in reads from the state.
  let acceptQuest: QuestId | null = null;
  let acceptFindings: readonly AcceptFinding[] = NO_FINDINGS;
  let otherFindings: Map<QuestId, readonly AcceptFinding[]> | null = null;
  /** One object, rewritten by each turn-in's `enter` (read synchronously by its `leave`). */
  const turnInBefore: { -readonly [K in keyof TurnInBefore]: TurnInBefore[K] } = { failed: false, level: 0, levelBasis: 'source', levelEraFallback: false };
  let turnInSeen = false;
  /** Collects one step's issues; copied out only when the step has some. */
  const scratch: ValidationIssue[] = [];

  function clearPending(): void {
    acceptQuest = null;
    acceptFindings = NO_FINDINGS;
    otherFindings = null;
    turnInSeen = false;
  }

  const currentSubject = (): AvailabilitySubject => {
    if (subject === null) throw new Error("The validator's accept policy needs a walk with the validator's visitor");
    return subject;
  };

  function enter(visit: StepVisit): void {
    clearPending();
    if (visit.active === false) return;
    const { step, state } = visit;
    if (step.kind === 'accept') {
      acceptQuest = step.questId;
      acceptFindings = checks.check(step.questId, state, currentSubject(), true);
      // The other any-of candidates, in the walker's order (SIMULATION §7.2).
      if (step.anyOf !== null) {
        otherFindings = new Map();
        for (const candidate of step.anyOf) {
          if (candidate !== step.questId && !otherFindings.has(candidate)) otherFindings.set(candidate, checks.check(candidate, state, currentSubject(), true));
        }
      }
    } else if (step.kind === 'turnin') {
      turnInBefore.failed = state.questLog.get(step.questId)?.failed === true;
      turnInBefore.level = state.level;
      turnInBefore.levelBasis = state.xpBasis;
      turnInBefore.levelEraFallback = state.xpEraFallback;
      turnInSeen = true;
    }
  }

  function leave(visit: StepVisit, record: StepRecord): void {
    const { step, delta } = record;
    const out = scratch;
    out.length = 0;
    if (delta.skipped === null) {
      switch (step.kind) {
        case 'accept': {
          // The walker's candidate; its warnings and infos, or questId's errors when all fail (§7.2).
          const chosen = delta.questId ?? step.questId;
          const findings = chosen === acceptQuest ? acceptFindings : (otherFindings?.get(chosen) ?? NO_FINDINGS);
          for (const finding of findings) out.push(createIssue(finding.code, step.id, finding.questId, finding.data, finding.words));
          break;
        }
        case 'turnin':
          if (turnInSeen) {
            // D-040: carried kill XP is granted before the quest XP, so LINT-4 reads the level after it.
            for (const fact of record.estimate.facts) {
              if (fact.kind !== 'objectives-carried') continue;
              turnInBefore.level = fact.level;
              turnInBefore.levelBasis = fact.levelBasis;
              turnInBefore.levelEraFallback = fact.levelEraFallback;
            }
            turnInIssues(step, delta, turnInBefore, dataset, rules, out, reducedXp);
          }
          break;
        case 'abandon':
          abandonIssues(step, delta, dataset, out);
          break;
        case 'complete':
          completeIssues(step, delta, dataset, out);
          break;
        case 'travel':
        case 'grind':
        case 'hearth':
        case 'flight':
        case 'train':
        case 'vendor':
        case 'note':
          // Their checks are simulation facts (SIM-3..11, SIM-13..15, SIM-17..21).
          break;
      }
      const facts = record.estimate.facts;
      if (facts.length > 0) factIssues(step.id, facts, visit.state, factContext, out);
    }
    perStep[record.index] = out.length === 0 ? NO_ISSUES : orderStepIssues(out.slice());
    out.length = 0;
    clearPending();
  }

  function routeLevel(walk: RouteWalk): readonly ValidationIssue[] {
    const out: ValidationIssue[] = [];
    const character = walk.project.character;
    const start = startLevelAndXp(character, rules);
    if (start.normalised) {
      out.push(createIssue('SIM023-start-xp-beyond-level', null, null, { startLevel: character.startLevel, startXp: character.startXp, level: start.level, xp: start.xp }, null));
    }
    if (baseDataset !== null) {
      for (const quest of walk.project.customQuests) {
        if (quest.id > 0 && baseDataset.quest(quest.id) !== undefined) {
          out.push(createIssue('DATA001-custom-shadowed', null, quest.id, null, { quest: questLabel(dataset, quest.id) }));
        }
      }
    }
    let legs = 0;
    let steps = 0;
    for (const estimate of walk.estimates) {
      let pending = 0;
      for (const fact of estimate.facts) if (fact.kind === 'pending-leg') pending += 1;
      if (pending === 0) continue;
      legs += pending;
      steps += 1;
    }
    if (legs > 0) out.push(pendingLegsIssue(legs, steps));
    return out.length === 0 ? NO_ISSUES : out.sort(compareIssues);
  }

  const visitor: WalkVisitor = {
    begin({ fromIndex, project }) {
      if (perStep.length < fromIndex) {
        throw new Error(`The validator saw ${String(perStep.length)} steps of the previous walk, not the ${String(fromIndex)} this walk keeps: pass its visitor to every walk, or invalidate(0) first`);
      }
      if (project.character !== subjectCharacter) {
        subject = availabilitySubject(project.character);
        subjectCharacter = project.character;
      }
      perStep.length = fromIndex;
      route = NO_ISSUES;
      flat = null;
    },
    enter,
    leave,
    end(walk) {
      perStep.length = walk.records.length;
      route = routeLevel(walk);
      flat = null;
    },
  };

  function issues(): readonly ValidationIssue[] {
    if (flat !== null) return flat;
    const out: ValidationIssue[] = [...route];
    for (const list of perStep) for (const issue of list) out.push(issue);
    flat = out;
    return out;
  }

  return {
    acceptPolicy: createAvailabilityPolicy(checks, currentSubject),
    visitor,
    issues,
    stepIssues: (index) => perStep[index] ?? NO_ISSUES,
    routeIssues: () => route,
  };
}

export interface ValidateRouteOptions {
  /** The dataset view without the project's custom quests, for DATA001 (ARCHITECTURE §5.5). */
  readonly baseDataset?: Pick<DatasetView, 'quest'> | null;
  /** Further visitors of the same walk (route context, for example). */
  readonly visitors?: readonly WalkVisitor[];
}

export interface RouteValidation {
  readonly walk: RouteWalk;
  /** Route-level issues first, then by step; within a step by code, quest id and message. */
  readonly issues: readonly ValidationIssue[];
}

/**
 * Walks, simulates and validates a route once (ARCHITECTURE §9.2-§9.4). The walker gets the
 * validator's accept policy, replacing any in `context`, so the any-of candidates it picks are
 * the ones the validator checks. For re-walks after edits keep a walker and a
 * `createRouteValidator` instead.
 */
export function validateRoute(project: WalkProject, context: EngineContext, options: ValidateRouteOptions = {}): RouteValidation {
  const validator = createRouteValidator({ dataset: context.dataset, rules: context.rules, baseDataset: options.baseDataset ?? null, graph: context.graph });
  const walk = walkRoute(project, { ...context, acceptPolicy: validator.acceptPolicy }, [validator.visitor, ...(options.visitors ?? [])]);
  return { walk, issues: validator.issues() };
}
