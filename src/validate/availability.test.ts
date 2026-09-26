import { describe, expect, it } from 'vitest';
import type { QuestRecord } from '../domain/dataset';
import { factionId, questId, skillId } from '../domain/ids';
import type { CharacterProfile } from '../domain/project';
import { defaultCharacter } from '../domain/project-factory';
import { fixtureDataset, questRecord } from '../engine/test-helpers';
import { effectiveRules } from '../rules/precedence';
import { ERA_1_15, FOREVER_BETA } from '../rules/ruleset';
import { type AcceptFinding, acceptTruth, availabilitySubject, createAcceptChecks, createAvailabilityPolicy } from './availability';
import { stateWith } from './test-helpers';

/**
 * `canAccept` (docs/SIMULATION.md §7.2, §7.3, §7.6): every availability rule with a passing and a
 * failing case, the `-uncertain` and `-unverifiable` variants, the race and class masks (Skyborne
 * bits 32 and 33, the faction-wide masks 77 and 178) and the lint checks of an accepted quest.
 * Records are synthetic (made-up ids and values).
 */

const q = questId;
const PRE = questRecord(1).prerequisites;
const REQ = questRecord(1).requirements;

function quest(id: number, fields: Partial<QuestRecord> & { pre?: Partial<QuestRecord['prerequisites']>; req?: Partial<QuestRecord['requirements']> } = {}): QuestRecord {
  const { pre, req, ...rest } = fields;
  return questRecord(id, { level: 10, minLevel: 1, ...rest, prerequisites: { ...PRE, ...pre }, requirements: { ...REQ, ...req } });
}

const state = stateWith;

const RECORDS: QuestRecord[] = [
  quest(1),
  quest(2, { flags: { repeatable: true, needsEvent: false, questFlags: 0, specialFlags: 1 } }),
  quest(3, { minLevel: 12 }),
  quest(4, { maxLevel: 12 }),
  quest(5, { maxLevel: 0 }),
  // VAL-8, VAL-9
  quest(10, { pre: { preQuestSingle: [q(1), q(2)] } }),
  quest(11, { pre: { preQuestGroup: [1, 20, -21] } }),
  quest(20, { pre: { exclusiveTo: [q(22)] } }),
  quest(21),
  quest(22, { pre: { exclusiveTo: [q(20)] } }),
  // VAL-10
  quest(30, { minLevel: 50, pre: { parentQuest: q(31) } }),
  quest(31, { pre: { childQuests: [q(30)] } }),
  // VAL-11, VAL-21
  quest(40, { pre: { nextQuestInChain: q(41) } }),
  quest(41),
  // VAL-12
  quest(50, { pre: { exclusiveTo: [q(51), q(52)] } }),
  quest(51, { pre: { exclusiveTo: [q(50), q(52)] } }),
  quest(52, { pre: { exclusiveTo: [q(50), q(51)] } }),
  // VAL-13, VAL-14
  quest(60, { pre: { breadcrumbForQuestId: q(61) } }),
  quest(61, { pre: { breadcrumbs: [q(60)] } }),
  quest(62, { pre: { breadcrumbForQuestId: q(63) } }),
  quest(63, { minLevel: 30 }),
  // VAL-15..19
  quest(70, { req: { skill: { skillId: skillId(186), value: 50 } } }),
  quest(71, { req: { minReputation: { factionId: factionId(76), value: 3000 } } }),
  quest(72, { req: { maxReputation: { factionId: factionId(76), value: 3000 } } }),
  quest(73, { req: { minReputation: { factionId: factionId(76), value: 0 }, maxReputation: { factionId: factionId(76), value: 3000 } } }),
  quest(74, { req: { spell: 100 } }),
  quest(75, { req: { spell: -100 } }),
  quest(76, { pre: { availableUntilCompleted: q(1) } }),
  quest(77, { pre: { availableStartingWith: q(1) } }),
  quest(78, { pre: { disabledByQuest: q(1) } }),
  quest(79, { req: { specialization: 20219 } }),
  // Masks
  quest(80, { races: 178 }),
  quest(81, { races: 77 }),
  quest(82, { races: 1 }),
  quest(83, { races: 2 ** 32 }),
  quest(84, { races: 2 ** 33 + 2 }),
  quest(85, { races: 0 }),
  quest(86, { races: 77 + 2 ** 33 }),
  quest(87, { classes: 1247 }),
  quest(88, { classes: 2 ** 10 }),
  quest(89, { classes: 0 }),
  // VAL-22, lint
  quest(90, { flags: { repeatable: false, needsEvent: true, questFlags: 0, specialFlags: 2 } }),
  quest(91, { pre: { preQuestSingle: [q(1)], preQuestGroup: [21] } }),
  quest(92, { pre: { exclusiveTo: [q(1)] } }),
  quest(93, { pre: { parentQuest: q(1) } }),
  quest(94, { pre: { nextQuestInChain: q(999) } }),
  quest(95, { level: 3, xp: { questLevel: 3, baseXp: 290, basis: 'era-seed' } }),
  quest(96, { level: 3, xp: null }),
  quest(97, { level: -1 }),
];

