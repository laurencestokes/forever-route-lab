import type { QuestRecord } from '../domain/dataset';
import type { EstimateBasis } from '../domain/estimate';
import type { QuestId, StepId } from '../domain/ids';
import type { ValidationIssue } from '../domain/issues';
import type { AbandonStep, CompleteStep, TurnInStep } from '../domain/route';
import type { EngineDataset, StepDelta } from '../engine/types';
import { type EffectiveRules, markedKeys } from '../rules/precedence';
import { questXp, questXpTenths } from '../sim/quest-xp';
import { createIssue, questLabel } from './issue';

/**
 * Turn-in, abandon and objective-work checks (docs/SIMULATION.md §7.5, VAL-30, VAL-32, LINT-4;
 * ARCHITECTURE §9.4). They read the step's delta for what the walker did (the chosen any-of
 * candidate, the quests it assumed were in the log) and a few facts of the state before the step.
 */

/** What a turn-in's checks need from the state before the step. */
export interface TurnInBefore {
  /** Whether `step.questId` was in the log and failed. */
  readonly failed: boolean;
  readonly level: number;
  readonly levelBasis: EstimateBasis;
  readonly levelEraFallback: boolean;
}

/** DATA002 for each quest id the step names that the dataset (with custom quests) does not know. */
export function unknownQuestIssues(stepId: StepId, ids: readonly QuestId[], dataset: Pick<EngineDataset, 'quest'>, out: ValidationIssue[]): void {
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    if (id === undefined || dataset.quest(id) !== undefined || ids.indexOf(id) !== i) continue;
    out.push(createIssue('DATA002-unknown-quest', stepId, id, null, { quest: questLabel(dataset, id) }));
  }
}

/**
 * VAL-30 (with its cases), LINT-4 and DATA002 for a turn-in that ran (not skipped). The
 * incidental objectives (`VAL030-objectives-incidental`) come from the step's facts.
 */
export function turnInIssues(
  step: TurnInStep,
  delta: StepDelta,
  before: TurnInBefore,
  dataset: Pick<EngineDataset, 'quest'>,
  rules: EffectiveRules,
  out: ValidationIssue[],
  cache: ReducedXpCache = new Map(),
): void {
  const questId = delta.questId ?? step.questId;
  const record = dataset.quest(questId);
  if (record === undefined) unknownQuestIssues(step.id, [questId], dataset, out);
  if (delta.turnedIn === null) {
    // SIMULATION §7.5: no candidate was in the log; the step is checked as a turn-in of questId.
    out.push(createIssue(before.failed ? 'VAL030-failed' : 'VAL030-not-in-log', step.id, questId, null, { quest: questLabel(dataset, questId) }));
    return;
  }
  if (delta.assumedInLog.includes(questId)) out.push(createIssue('VAL030-not-in-log-unverifiable', step.id, questId, null, { quest: questLabel(dataset, questId) }));
  if (record === undefined) return;
  const via = step.via;
  if (via !== null && record.finishers.length > 0 && !record.finishers.some((ref) => ref.kind === via.kind && ref.id === via.id)) {
    out.push(
      createIssue('VAL030-finisher-mismatch', step.id, questId, { viaKind: via.kind, viaId: via.id }, {
        quest: questLabel(dataset, questId),
        viaText: `${via.kind === 'npc' ? 'NPC' : via.kind} ${String(via.id)}`,
      }),
    );
  }
  const reduced = reducedXpAt(record, before.level, rules, cache);
  if (reduced === null) return;
  out.push(
    createIssue(
      'LINT004-xp-reduced',
      step.id,
      record.id,
      {
        level: before.level,
        levelBasis: before.levelBasis,
        levelEraFallback: before.levelEraFallback,
        questLevel: reduced.questLevel,
        percent: reduced.percent,
        xp: reduced.xp,
        fullXp: reduced.fullXp,
        xpLost: reduced.xpLost,
        xpBasis: reduced.xpBasis,
        eraFallback: before.levelEraFallback || reduced.eraFallback,
        assumed: reduced.assumed,
      },
      { quest: questLabel(dataset, questId), difference: before.level - reduced.questLevel, lostText: reduced.xpLost === null ? '' : `, ${String(reduced.xpLost)} XP less` },
    ),
  );
}

