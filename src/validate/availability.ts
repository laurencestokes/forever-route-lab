import type { ClassToken, RaceToken } from '../domain/character';
import type { Truth } from '../domain/conditions';
import type { DatasetView, QuestRecord } from '../domain/dataset';
import type { QuestId } from '../domain/ids';
import { classAllowed, raceAllowed } from '../domain/masks';
import type { CharacterProfile } from '../domain/project';
import type { AcceptPolicy, EngineDataset, ReadonlyCharacterState } from '../engine/types';
import { questDifficulty } from '../rules/difficulty';
import { type EffectiveRules, markedKeys } from '../rules/precedence';
import type { RuleKey } from '../rules/ruleset';
import { questXp } from '../sim/quest-xp';
import { type IssueCode, issueCodeSpec, type IssueData } from './codes';
import { idList, type IssueWords, listText, questLabel, questListText } from './issue';

/**
 * Quest availability, `canAccept(q, state)` (docs/SIMULATION.md §7.2, §7.3, §7.6;
 * ARCHITECTURE §9.4): VAL-1..22 for one candidate quest against the walker's state before the
 * accept, and the lint checks of an accepted quest (LINT-1..3). Each failed check is a finding with
 * its registry code; the validator turns the chosen candidate's findings into issues, and the
 * engine's `AcceptPolicy` reads them as a truth value (an error blocks, a doubt is `unknown`).
 *
 * Level checks run on the known-XP lower bound: while `unknownXpEvents > 0` a failing VAL-4 is
 * its `-uncertain` warning, VAL-5 stays an error, and a passing VAL-5 is its `-uncertain` warning.
 * With `priorHistory: 'unknown'` a prerequisite that fails only because a quest the route never
 * touched is missing from the completed set or the log is its `-unverifiable` warning.
 */

/** What availability reads from the character profile. */
export interface AvailabilitySubject {
  readonly race: RaceToken;
  readonly class: ClassToken;
  readonly priorHistory: CharacterProfile['priorHistory'];
  /** Declared standing by faction id, or null when the profile declares no reputation. */
  readonly reputation: ReadonlyMap<number, number> | null;
}

export function availabilitySubject(character: Pick<CharacterProfile, 'race' | 'class' | 'priorHistory' | 'reputation'>): AvailabilitySubject {
  let reputation: Map<number, number> | null = null;
  if (character.reputation !== null) {
    reputation = new Map();
    for (const key of Object.keys(character.reputation).sort((a, b) => Number(a) - Number(b))) {
      const id = Number(key);
      const value = character.reputation[key];
      if (Number.isSafeInteger(id) && value !== undefined) reputation.set(id, value);
    }
  }
  return { race: character.race, class: character.class, priorHistory: character.priorHistory, reputation };
}

/** One failed check of one candidate quest. */
export interface AcceptFinding {
  readonly code: IssueCode;
  readonly questId: QuestId;
  readonly data: IssueData | null;
  readonly words: IssueWords;
}

export interface AvailabilityContext {
  /** The project's dataset view; `quests()`, when present, indexes the chains for VAL-21. */
  readonly dataset: Pick<EngineDataset, 'quest'> & Partial<Pick<DatasetView, 'quests'>>;
  readonly rules: EffectiveRules;
}

export interface AcceptChecks {
  /**
   * The findings of accepting `questId` in `state` (the state before the accept), in rule order;
   * an empty array when every check passes. With `lint`, LINT-1..3 are added.
   */
  check(questId: QuestId, state: ReadonlyCharacterState, subject: AvailabilitySubject, lint: boolean): readonly AcceptFinding[];
}

/**
 * Codes that leave availability undecided rather than blocking it: the `-uncertain` and
 * `-unverifiable` variants, an unknown quest, and the two emulator-only rules Questie does not
 * apply. An `AcceptPolicy` reads them as `unknown`.
 */
const DOUBT: ReadonlySet<IssueCode> = new Set<IssueCode>([
  'VAL004-min-level-uncertain',
  'VAL005-max-level-uncertain',
  'VAL008-prequest-single-unverifiable',
  'VAL009-prequest-group-unverifiable',
  'VAL010-parent-not-active-unverifiable',
  'VAL013-breadcrumb-target-unavailable',
  'VAL015-skill-unverifiable',
  'VAL016-reputation-unverifiable',
  'VAL017-spell-unverifiable',
  'VAL018-availability-window-unverifiable',
  'VAL019-specialization-unverifiable',
  'VAL021-previous-chain-active',
  'DATA002-unknown-quest',
]);