const DATA = fixtureDataset({ quests: RECORDS });
const WITH_LIST = { ...DATA, quests: () => RECORDS };
const RULES = effectiveRules(FOREVER_BETA);
const CHECKS = createAcceptChecks({ dataset: DATA, rules: RULES });

const subject = (character: Partial<CharacterProfile> = {}) => availabilitySubject(defaultCharacter(character));
const HORDE = subject();

function codes(questNumber: number, at = state(), who = HORDE, lint = false): string[] {
  return CHECKS.check(q(questNumber), at, who, lint).map((finding) => finding.code);
}

function only(questNumber: number, at = state(), who = HORDE): AcceptFinding {
  const findings = CHECKS.check(q(questNumber), at, who, false);
  expect(findings).toHaveLength(1);
  const [finding] = findings;
  if (finding === undefined) throw new Error('no finding');
  return finding;
}

describe('status: VAL-1, VAL-2 (VAL-3 repeatable exemption)', () => {
  it('VAL-1: a quest in the log is not acceptable', () => {
    expect(codes(1)).toEqual([]);
    expect(codes(1, state({ log: [1] }))).toEqual(['VAL001-already-in-log']);
  });

  it('VAL-2: a turned-in quest is not acceptable unless repeatable; VAL-1 still applies to a repeatable quest', () => {
    expect(codes(1, state({ completed: [1] }))).toEqual(['VAL002-already-completed']);
    expect(codes(2, state({ completed: [2] }))).toEqual([]);
    expect(codes(2, state({ completed: [2], log: [2] }))).toEqual(['VAL001-already-in-log']);
  });
});

describe('level: VAL-4, VAL-5 and their uncertain variants (§7.6)', () => {
  it('VAL-4 passes at the required level and fails below it', () => {
    expect(codes(3, state({ level: 12 }))).toEqual([]);
    const finding = only(3, state({ level: 11 }));
    expect(finding.code).toBe('VAL004-min-level');
    expect(finding.data).toEqual({ requiredLevel: 12, level: 11, levelBasis: 'source', levelEraFallback: false });
  });

  it('VAL-4 failing on the lower bound is the -uncertain warning (TIME-T 20)', () => {
    expect(codes(3, state({ level: 11, unknownXpEvents: 1 }))).toEqual(['VAL004-min-level-uncertain']);
    expect(codes(3, state({ level: 12, unknownXpEvents: 1 }))).toEqual([]);
  });

  it('VAL-5 passes at the limit, fails above it, and stays an error on the lower bound', () => {
    expect(codes(4, state({ level: 12 }))).toEqual([]);
    expect(only(4, state({ level: 13 })).data).toEqual({ maxLevel: 12, level: 13, levelBasis: 'source', levelEraFallback: false, levelIsLowerBound: false });
    expect(codes(4, state({ level: 13, unknownXpEvents: 2 }))).toEqual(['VAL005-max-level']);
    expect(only(4, state({ level: 13, unknownXpEvents: 2 })).words).toEqual({ quest: 'Quest 4 (4)', levelText: 'at least level 13' });
  });

  it('VAL-5 passing on the lower bound is the -uncertain warning; a limit of 0 is none', () => {
    expect(codes(4, state({ level: 12, unknownXpEvents: 1 }))).toEqual(['VAL005-max-level-uncertain']);
    expect(codes(5, state({ level: 60, unknownXpEvents: 1 }))).toEqual([]);
  });
});

