import type { Truth } from '../domain/conditions';
import type { QuestId, StepId } from '../domain/ids';
import type { ValidationIssue } from '../domain/issues';
import type { RouteStep } from '../domain/route';
import { stepQuestIds } from '../diff';
import type { ReadonlyCharacterState, StepRecord, WalkProject } from '../engine/types';
import { walkMetrics } from '../engine/walker';
import type { ContractSummary, SectionProbe, SectionWalk, StepProbe } from '../optimizer/types';
import type { RouteMetrics } from '../sim/estimate';
import { cumulativeXp, xpCurveOf } from '../sim/xp';
import { type RunWalker, spliceSection, walkRoute } from './optimizer-walk';

/**
 * The verification re-walk of an optimiser candidate (docs/research/optimizer-m7.md §4.1, §9 step 5):
 * the run's private walker re-walks prefix + candidate + suffix from the section start with the
 * validator and the probe, and the candidate passes only if every rule holds against the baseline:
 *
 * - `end-state`: the state before the first suffix step, projected on Q_ext (log entries with their
 *   objectives, `failed` and `routeAccepted`; completed; abandoned; accepted in the route; items
 *   before accept), equals the original's;
 * - `errors`: no error-severity issue (by step id, code and quest) the original walk did not have,
 *   in the section, the suffix or the route-level list (the proposal validity of ARCHITECTURE §12.5);
 * - `availability`: no accept, in the section or the suffix, has a lower availability truth than at
 *   its original position (`false < unknown < true`), and any-of accepts choose as before;
 * - `suffix-activity`: every suffix step's activity, and every suffix any-of choice, is the original's;
 * - `loose-end`: each pool quest outside Q_ext ends with its original status, or as it started;
 * - `travel-state`: bind point equal, known flight paths a superset, riding tier at least, hearth
 *   ready no later;
 * - `anchors`: the anchors (locked and implicit) in the original relative order, and no quest partly
 *   dropped;
 * - `improvement`: the re-walked section plus exit chain at least 1 ms shorter than the incumbent's,
 *   with the section's known XP gain at least the target (rule 7). The incumbent is the one the
 *   search used (§7.5): the original, or, when a numeric target is above the original's known gain,
 *   the original plus the grind fill the target needs, re-walked (review PAR-05);
 * - `parity`: the optimiser's estimate within §6.3 of the re-walk: at most about 1 ms per priced
 *   part (counted as four parts a step, the exit chain included), with 1% of the re-walk as the
 *   ceiling (review PAR-09). Skipped when `estimatedMs` is null (Milestone 8's partial change-set
 *   applications).
 *
 * The validator is authoritative: a candidate that fails falls through to the next one.
 */

export type VerificationRule = 'end-state' | 'errors' | 'availability' | 'suffix-activity' | 'loose-end' | 'travel-state' | 'anchors' | 'improvement' | 'parity';

export interface VerificationReport {
  readonly ok: boolean;
  readonly failures: readonly { readonly rule: VerificationRule; readonly detail: string }[];
  /** The re-walk's section plus exit chain, ms (§6.3's engine side). */
  readonly engineMs: number;
  /** The original's, on the baseline walk. */
  readonly originalMs: number;
  /** What `improvement` was judged against: the incumbent's re-walk (`originalMs` unless the incumbent has a fill). */
  readonly incumbentMs: number;
  readonly estimatedMs: number | null;
  /** `|estimatedMs − engineMs|`, or null without an estimate. */
  readonly parity: number | null;
  /** The parity rule's bound, ms (null without an estimate). */
  readonly parityBound: number | null;
  /** Issues of the re-walk the original did not have (any severity), for the proposal (Milestone 8). */
  readonly newIssues: readonly ValidationIssue[];
  /** Whole-route metrics of the re-walk (R15: the section gain is not the whole story). */
  readonly metrics: RouteMetrics;
  /** The whole route that was walked. */
  readonly steps: readonly RouteStep[];
}

/** What the run keeps of its baseline walk (§5.1 step 4). */
export interface BaselineWalk {
  readonly project: WalkProject;
  readonly section: { readonly first: number; readonly last: number };
  readonly walk: SectionWalk;
  readonly issues: readonly ValidationIssue[];
  readonly summary: ContractSummary;
  /** The section's anchor steps (locked and implicit), whose relative order is fixed. */
  readonly anchors: ReadonlySet<StepId>;
  /**
   * The re-walked section plus exit chain of the incumbent the search used, when it is not the
   * original (the original plus the grind fill a numeric target needs): what `improvement` is
   * judged against. Absent: the original's, from the baseline walk.
   */
  readonly incumbentMs?: number;
}

const RANK: Readonly<Record<Truth, number>> = { false: 0, unknown: 1, true: 2 };

const issueKey = (issue: ValidationIssue): string => `${String(issue.stepId)}|${issue.code}|${String(issue.questId)}`;