/** A candidate's availability: `false` on any error, `unknown` on a doubt, else `true`. */
export function acceptTruth(findings: readonly AcceptFinding[]): Truth {
  let truth: Truth = 'true';
  for (const finding of findings) {
    if (issueCodeSpec(finding.code).severity === 'error') return 'false';
    if (DOUBT.has(finding.code)) truth = 'unknown';
  }
  return truth;
}

const NONE: readonly AcceptFinding[] = [];
const NO_IDS: readonly QuestId[] = [];

/** Whether the route has never touched a quest (the engine's rule for "never accepted", ARCHITECTURE §9.4). */
export function untouched(state: ReadonlyCharacterState, questId: QuestId): boolean {
  return !state.questLog.has(questId) && !state.completed.has(questId) && !state.abandoned.has(questId) && !state.acceptedInRoute.has(questId);
}

const takenOrDone = (state: ReadonlyCharacterState, questId: QuestId): boolean => state.completed.has(questId) || state.questLog.has(questId);

function reputationRange(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `from ${String(min)} to below ${String(max)}`;
  if (min !== null) return `of at least ${String(min)}`;
  return `below ${String(max ?? 0)}`;
}

/** Every quest id a record links to (SIMULATION §7.4 fields), for LINT-2's dangling check. */
function linkedIds(record: QuestRecord): QuestId[] {
  const pre = record.prerequisites;
  const out: QuestId[] = [...pre.preQuestSingle, ...pre.exclusiveTo, ...pre.childQuests, ...pre.breadcrumbs];
  for (const entry of pre.preQuestGroup) out.push(Math.abs(entry) as QuestId);
  for (const id of [pre.nextQuestInChain, pre.parentQuest, pre.breadcrumbForQuestId, pre.availableUntilCompleted, pre.availableStartingWith, pre.disabledByQuest]) {
    if (id !== null) out.push(id);
  }
  return out;
}

/** LINT-3's finding for a quest at a level, before the state's level basis is added. */
interface LowValue {
  readonly questLevel: number | null;
  readonly difficulty: string | null;
  readonly xp: number | null;
  readonly xpBasis: string | null;
  readonly eraFallback: boolean;
  readonly assumed: string | null;
  readonly reasonText: string;
}

/** The findings of one candidate while its checks run. */
interface Findings {
  readonly questId: QuestId;
  readonly names: AvailabilityContext['dataset'];
  out: AcceptFinding[] | null;
  label: string | null;
}

/** Records a failed check; `words` (a fresh object) gets the quest's label. */
function add(found: Findings, code: IssueCode, data: IssueData | null, words: Record<string, string | number> | null = null): void {
  found.label ??= questLabel(found.names, found.questId);
  const all = words ?? {};
  all.quest = found.label;
  (found.out ??= []).push({ code, questId: found.questId, data, words: all });
}

/** With an unknown history, whether a quest could have been done or taken before the route (never touched in it). */
const maybeBefore = (state: ReadonlyCharacterState, unknownHistory: boolean, id: QuestId): boolean => unknownHistory && untouched(state, id);

function anyMaybeBefore(state: ReadonlyCharacterState, unknownHistory: boolean, ids: readonly QuestId[]): boolean {
  if (!unknownHistory) return false;
  for (const id of ids) if (untouched(state, id)) return true;
  return false;
}