describe('masks: VAL-6, VAL-7 (§7.3, D-012)', () => {
  const race = (questNumber: number, token: CharacterProfile['race']): string[] => codes(questNumber, state(), subject({ race: token }));

  it('the Horde mask 178 admits every Horde race and Windshaper Skyborne, and no Alliance race', () => {
    for (const token of ['Orc', 'Scourge', 'Tauren', 'Troll', 'WindshaperSkyborne'] as const) expect(race(80, token), token).toEqual([]);
    for (const token of ['Human', 'Dwarf', 'NightElf', 'Gnome', 'HighOrderSkyborne'] as const) expect(race(80, token), token).toEqual(['VAL006-race']);
  });

  it('the Alliance mask 77 admits every Alliance race and High Order Skyborne, and no Horde race', () => {
    for (const token of ['Human', 'Dwarf', 'NightElf', 'Gnome', 'HighOrderSkyborne'] as const) expect(race(81, token), token).toEqual([]);
    for (const token of ['Orc', 'Troll', 'WindshaperSkyborne'] as const) expect(race(81, token), token).toEqual(['VAL006-race']);
  });

  it('any other mask needs the race bit: Human-only stays closed to Skyborne; bits 32 and 33 are read', () => {
    expect(race(82, 'Human')).toEqual([]);
    expect(race(82, 'HighOrderSkyborne')).toEqual(['VAL006-race']);
    expect(race(83, 'HighOrderSkyborne')).toEqual([]);
    expect(race(83, 'Human')).toEqual(['VAL006-race']);
    expect(race(84, 'WindshaperSkyborne')).toEqual([]);
    expect(race(84, 'Orc')).toEqual([]);
    expect(race(84, 'Troll')).toEqual(['VAL006-race']);
    // 77 plus bit 33 is not the exact faction mask: High Order Skyborne needs its own bit 32.
    expect(race(86, 'WindshaperSkyborne')).toEqual([]);
    expect(race(86, 'HighOrderSkyborne')).toEqual(['VAL006-race']);
    expect(race(86, 'Human')).toEqual([]);
  });

  it('a null or 0 race mask admits every race', () => {
    expect(race(1, 'HighOrderSkyborne')).toEqual([]);
    expect(race(85, 'WindshaperSkyborne')).toEqual([]);
  });

  it('VAL-6 names the race and the mask', () => {
    expect(only(80, state(), subject({ race: 'HighOrderSkyborne', faction: 'Alliance' })).data).toEqual({ race: 'HighOrderSkyborne', races: 178 });
  });

  it('VAL-7: class bit classId - 1; null or 0 admits every class', () => {
    const cls = (questNumber: number, token: CharacterProfile['class']): string[] => codes(questNumber, state(), subject({ class: token }));
    expect(cls(87, 'WARRIOR')).toEqual([]);
    expect(cls(87, 'DRUID')).toEqual([]);
    expect(cls(87, 'WARLOCK')).toEqual(['VAL007-class']);
    expect(cls(88, 'DRUID')).toEqual([]);
    expect(cls(88, 'MAGE')).toEqual(['VAL007-class']);
    expect(cls(89, 'WARLOCK')).toEqual([]);
    expect(only(87, state(), subject({ class: 'WARLOCK' })).data).toEqual({ class: 'WARLOCK', classes: 1247 });
  });
});