/** §6.3's engine side: (end of the last section step − start of the first) plus the exit chain's travel and waiting, ms. */
export function sectionPlusExitMs(records: readonly StepRecord[], first: number, last: number, exitChain: readonly number[]): number {
  let ms = 0;
  const a = records[first];
  const b = records[last];
  if (last >= first && a !== undefined && b !== undefined) ms = (b.estimate.endSec - a.estimate.startSec) * 1000;
  for (const index of exitChain) {
    const record = records[index];
    if (record !== undefined) ms += (record.estimate.breakdown.travel + record.estimate.breakdown.waiting) * 1000;
  }
  return ms;
}

type QuestStatus = string;

const statusOf = (state: ReadonlyCharacterState, q: QuestId): QuestStatus =>
  `${state.questLog.has(q) ? 'log' : '-'}|${state.completed.has(q) ? 'done' : '-'}|${state.abandoned.has(q) ? 'abandoned' : '-'}`;

/** The state of one quest as rule 1 compares it. */
function projection(state: ReadonlyCharacterState, q: QuestId): string {
  const entry = state.questLog.get(q);
  return JSON.stringify([
    entry === undefined ? null : [entry.objectives, entry.failed, entry.routeAccepted],
    state.completed.has(q),
    state.abandoned.has(q),
    state.acceptedInRoute.has(q),
    state.itemsBeforeAccept.get(q) ?? null,
  ]);
}

const samePoint = (a: ReadonlyCharacterState['hearth'], b: ReadonlyCharacterState['hearth']): boolean =>
  a === null || b === null ? a === b : a.mapId === b.mapId && a.x === b.x && a.y === b.y;

/** The truth of the quest an accept chose (its own quest, or the any-of choice). */
function chosenTruth(probe: StepProbe, step: RouteStep): Truth | null {
  const quest = step.kind === 'accept' && step.anyOf !== null ? probe.chosen : step.kind === 'accept' ? step.questId : null;
  if (quest === null) return null;
  return probe.availability?.find((entry) => entry.questId === quest)?.truth ?? null;
}

export interface VerifyInput {
  readonly run: RunWalker;
  readonly baseline: BaselineWalk;
  /** The candidate's section steps. */
  readonly steps: readonly RouteStep[];
  /** The optimiser's estimate, or null (a partial change-set application: parity is skipped). */
  readonly estimatedMs: number | null;
  /** False re-walks the incumbent itself: every rule but `improvement` (default true). */
  readonly judgeImprovement?: boolean;
}

/** §6.3's part bound: about 1 ms per priced part, counted as four parts a step (a leg, the action, a wait, a fill) plus the exit chain's. */
export const parityPartBound = (sectionSteps: number, exitSteps: number): number => 4 * (sectionSteps + exitSteps);