export function createAcceptChecks(context: AvailabilityContext): AcceptChecks {
  const { dataset, rules } = context;
  const names = dataset;
  /** LINT-2 per quest: the data does not change during a walk. */
  const linkLint = new Map<QuestId, AcceptFinding | null>();
  /** LINT-3 per quest and level. */
  const lowValues = new Map<QuestId, Map<number, LowValue | null>>();
  /** VAL-21: quest id to the quests whose `nextQuestInChain` it is (built on first use). */
  let previousIndex: Map<QuestId, QuestId[]> | null = null;

  function previousInLog(questId: QuestId, state: ReadonlyCharacterState): readonly QuestId[] {
    let out: QuestId[] | null = null;
    if (dataset.quests !== undefined) {
      if (previousIndex === null) {
        previousIndex = new Map();
        for (const quest of dataset.quests()) {
          const next = quest.prerequisites.nextQuestInChain;
          if (next === null) continue;
          const list = previousIndex.get(next);
          if (list === undefined) previousIndex.set(next, [quest.id]);
          else list.push(quest.id);
        }
      }
      const candidates = previousIndex.get(questId);
      if (candidates !== undefined) for (const id of candidates) if (state.questLog.has(id)) (out ??= []).push(id);
      return out ?? NO_IDS;
    }
    for (const id of state.questLog.keys()) if (id !== questId && dataset.quest(id)?.prerequisites.nextQuestInChain === questId) (out ??= []).push(id);
    return out ?? NO_IDS;
  }

  function links(record: QuestRecord): AcceptFinding | null {
    const cached = linkLint.get(record.id);
    if (cached !== undefined) return cached;
    const pre = record.prerequisites;
    const notReturned = pre.exclusiveTo.filter((id) => {
      const other = dataset.quest(id);
      return other !== undefined && id !== record.id && !other.prerequisites.exclusiveTo.includes(record.id);
    });
    const mismatch: QuestId[] = [];
    if (pre.parentQuest !== null) {
      const parent = dataset.quest(pre.parentQuest);
      if (parent !== undefined && !parent.prerequisites.childQuests.includes(record.id)) mismatch.push(pre.parentQuest);
    }
    for (const child of pre.childQuests) {
      const other = dataset.quest(child);
      if (other !== undefined && other.prerequisites.parentQuest !== record.id) mismatch.push(child);
    }
    const dangling = [...new Set(linkedIds(record).filter((id) => dataset.quest(id) === undefined))];
    let finding: AcceptFinding | null = null;
    if (notReturned.length > 0 || mismatch.length > 0 || dangling.length > 0) {
      const parts: string[] = [];
      if (notReturned.length > 0) parts.push(`exclusive with ${questListText(names, notReturned)}, which does not list it back`);
      if (mismatch.length > 0) parts.push(`parent and child links disagree with ${questListText(names, mismatch)}`);
      if (dangling.length > 0) parts.push(`links to missing ${dangling.length === 1 ? 'quest' : 'quests'} ${listText(dangling.map(String))}`);
      finding = {
        code: 'LINT002-link-mismatch',
        questId: record.id,
        data: {
          exclusiveNotReturned: notReturned.length > 0 ? idList(notReturned) : null,
          parentChildMismatch: mismatch.length > 0 ? idList(mismatch) : null,
          dangling: dangling.length > 0 ? idList(dangling) : null,
        },
        words: { quest: questLabel(names, record.id), detailText: listText(parts) },
      };
    }
    linkLint.set(record.id, finding);
    return finding;
  }

  function check(questId: QuestId, state: ReadonlyCharacterState, subject: AvailabilitySubject, lint: boolean, depth: number): readonly AcceptFinding[] {
    const found: Findings = { questId, names, out: null, label: null };
    const capacity = rules.values.questLogCapacity;
    const inLog = state.questLog.has(questId);
    const logFull = !inLog && state.questLog.size >= capacity.value;
    const record = dataset.quest(questId);

    // VAL-1
    if (inLog) add(found, 'VAL001-already-in-log', null);
    if (record === undefined) {
      // SIMULATION §7.4: an unknown quest is a warning; what the state alone decides still applies.
      if (logFull) add(found, 'VAL020-quest-log-full', { size: state.questLog.size, capacity: capacity.value, capacityBasis: capacity.basis });
      if (depth === 0) add(found, 'DATA002-unknown-quest', null);
      return found.out ?? NONE;
    }
    const pre = record.prerequisites;
    const req = record.requirements;
    const unknownHistory = subject.priorHistory === 'unknown';
    const level = state.level;
    const uncertain = state.unknownXpEvents > 0;

    // VAL-2 (VAL-3: repeatable quests are exempt)
    if (state.completed.has(questId) && !record.flags.repeatable) add(found, 'VAL002-already-completed', null);

    // VAL-10: an active parent also lifts the level requirement (Questie IsLevelRequirementFulfilled).
    let parentActive = false;
    if (pre.parentQuest !== null) {
      parentActive = state.questLog.has(pre.parentQuest);
      if (!parentActive) {
        add(found, maybeBefore(state, unknownHistory, pre.parentQuest) ? 'VAL010-parent-not-active-unverifiable' : 'VAL010-parent-not-active', { parentQuestId: pre.parentQuest }, { parentName: questLabel(names, pre.parentQuest) });
      }
    }

    // VAL-4, VAL-5 on the lower bound (§7.6)
    if (!parentActive) {
      if (record.minLevel !== null && level < record.minLevel) {
        add(found, uncertain ? 'VAL004-min-level-uncertain' : 'VAL004-min-level', { requiredLevel: record.minLevel, level, levelBasis: state.xpBasis, levelEraFallback: state.xpEraFallback });
      }
      if (record.maxLevel !== null && record.maxLevel > 0) {
        if (level > record.maxLevel) {
          add(found, 'VAL005-max-level', { maxLevel: record.maxLevel, level, levelBasis: state.xpBasis, levelEraFallback: state.xpEraFallback, levelIsLowerBound: uncertain }, { levelText: `${uncertain ? 'at least ' : ''}level ${String(level)}` });
        } else if (uncertain) {
          add(found, 'VAL005-max-level-uncertain', { maxLevel: record.maxLevel, level, levelBasis: state.xpBasis, levelEraFallback: state.xpEraFallback });
        }
      }
    }

    // VAL-6, VAL-7 (§7.3: arithmetic masks, D-012)
    if (!raceAllowed(record.races, subject.race)) add(found, 'VAL006-race', { race: subject.race, races: record.races });
    if (!classAllowed(record.classes, subject.class)) add(found, 'VAL007-class', { class: subject.class, classes: record.classes });

    // VAL-8, or VAL-9 when there is no single list
    if (pre.preQuestSingle.length > 0) {
      if (!pre.preQuestSingle.some((id) => state.completed.has(id))) {
        const code = anyMaybeBefore(state, unknownHistory, pre.preQuestSingle) ? 'VAL008-prequest-single-unverifiable' : 'VAL008-prequest-single';
        add(found, code, { quests: idList(pre.preQuestSingle) }, { questNames: questListText(names, pre.preQuestSingle) });
      }
    } else if (pre.preQuestGroup.length > 0) {
      const missing: QuestId[] = [];
      let proven = false;
      for (const entry of pre.preQuestGroup) {
        const id = Math.abs(entry) as QuestId;
        const alternatives = entry > 0 ? (dataset.quest(id)?.prerequisites.exclusiveTo ?? []) : [];
        if (state.completed.has(id) || alternatives.some((alt) => state.completed.has(alt))) continue;
        missing.push(id);
        if (!maybeBefore(state, unknownHistory, id) && !anyMaybeBefore(state, unknownHistory, alternatives)) proven = true;
      }
      if (missing.length > 0) {
        add(found, proven ? 'VAL009-prequest-group' : 'VAL009-prequest-group-unverifiable', { quests: idList(missing) }, { questNames: questListText(names, missing) });
      }
    }

    // VAL-11
    if (pre.nextQuestInChain !== null && takenOrDone(state, pre.nextQuestInChain)) {
      add(found, 'VAL011-later-chain-step', { nextQuestId: pre.nextQuestInChain }, { nextName: questLabel(names, pre.nextQuestInChain) });
    }

    // VAL-12
    if (pre.exclusiveTo.length > 0) {
      const taken = pre.exclusiveTo.filter((id) => id !== questId && takenOrDone(state, id));
      if (taken.length > 0) add(found, 'VAL012-exclusive', { quests: idList(taken) }, { questNames: questListText(names, taken) });
    }

    // VAL-13: Questie's rule, and vmangos's stricter one as a warning
    if (pre.breadcrumbForQuestId !== null) {
      const target = pre.breadcrumbForQuestId;
      if (takenOrDone(state, target)) {
        add(found, 'VAL013-breadcrumb-target-taken', { targetQuestId: target }, { targetName: questLabel(names, target) });
      } else if (depth === 0) {
        const blocking = check(target, state, subject, false, depth + 1).find((finding) => issueCodeSpec(finding.code).severity === 'error');
        if (blocking !== undefined) {
          add(found, 'VAL013-breadcrumb-target-unavailable', { targetQuestId: target, reason: blocking.code }, { targetName: questLabel(names, target) });
        }
      }
    }

    // VAL-14
    if (pre.breadcrumbs.length > 0) {
      const active = pre.breadcrumbs.filter((id) => state.questLog.has(id));
      if (active.length > 0) add(found, 'VAL014-breadcrumb-active', { quests: idList(active) }, { questNames: questListText(names, active) });
    }

    // VAL-15: declared start values are exact; values of skill lines the route trained are lower bounds.
    if (req.skill !== null) {
      const { skillId, value: requiredValue } = req.skill;
      const value = state.skills.get(skillId);
      if (value === undefined) {
        add(found, 'VAL015-skill-unverifiable', { skillId, requiredValue, value: null, reason: 'not-declared' }, { reasonText: 'the profile does not declare this skill' });
      } else if (value < requiredValue) {
        if (state.trainedSkills.has(skillId)) {
          add(found, 'VAL015-skill-unverifiable', { skillId, requiredValue, value, reason: 'trained-in-route' }, {
            reasonText: `the route trains it, so its value (${String(value)}) is only a lower bound`,
          });
        } else {
          add(found, 'VAL015-skill', { skillId, requiredValue, value });
        }
      }
    }

    // VAL-16: declared standing plus the route's reputation rewards; min inclusive, max exclusive.
    for (const [bound, requirement] of [['min', req.minReputation], ['max', req.maxReputation]] as const) {
      if (requirement === null) continue;
      if (bound === 'max' && req.minReputation !== null && req.minReputation.factionId === requirement.factionId) continue;
      const factionId = requirement.factionId;
      const min = req.minReputation !== null && req.minReputation.factionId === factionId ? req.minReputation.value : null;
      const max = req.maxReputation !== null && req.maxReputation.factionId === factionId ? req.maxReputation.value : null;
      const rangeText = reputationRange(min, max);
      const base = subject.reputation?.get(factionId);
      if (base === undefined) {
        add(found, 'VAL016-reputation-unverifiable', { factionId, min, max }, { rangeText });
        continue;
      }
      const value = base + (state.reputationDelta.get(factionId) ?? 0);
      if ((min !== null && value < min) || (max !== null && value >= max)) add(found, 'VAL016-reputation', { factionId, min, max, value }, { rangeText });
    }

    // VAL-17: only spells trained in the route are known.
    if (req.spell !== null) {
      const spellId = Math.abs(req.spell);
      const known = state.knownSpells.has(spellId);
      if (req.spell > 0 && !known) add(found, 'VAL017-spell-unverifiable', { spellId, mustKnow: true }, { knowText: 'knows' });
      else if (req.spell < 0 && known) add(found, 'VAL017-spell', { spellId });
      else if (req.spell < 0) add(found, 'VAL017-spell-unverifiable', { spellId, mustKnow: false }, { knowText: 'does not know' });
    }

    // VAL-18
    if (pre.availableUntilCompleted !== null && state.completed.has(pre.availableUntilCompleted)) {
      const related = pre.availableUntilCompleted;
      add(found, 'VAL018-availability-window', { part: 'until-completed', relatedQuestId: related }, { windowText: `is no longer offered once ${questLabel(names, related)} has been turned in` });
    }
    if (pre.availableStartingWith !== null && !takenOrDone(state, pre.availableStartingWith)) {
      const related = pre.availableStartingWith;
      if (maybeBefore(state, unknownHistory, related)) {
        add(found, 'VAL018-availability-window-unverifiable', { part: 'starting-with', relatedQuestId: related }, { relatedName: questLabel(names, related) });
      } else {
        add(found, 'VAL018-availability-window', { part: 'starting-with', relatedQuestId: related }, { windowText: `is offered only once ${questLabel(names, related)} is taken or done` });
      }
    }
    if (pre.disabledByQuest !== null && state.questLog.has(pre.disabledByQuest)) {
      const related = pre.disabledByQuest;
      add(found, 'VAL018-availability-window', { part: 'disabled-by', relatedQuestId: related }, { windowText: `is not offered while ${questLabel(names, related)} is in the quest log` });
    }

    // VAL-19: the profile has no specialisation field.
    if (req.specialization !== null) add(found, 'VAL019-specialization-unverifiable', { specialization: req.specialization });

    // VAL-20
    if (logFull) add(found, 'VAL020-quest-log-full', { size: state.questLog.size, capacity: capacity.value, capacityBasis: capacity.basis });

    // VAL-21 (emulator only: a warning)
    if (state.questLog.size > 0) {
      for (const previous of previousInLog(questId, state)) {
        add(found, 'VAL021-previous-chain-active', { previousQuestId: previous }, { previousName: questLabel(names, previous) });
      }
    }

    // VAL-22: an info that never blocks.
    if (record.flags.needsEvent) add(found, 'VAL022-needs-event', null);

    if (lint) {
      // LINT-1
      if (pre.preQuestSingle.length > 0 && pre.preQuestGroup.length > 0) {
        add(found, 'LINT001-prequest-both', { single: idList(pre.preQuestSingle), group: pre.preQuestGroup.join(',') });
      }
      // LINT-2
      const linkFinding = links(record);
      if (linkFinding !== null) (found.out ??= []).push(linkFinding);
      // LINT-3 on the lower bound: certain when it fires (§7.6).
      lowValue(record, state, found);
    }
    return found.out ?? NONE;
  }

  /** LINT-3 of a quest at a level, without the state's level basis (cached: it depends on the data and rules only). */
  function lowValueAt(record: QuestRecord, level: number): LowValue | null {
    let byLevel = lowValues.get(record.id);
    if (byLevel === undefined) {
      byLevel = new Map();
      lowValues.set(record.id, byLevel);
    }
    const cached = byLevel.get(level);
    if (cached !== undefined) return cached;
    const questLevel = record.level === -1 ? level : record.level;
    const values = rules.values;
    const difficulty =
      questLevel !== null && Number.isInteger(questLevel) && questLevel >= 1
        ? questDifficulty(level, questLevel, { yellowLowerBound: values.difficultyYellowLowerBound.value, greenRange: values.greenRange.value })
        : null;
    const grey = difficulty === 'trivial';
    const xp = record.xp === null ? null : questXp({ questId: record.id, xp: record.xp, requiredLevel: record.minLevel, dungeonQuest: record.dungeonQuest, playerLevel: level }, rules);
    const noXp = xp !== null && xp.xp.value === 0;
    let result: LowValue | null = null;
    if (grey || noXp) {
      const keys: RuleKey[] = grey ? ['greenRange', 'difficultyYellowLowerBound'] : [];
      if (noXp) keys.push(...xp.used);
      const assumed = markedKeys(rules, keys);
      const reasons: string[] = [];
      if (grey) reasons.push(`it is grey (quest level ${String(questLevel)})`);
      if (noXp) reasons.push('it gives 0 XP');
      result = {
        questLevel,
        difficulty,
        xp: xp?.xp.value ?? null,
        xpBasis: xp?.xp.basis ?? null,
        eraFallback: (noXp && xp.xp.eraFallback) || assumed.some((key) => values[key].basis === 'era-assumed'),
        assumed: assumed.length > 0 ? assumed.join(',') : null,
        reasonText: listText(reasons),
      };
    }
    byLevel.set(level, result);
    return result;
  }

  /** LINT-3: a grey quest (COL-1) or one that gives 0 XP at the accept's level. Unknown XP is not 0. */
  function lowValue(record: QuestRecord, state: ReadonlyCharacterState, found: Findings): void {
    const low = lowValueAt(record, state.level);
    if (low === null) return;
    add(
      found,
      'LINT003-low-value',
      {
        level: state.level,
        levelBasis: state.xpBasis,
        levelEraFallback: state.xpEraFallback,
        questLevel: low.questLevel,
        difficulty: low.difficulty,
        xp: low.xp,
        xpBasis: low.xpBasis,
        eraFallback: state.xpEraFallback || low.eraFallback,
        assumed: low.assumed,
      },
      { reasonText: low.reasonText },
    );
  }

  return { check: (questId, state, subject, lint) => check(questId, state, subject, lint, 0) };
}

/**
 * The engine's `AcceptPolicy` from the full availability rules (SIMULATION §7.2): the walker picks
 * the first any-of candidate that is not `false` and evaluates `questState: 'available'`
 * predicates with it, so it agrees with the validator. `subject` gives the character of the walk
 * in progress.
 */
export function createAvailabilityPolicy(checks: AcceptChecks, subject: () => AvailabilitySubject): AcceptPolicy {
  return {
    acceptable(questId, state) {
      return acceptTruth(checks.check(questId, state, subject(), false));
    },
  };
}