describe('prerequisites: VAL-8..10 and the unverifiable variants (§7.6)', () => {
  const unknownHistory = subject({ priorHistory: 'unknown' });

  it('VAL-8: one listed quest turned in is enough', () => {
    expect(codes(10, state({ completed: [2] }))).toEqual([]);
    const finding = only(10);
    expect(finding.code).toBe('VAL008-prequest-single');
    expect(finding.data).toEqual({ quests: '1,2' });
    expect(finding.words).toEqual({ quest: 'Quest 10 (10)', questNames: 'Quest 1 (1) and Quest 2 (2)' });
  });

  it('VAL-8 with an unknown history: -unverifiable while a listed quest is untouched, an error once the route proves it (TIME-T 31)', () => {
    expect(codes(10, state(), unknownHistory)).toEqual(['VAL008-prequest-single-unverifiable']);
    expect(codes(10, state(), subject({ priorHistory: 'listed' }))).toEqual(['VAL008-prequest-single']);
    expect(codes(10, state({ log: [1], accepted: [1], abandoned: [2] }), unknownHistory)).toEqual(['VAL008-prequest-single']);
  });

  it('VAL-9: every entry, a positive one or its exclusive sibling, a negative one exactly', () => {
    expect(codes(11, state({ completed: [1, 20, 21] }))).toEqual([]);
    expect(codes(11, state({ completed: [1, 22, 21] }))).toEqual([]);
    expect(only(11, state({ completed: [1, 20] })).data).toEqual({ quests: '21' });
    expect(only(11, state({ completed: [21] })).data).toEqual({ quests: '1,20' });
  });

  it('VAL-9 with an unknown history: -unverifiable only when every missing entry could have been done before', () => {
    expect(codes(11, state({ completed: [1, 20] }), unknownHistory)).toEqual(['VAL009-prequest-group-unverifiable']);
    expect(codes(11, state({ completed: [1, 20], log: [21] }), unknownHistory)).toEqual(['VAL009-prequest-group']);
  });

  it('VAL-9 is not evaluated when the single list is set (LINT-1)', () => {
    expect(codes(91, state({ completed: [1] }))).toEqual([]);
    expect(codes(91, state({ completed: [1] }), HORDE, true)).toContain('LINT001-prequest-both');
  });

  it('VAL-10: the parent must be in the log, and then lifts the level requirement', () => {
    expect(codes(30, state({ level: 5, log: [31] }))).toEqual([]);
    expect(codes(30, state({ level: 5 }))).toEqual(['VAL010-parent-not-active', 'VAL004-min-level']);
    expect(codes(30, state({ level: 50 }), unknownHistory)).toEqual(['VAL010-parent-not-active-unverifiable']);
    expect(codes(30, state({ level: 50, completed: [31] }), unknownHistory)).toEqual(['VAL010-parent-not-active']);
  });
});

describe('chains, exclusive groups and breadcrumbs: VAL-11..14, VAL-21', () => {
  it('VAL-11: the next chain step taken or done closes the quest', () => {
    expect(codes(40)).toEqual([]);
    expect(codes(40, state({ log: [41] }))).toEqual(['VAL011-later-chain-step']);
    expect(only(40, state({ completed: [41] })).data).toEqual({ nextQuestId: 41 });
  });

  it('VAL-12: no quest of the exclusive group taken or done', () => {
    expect(codes(50, state({ abandoned: [51] }))).toEqual([]);
    expect(only(50, state({ log: [52], completed: [51] })).data).toEqual({ quests: '51,52' });
  });

  it('VAL-13: the target taken or done is an error; a target that cannot be accepted is the vmangos warning', () => {
    expect(codes(60)).toEqual([]);
    expect(codes(60, state({ completed: [61] }))).toEqual(['VAL013-breadcrumb-target-taken']);
    expect(codes(60, state({ log: [61] }))).toEqual(['VAL013-breadcrumb-target-taken']);
    expect(only(62, state({ level: 20 })).data).toEqual({ targetQuestId: 63, reason: 'VAL004-min-level' });
    expect(codes(62, state({ level: 30 }))).toEqual([]);
  });

  it('VAL-14: a breadcrumb in the log closes its target', () => {
    expect(codes(61)).toEqual([]);
    expect(codes(61, state({ log: [60] }))).toEqual(['VAL014-breadcrumb-active']);
  });

  it('VAL-21: the previous chain step in the log is a warning, with and without a quest list', () => {
    expect(codes(41)).toEqual([]);
    expect(codes(41, state({ log: [40] }))).toEqual(['VAL021-previous-chain-active']);
    const indexed = createAcceptChecks({ dataset: WITH_LIST, rules: RULES });
    expect(indexed.check(q(41), state({ log: [40] }), HORDE, false).map((f) => f.code)).toEqual(['VAL021-previous-chain-active']);
    expect(indexed.check(q(41), state({ log: [1] }), HORDE, false)).toEqual([]);
  });
});