export function verifyCandidate(input: VerifyInput): VerificationReport {
  const { run, baseline, steps } = input;
  const { first, last } = baseline.section;
  const summary = baseline.summary;
  const project = spliceSection(baseline.project, first, last, steps);
  const newLast = first + steps.length - 1;
  const delta = steps.length - (last - first + 1);
  const walked = walkRoute(run, project, { first, last: newLast }, { probe: true, from: first });
  const probe = walked.probe as SectionProbe;
  const baseProbe = baseline.walk.probe;
  if (baseProbe === null) throw new Error('The baseline walk has no probe');
  const failures: { rule: VerificationRule; detail: string }[] = [];
  const fail = (rule: VerificationRule, detail: string): void => {
    failures.push({ rule, detail });
  };
  const baseSteps = baseline.project.route.steps;
  const baseIndex = new Map<StepId, number>(baseSteps.map((step, i) => [step.id, i]));

  // ---- errors (rule 2 and §12.5 validity)
  const known = new Set(baseline.issues.map(issueKey));
  const newIssues = walked.issues.filter((issue) => !known.has(issueKey(issue)));
  for (const issue of newIssues) if (issue.severity === 'error') fail('errors', `new ${issue.code}${issue.stepId === null ? '' : ` at step ${String(issue.stepId)}`}`);

  // ---- availability and suffix activity (rule 2)
  const newSteps = project.route.steps;
  for (let i = first; i < newSteps.length; i += 1) {
    const step = newSteps[i];
    const now = probe.steps.get(i);
    if (step === undefined || now === undefined) continue;
    const j = baseIndex.get(step.id);
    const before = j === undefined ? undefined : baseProbe.steps.get(j);
    if (before === undefined) continue;
    if (step.kind === 'accept') {
      const a = chosenTruth(now, step);
      const b = chosenTruth(before, step);
      if (a !== null && b !== null && RANK[a] < RANK[b]) fail('availability', `the accept of quest ${String(step.questId)} (step ${String(step.id)}) is ${a}, originally ${b}`);
    }
    if ((step.kind === 'accept' || step.kind === 'turnin') && step.anyOf !== null && now.chosen !== before.chosen) {
      fail(i > newLast ? 'suffix-activity' : 'availability', `step ${String(step.id)} chooses quest ${String(now.chosen)}, originally ${String(before.chosen)}`);
    }
    if (i > newLast && now.active !== before.active) fail('suffix-activity', `suffix step ${String(step.id)} is ${String(now.active)}, originally ${String(before.active)}`);
  }

  // ---- end state on Q_ext (rule 1), loose ends (rule 3), travel state (rule 4)
  const end = probe.endState;
  const baseEnd = baseProbe.endState;
  const start = baseline.walk.start;
  for (const q of summary.qExt) if (projection(end, q) !== projection(baseEnd, q)) fail('end-state', `quest ${String(q)} ends the section differently`);
  const qExt = new Set(summary.qExt);
  for (const q of summary.pool) {
    if (qExt.has(q)) continue;
    const status = statusOf(end, q);
    if (status !== statusOf(baseEnd, q) && status !== statusOf(start, q)) fail('loose-end', `quest ${String(q)} is left ${status}`);
  }
  if (!samePoint(end.hearth, baseEnd.hearth)) fail('travel-state', 'the hearth is bound elsewhere');
  for (const node of baseEnd.knownFlightPaths) if (!end.knownFlightPaths.has(node)) fail('travel-state', `flight path ${node} is no longer known`);
  if (end.riding.trained < baseEnd.riding.trained) fail('travel-state', `riding tier ${String(end.riding.trained)} below ${String(baseEnd.riding.trained)}`);
  if (end.hearthReadyAt > baseEnd.hearthReadyAt + 0.001) fail('travel-state', 'the hearthstone is ready later');

  // ---- anchors (rule 5)
  const kept = new Set(steps.map((step) => step.id));
  const anchorOrder = baseSteps.slice(first, last + 1).filter((step) => baseline.anchors.has(step.id)).map((step) => step.id);
  const candidateAnchors = steps.filter((step) => baseline.anchors.has(step.id)).map((step) => step.id);
  if (anchorOrder.join('|') !== candidateAnchors.join('|')) fail('anchors', 'the anchors are not all kept in their original order');
  const dropped = new Set<QuestId>();
  for (const step of baseSteps.slice(first, last + 1)) if (!kept.has(step.id)) for (const q of stepQuestIds(step)) dropped.add(q);
  for (const step of steps) for (const q of stepQuestIds(step)) if (dropped.has(q)) fail('anchors', `quest ${String(q)} is only partly dropped`);

  // ---- improvement and parity (rule 7, §6.3)
  const records = walked.route.records;
  const exit = summary.exitChain.map((index) => index + delta);
  const engineMs = sectionPlusExitMs(records, first, newLast, exit);
  const originalMs = sectionPlusExitMs(baseline.walk.records, first, last, summary.exitChain);
  const incumbentMs = baseline.incumbentMs ?? originalMs;
  if (input.judgeImprovement !== false && !(engineMs <= incumbentMs - 1)) {
    const against = baseline.incumbentMs === undefined ? 'the original' : 'the original with the grind fill the target needs,';
    fail('improvement', `${engineMs.toFixed(1)} ms is not shorter than ${against} ${incumbentMs.toFixed(1)} ms`);
  }
  const curve = xpCurveOf(run.engine.rules);
  const knownTotal = (state: ReadonlyCharacterState): number => cumulativeXp(curve, Math.min(state.level, curve.cumulative.length)) + state.xp;
  const gain = knownTotal(end) - knownTotal(start);
  if (gain < summary.targetXp) fail('improvement', `the section gains ${String(gain)} known XP, below the target of ${String(summary.targetXp)}`);
  let parity: number | null = null;
  let parityBound: number | null = null;
  if (input.estimatedMs !== null) {
    parity = Math.abs(input.estimatedMs - engineMs);
    // §6.3: the part bound is what the design delivers (real sections re-walk within a few ms); 1%
    // of the re-walk stays the ceiling, and 1 ms the floor (a section of a few zero-time steps).
    // More is a pricing drift, a bug signal: the candidate fails and the next one is verified.
    parityBound = Math.max(1, Math.min(0.01 * engineMs, parityPartBound(steps.length, exit.length)));
    if (parity > parityBound) fail('parity', `the estimate ${String(input.estimatedMs)} ms is ${parity.toFixed(1)} ms from the re-walk's ${engineMs.toFixed(1)} ms (bound ${parityBound.toFixed(1)} ms)`);
  }

  return {
    ok: failures.length === 0,
    failures,
    engineMs,
    originalMs,
    incumbentMs,
    estimatedMs: input.estimatedMs,
    parity,
    parityBound,
    newIssues,
    metrics: walkMetrics(walked.route),
    steps: newSteps,
  };
}