/** LINT-4's numbers for a quest turned in at a level. */
interface ReducedXp {
  readonly questLevel: number;
  readonly percent: number;
  readonly xp: number | null;
  readonly fullXp: number | null;
  readonly xpLost: number | null;
  readonly xpBasis: EstimateBasis;
  readonly eraFallback: boolean;
  readonly assumed: string | null;
}

/** LINT-4 per quest and level (the data and rules do not change during a walk). */
export type ReducedXpCache = Map<QuestId, Map<number, ReducedXp | null>>;

/**
 * LINT-4: a turn-in at `P - Q >= 6` loses XP (QXP-3). On the lower-bound level it is certain: a
 * higher true level only reduces the XP further (§7.6). A scaling quest (level -1) is never
 * reduced; a quest whose level is unknown is not checked.
 */
function reducedXpAt(record: QuestRecord, level: number, rules: EffectiveRules, cache: ReducedXpCache): ReducedXp | null {
  let byLevel = cache.get(record.id);
  if (byLevel === undefined) {
    byLevel = new Map();
    cache.set(record.id, byLevel);
  }
  const cached = byLevel.get(level);
  if (cached !== undefined) return cached;
  let result: ReducedXp | null = null;
  const questLevel = record.xp?.questLevel ?? record.level;
  if (questLevel !== null && questLevel >= 1 && level - questLevel >= 6) {
    const input = { questId: record.id, xp: record.xp, requiredLevel: record.minLevel, dungeonQuest: record.dungeonQuest };
    const actual = questXp({ ...input, playerLevel: level }, rules);
    const full = questXp({ ...input, playerLevel: questLevel }, rules);
    const xp = actual.xp.value;
    const fullXp = full.xp.value;
    const assumed = markedKeys(rules, [...actual.used, ...full.used]);
    result = {
      questLevel,
      percent: questXpTenths(level, questLevel) * 10,
      xp,
      fullXp,
      xpLost: xp !== null && fullXp !== null ? fullXp - xp : null,
      xpBasis: actual.xp.basis,
      eraFallback: actual.xp.eraFallback || full.xp.eraFallback,
      assumed: assumed.length > 0 ? assumed.join(',') : null,
    };
  }
  byLevel.set(level, result);
  return result;
}

/** VAL-32 and DATA002 for an abandon step that ran. */
export function abandonIssues(step: AbandonStep, delta: StepDelta, dataset: Pick<EngineDataset, 'quest'>, out: ValidationIssue[]): void {
  const quest = questLabel(dataset, step.questId);
  unknownQuestIssues(step.id, [step.questId], dataset, out);
  if (delta.abandoned === null) out.push(createIssue('VAL032-not-in-log', step.id, step.questId, null, { quest }));
  else if (delta.assumedInLog.includes(step.questId)) out.push(createIssue('VAL032-not-in-log-unverifiable', step.id, step.questId, null, { quest }));
}

/**
 * DATA002, DATA003 and the `-unverifiable` SIM-16 for a `complete` step that ran (SIM-16 itself is
 * a fact). DATA003: a target names an objective index its quest's record does not have (the RXP
 * import's RXP031 range check, carried into validation), so that work has no time (TIME-9).
 */
export function completeIssues(step: CompleteStep, delta: StepDelta, dataset: Pick<EngineDataset, 'quest'>, out: ValidationIssue[]): void {
  unknownQuestIssues(
    step.id,
    step.targets.map((target) => target.questId),
    dataset,
    out,
  );
  for (const target of step.targets) {
    const objective = target.objective;
    if (objective === null) continue;
    const count = dataset.quest(target.questId)?.objectives.length;
    if (count === undefined || (Number.isInteger(objective) && objective >= 0 && objective < count)) continue;
    out.push(
      createIssue('DATA003-unknown-objective', step.id, target.questId, { objective, objectives: count }, {
        quest: questLabel(dataset, target.questId),
        objectiveText: Number.isInteger(objective) && objective >= 0 ? String(objective + 1) : String(objective),
      }),
    );
  }
  for (const questId of delta.assumedInLog) {
    out.push(createIssue('SIM016-complete-not-in-log-unverifiable', step.id, questId, null, { quest: questLabel(dataset, questId) }));
  }
}