describe('profile data: VAL-15..19 and their unverifiable infos (§7.6)', () => {
  it('VAL-15: a declared value at the requirement passes; below it is an error', () => {
    expect(codes(70, state({ skills: { 186: 50 } }))).toEqual([]);
    expect(only(70, state({ skills: { 186: 49 } })).data).toEqual({ skillId: 186, requiredValue: 50, value: 49 });
    expect(only(70, state({ skills: { 186: 49 } })).code).toBe('VAL015-skill');
  });

  it('VAL-15: an undeclared skill, or one the route trained (a lower bound), is unverifiable', () => {
    expect(only(70).data).toEqual({ skillId: 186, requiredValue: 50, value: null, reason: 'not-declared' });
    const trained = only(70, state({ skills: { 186: 1 }, trainedSkills: [186] }));
    expect(trained.code).toBe('VAL015-skill-unverifiable');
    expect(trained.data).toEqual({ skillId: 186, requiredValue: 50, value: 1, reason: 'trained-in-route' });
  });

  it('VAL-16: min inclusive, max exclusive, on the declared standing plus the route rewards', () => {
    const declared = (value: number) => subject({ reputation: { '76': value } });
    expect(codes(71, state(), declared(3000))).toEqual([]);
    expect(codes(71, state(), declared(2999))).toEqual(['VAL016-reputation']);
    expect(codes(71, state({ reputationDelta: { 76: 1 } }), declared(2999))).toEqual([]);
    expect(codes(72, state(), declared(2999))).toEqual([]);
    expect(only(72, state(), declared(3000)).data).toEqual({ factionId: 76, min: null, max: 3000, value: 3000 });
    expect(only(73, state(), declared(-1)).data).toEqual({ factionId: 76, min: 0, max: 3000, value: -1 });
    expect(only(73, state(), declared(-1)).words).toEqual({ quest: 'Quest 73 (73)', rangeText: 'from 0 to below 3000' });
  });

  it('VAL-16: no declared reputation, or no value for the faction, is unverifiable', () => {
    expect(only(71).code).toBe('VAL016-reputation-unverifiable');
    expect(only(73).data).toEqual({ factionId: 76, min: 0, max: 3000 });
    expect(codes(71, state(), subject({ reputation: { '81': 0 } }))).toEqual(['VAL016-reputation-unverifiable']);
  });

  it('VAL-17: only spells trained in the route are known', () => {
    expect(codes(74, state({ knownSpells: [100] }))).toEqual([]);
    expect(only(74).data).toEqual({ spellId: 100, mustKnow: true });
    expect(only(74).code).toBe('VAL017-spell-unverifiable');
    expect(only(75, state({ knownSpells: [100] })).code).toBe('VAL017-spell');
    expect(only(75).data).toEqual({ spellId: 100, mustKnow: false });
  });

  it('VAL-18: until completed, starting with, disabled by', () => {
    expect(codes(76)).toEqual([]);
    expect(only(76, state({ completed: [1] })).data).toEqual({ part: 'until-completed', relatedQuestId: 1 });
    expect(codes(77, state({ log: [1] }))).toEqual([]);
    expect(codes(77, state({ completed: [1] }))).toEqual([]);
    expect(only(77).data).toEqual({ part: 'starting-with', relatedQuestId: 1 });
    expect(codes(77, state(), subject({ priorHistory: 'unknown' }))).toEqual(['VAL018-availability-window-unverifiable']);
    expect(codes(77, state({ abandoned: [1] }), subject({ priorHistory: 'unknown' }))).toEqual(['VAL018-availability-window']);
    expect(codes(78, state({ completed: [1] }))).toEqual([]);
    expect(only(78, state({ log: [1] })).data).toEqual({ part: 'disabled-by', relatedQuestId: 1 });
  });

  it('VAL-19: a specialisation requirement is always unverifiable in version 1', () => {
    expect(codes(1)).toEqual([]);
    expect(only(79).code).toBe('VAL019-specialization-unverifiable');
  });
});

describe('log capacity, events and unknown quests: VAL-20, VAL-22, DATA002', () => {
  const log = (size: number): number[] => Array.from({ length: size }, (_, i) => 1000 + i);

  it('VAL-20: the effective questLogCapacity (40 in forever-beta, 20 in era-1.15, or the project value)', () => {
    expect(codes(1, state({ log: log(39) }))).toEqual([]);
    expect(only(1, state({ log: log(40) })).data).toEqual({ size: 40, capacity: 40, capacityBasis: 'client-data' });
    const era = createAcceptChecks({ dataset: DATA, rules: effectiveRules(ERA_1_15) });
    expect(era.check(q(1), state({ log: log(20) }), HORDE, false).map((f) => f.code)).toEqual(['VAL020-quest-log-full']);
    const project = createAcceptChecks({ dataset: DATA, rules: effectiveRules(FOREVER_BETA, { questLogCapacity: 25 }) });
    expect(project.check(q(1), state({ log: log(25) }), HORDE, false)[0]?.data).toEqual({ size: 25, capacity: 25, capacityBasis: 'assumption' });
    // A quest already in the log is VAL-1, not VAL-20.
    expect(codes(1000, state({ log: log(40) }))).toEqual(['VAL001-already-in-log', 'DATA002-unknown-quest']);
  });

  it('VAL-22: needs-event is an info that never blocks', () => {
    const findings = CHECKS.check(q(90), state(), HORDE, false);
    expect(findings.map((f) => f.code)).toEqual(['VAL022-needs-event']);
    expect(acceptTruth(findings)).toBe('true');
  });

  it('DATA002: an unknown quest is a warning, checked as far as the state allows', () => {
    expect(codes(12345)).toEqual(['DATA002-unknown-quest']);
    expect(codes(12345, state({ log: [12345] }))).toEqual(['VAL001-already-in-log', 'DATA002-unknown-quest']);
  });
});

describe('lint on accept: LINT-1..3', () => {
  it('LINT-2: an exclusive link not returned, a parent without the child, a dangling link', () => {
    const lint = (questNumber: number): AcceptFinding[] => CHECKS.check(q(questNumber), state(), HORDE, true).filter((f) => f.code === 'LINT002-link-mismatch');
    expect(lint(50)).toEqual([]);
    expect(lint(92)[0]?.data).toEqual({ exclusiveNotReturned: '1', parentChildMismatch: null, dangling: null });
    expect(lint(93)[0]?.data).toEqual({ exclusiveNotReturned: null, parentChildMismatch: '1', dangling: null });
    expect(lint(94)[0]?.data).toEqual({ exclusiveNotReturned: null, parentChildMismatch: null, dangling: '999' });
    expect(lint(94)[0]?.words.detailText).toBe('links to missing quest 999');
  });

  it('LINT-3: grey or 0 XP at the accept level; unknown XP does not count; certain on the lower bound', () => {
    expect(codes(95, state({ level: 7 }), HORDE, true)).toEqual([]);
    const grey = CHECKS.check(q(95), state({ level: 8 }), HORDE, true);
    expect(grey.map((f) => f.code)).toEqual(['LINT003-low-value']);
    expect(grey[0]?.data).toEqual({
      level: 8,
      levelBasis: 'source',
      levelEraFallback: false,
      questLevel: 3,
      difficulty: 'trivial',
      xp: 290,
      xpBasis: 'assumption',
      eraFallback: true,
      assumed: 'greenRange,difficultyYellowLowerBound',
    });
    expect(codes(96, state({ level: 8 }), HORDE, true)).toEqual(['LINT003-low-value']);
    expect(CHECKS.check(q(96), state({ level: 8 }), HORDE, true)[0]?.data?.xp).toBeNull();
    expect(codes(95, state({ level: 8, unknownXpEvents: 1 }), HORDE, true)).toEqual(['LINT003-low-value']);
    // A scaling quest (level -1) is at the player's level: never grey.
    expect(codes(97, state({ level: 30 }), HORDE, true)).toEqual([]);
  });

  it('LINT-3: 0 XP at the level cap', () => {
    const capped = createAcceptChecks({ dataset: DATA, rules: effectiveRules(FOREVER_BETA, { maxLevel: 10 }) });
    const findings = capped.check(q(1), state({ level: 10 }), HORDE, true);
    expect(findings.map((f) => f.code)).toEqual(['LINT003-low-value']);
    expect(findings[0]?.data).toMatchObject({ difficulty: 'difficult', xp: 0, assumed: 'maxLevel' });
    expect(findings[0]?.words.reasonText).toBe('it gives 0 XP');
  });
});

describe('accept policy', () => {
  it('reads errors as false, doubts as unknown, and the rest as true', () => {
    const policy = createAvailabilityPolicy(CHECKS, () => HORDE);
    expect(policy.acceptable(q(1), state())).toBe('true');
    expect(policy.acceptable(q(1), state({ log: [1] }))).toBe('false');
    expect(policy.acceptable(q(3), state({ level: 5, unknownXpEvents: 1 }))).toBe('unknown');
    expect(policy.acceptable(q(12345), state())).toBe('unknown');
    expect(policy.acceptable(q(70), state())).toBe('unknown');
    expect(policy.acceptable(q(41), state({ log: [40] }))).toBe('unknown');
    expect(policy.acceptable(q(90), state())).toBe('true');
  });

  it('never returns lint findings, which do not affect availability', () => {
    expect(CHECKS.check(q(95), state({ level: 30 }), HORDE, false)).toEqual([]);
  });
});
