import { describe, expect, it } from 'vitest';
import type { FilterAst, StatePredicate, Truth } from '../domain/conditions';
import { questId } from '../domain/ids';
import { DEFAULT_ROUTE_PROFILE, defaultCharacter } from '../domain/project-factory';
import type { CharacterProfile, RouteProfile } from '../domain/project';
import {
  and3,
  type ConditionSubject,
  evaluateFilter,
  evaluateFilterWord,
  evaluatePredicate,
  evaluateSkipIf,
  evaluateStaticCondition,
  evaluateVariantTag,
  evaluateVariantValue,
  not3,
  or3,
  type PredicateContext,
} from './conditions';
import { createBasicAcceptPolicy } from './accept';
import { cloneState } from './state';
import { fixtureDataset, killObjective, questRecord } from './test-helpers';
import type { CharacterState, ReadonlyCharacterState } from './types';

/**
 * Condition evaluation (docs/RXP.md §6.3-§6.5, §8.2, §12.2, §14 rows 5-6): three-valued, with
 * unknown profile values giving `unknown`, never a silent false.
 */

const subject = (character: Partial<CharacterProfile> = {}, profile: Partial<RouteProfile> = {}): ConditionSubject => ({
  character: defaultCharacter({ faction: 'Horde', race: 'Orc', class: 'WARRIOR', startLevel: 10, ...character }),
  routeProfile: { ...DEFAULT_ROUTE_PROFILE, ...profile },
});
const word = (w: string): FilterAst => ({ kind: 'word', word: w });

describe('three-valued logic', () => {
  it('AND, OR and NOT follow RXP.md §6.5 (empty AND true, empty OR false)', () => {
    expect(and3([])).toBe('true');
    expect(or3([])).toBe('false');
    expect(and3(['true', 'unknown'])).toBe('unknown');
    expect(and3(['unknown', 'false'])).toBe('false');
    expect(or3(['false', 'unknown'])).toBe('unknown');
    expect(or3(['unknown', 'true'])).toBe('true');
    expect(not3('unknown')).toBe('unknown');
    expect(not3('true')).toBe('false');
  });
});

describe('filter words (RXP.md §6.3)', () => {
  const orc = subject();
  it.each<[string, Truth]>([
    ['Warrior', 'true'],
    ['WARRIOR', 'true'],
    ['Mage', 'false'],
    ['DK', 'false'],
    ['Orc', 'true'],
    ['orc', 'false'],
    ['Troll', 'false'],
    ['Horde', 'true'],
    ['Alliance', 'false'],
    ['Aliance', 'false'],
    ['Forever', 'true'],
    ['Classic', 'false'],
    ['enUS', 'true'],
    ['deDE', 'false'],
    ['skip', 'false'],
    ['Skyborne', 'false'],
  ])('%s for a level-10 Orc warrior is %s', (w, expected) => {
    expect(evaluateFilterWord(w, orc)).toBe(expected);
  });

  it('Undead is RXP’s spelling of Scourge', () => {
    expect(evaluateFilterWord('Undead', subject({ faction: 'Horde', race: 'Scourge' }))).toBe('true');
  });

  it('race words are unknown for a Skyborne character (its client token is unverified)', () => {
    const skyborne = subject({ faction: 'Alliance', race: 'HighOrderSkyborne' });
    expect(evaluateFilterWord('Skyborne', skyborne)).toBe('unknown');
    expect(evaluateFilterWord('Human', skyborne)).toBe('unknown');
    expect(evaluateFilterWord('Alliance', skyborne)).toBe('true');
  });

  it('sex and season words are unknown while the profile does not know them', () => {
    expect(evaluateFilterWord('Male', subject({ sex: null }))).toBe('unknown');
    expect(evaluateFilterWord('Female', subject({ sex: 'female' }))).toBe('true');
    expect(evaluateFilterWord('SoD', subject({}, { season: null }))).toBe('unknown');
    expect(evaluateFilterWord('SoD', subject({}, { season: 2 }))).toBe('true');
    expect(evaluateFilterWord('sod', subject({}, { season: 0 }))).toBe('false');
  });

  it('level words use the start level; operators combine three-valued', () => {
    expect(evaluateFilter({ kind: 'minLevel', level: 10 }, orc)).toBe('true');
    expect(evaluateFilter({ kind: 'minLevel', level: 11 }, orc)).toBe('false');
    expect(evaluateFilter({ kind: 'not', expr: { kind: 'minLevel', level: 11 } }, orc)).toBe('true');
    const skyborne = subject({ faction: 'Horde', race: 'WindshaperSkyborne' });
    expect(evaluateFilter({ kind: 'or', exprs: [word('Skyborne'), word('Mage')] }, skyborne)).toBe('unknown');
    expect(evaluateFilter({ kind: 'or', exprs: [word('Skyborne'), word('Warrior')] }, skyborne)).toBe('true');
    expect(evaluateFilter({ kind: 'and', exprs: [word('Skyborne'), word('Mage')] }, skyborne)).toBe('false');
    expect(evaluateFilter({ kind: 'and', exprs: [] }, orc)).toBe('true');
    expect(evaluateFilter({ kind: 'or', exprs: [] }, orc)).toBe('false');
  });
});

describe('variant entries (RXP.md §8.1, §8.2, §12.2)', () => {
  const s = subject({}, { xpRate: 1.5, season: 2, phase: 6, dungeons: ['RFC'], groupQuests: false, ssf: false, hardcore: false });
  it.each<[string, string | null, Truth]>([
    ['xprate', '<1.5', 'false'],
    ['xprate', '<1.59', 'true'],
    ['xprate', '>1.2', 'true'],
    ['xprate', '1.1-1.5', 'true'],
    ['xprate', 'fast', 'unknown'],
    ['season', '0,1', 'false'],
    ['season', '0 2', 'true'],
    ['era', null, 'false'],
    ['phase', '1-4', 'false'],
    ['phase', '6', 'true'],
    ['softcore', null, 'true'],
    ['hardcore', null, 'false'],
    ['hardcoreserver', null, 'unknown'],
    ['ah', null, 'true'],
    ['ssf', null, 'false'],
    ['maxlevel', '9', 'false'],
    ['maxlevel', '10', 'true'],
    ['aldor', null, 'true'],
    ['.dungeon', 'RFC', 'true'],
    ['.dungeon', 'rfc', 'true'],
    ['.dungeon', '!RFC', 'false'],
    ['.dungeon', 'WC', 'false'],
    ['.group', null, 'false'],
    ['.solo', null, 'true'],
    ['.profession', 'Herbalism', 'unknown'],
    ['sofcore', null, 'unknown'],
  ])('%s %s is %s', (name, value, expected) => {
    expect(evaluateVariantValue({ name, value }, s)).toBe(expected);
  });

  it('a season entry is unknown while the season is null', () => {
    expect(evaluateVariantValue({ name: 'season', value: '2' }, subject({}, { season: null }))).toBe('unknown');
    expect(evaluateVariantValue({ name: 'som', value: null }, subject({}, { season: null }))).toBe('unknown');
  });

  it('#maxlevel applies only while XP step skipping is on', () => {
    expect(evaluateVariantValue({ name: 'maxlevel', value: '9' }, subject({}, { xpStepSkipping: false }))).toBe('true');
  });

  it('a filtered entry applies only to characters its filter admits', () => {
    expect(evaluateVariantTag({ name: 'hardcore', value: null, filter: word('Mage') }, s)).toBe('true');
    expect(evaluateVariantTag({ name: 'hardcore', value: null, filter: word('Warrior') }, s)).toBe('false');
    const skyborne = subject({ faction: 'Horde', race: 'WindshaperSkyborne' });
    expect(evaluateVariantTag({ name: 'hardcore', value: null, filter: word('Troll') }, skyborne)).toBe('unknown');
    expect(evaluateVariantTag({ name: 'softcore', value: null, filter: word('Troll') }, skyborne)).toBe('true');
  });

  it('a static condition is its filter AND its entries', () => {
    expect(evaluateStaticCondition(null, s)).toBe('true');
    expect(evaluateStaticCondition({ filter: word('Orc'), variant: [{ name: 'softcore', value: null, filter: null }], skipIf: [] }, s)).toBe('true');
    expect(evaluateStaticCondition({ filter: word('Orc'), variant: [{ name: 'hardcore', value: null, filter: null }], skipIf: [] }, s)).toBe('false');
    expect(evaluateStaticCondition({ filter: null, variant: [{ name: 'hardcoreserver', value: null, filter: null }], skipIf: [] }, s)).toBe('unknown');
  });
});

describe('skip predicates (RXP.md §12.2, §14 row 5)', () => {
  const dataset = fixtureDataset({ quests: [questRecord(1, { objectives: [killObjective(1)] }), questRecord(2), questRecord(3, { minLevel: 12 })] });
  const policy = createBasicAcceptPolicy(dataset);
  const base = (): CharacterState =>
    cloneState({
      timeSec: 0,
      location: null,
      locationHint: 0,
      locationCause: 'start-unset',
      level: 10,
      xp: 500,
      unknownXpEvents: 0,
      xpBasis: 'source',
      xpEraFallback: false,
      questLog: new Map([[questId(1), { objectives: ['open'], failed: false, routeAccepted: true }]]),
      completed: new Set([questId(2)]),
      abandoned: new Set(),
      acceptedInRoute: new Set([questId(1)]),
      itemsBeforeAccept: new Map(),
      knownFlightPaths: new Set(),
      hearth: null,
      hearthHint: 0,
      hearthReadyAt: 0,
      sinceCastBasis: 'source',
      sinceCastEraFallback: false,
      riding: { trained: 0, speedBonus: 0 },
      skills: new Map(),
      trainedSkills: new Set(),
      reputationDelta: new Map(),
      knownSpells: new Set(),
    });
  const ctx = (overrides: Partial<PredicateContext> = {}): PredicateContext => ({ priorHistory: 'listed', xpStepSkipping: true, acceptPolicy: policy, ...overrides });
  const quest = (state: 'onQuest' | 'complete' | 'turnedIn' | 'available', ids: readonly number[], negate = false, match: 'any' | 'all' = 'any'): StatePredicate => ({
    kind: 'questState',
    state,
    questIds: ids.map(questId),
    match,
    negate,
  });
  const run = (predicate: StatePredicate, state: ReadonlyCharacterState = base(), context = ctx()) => evaluatePredicate(predicate, state, context);

  it('quest states against the log and the completed set', () => {
    expect(run(quest('onQuest', [1]))).toBe('true');
    expect(run(quest('onQuest', [2]))).toBe('false');
    expect(run(quest('onQuest', [1], true))).toBe('false');
    expect(run(quest('complete', [1]))).toBe('false');
    expect(run(quest('turnedIn', [2, 4]))).toBe('true');
    expect(run(quest('turnedIn', [2, 4], false, 'all'))).toBe('false');
    const done = base();
    done.questLog.set(questId(1), { objectives: ['done'], failed: false, routeAccepted: true });
    expect(run(quest('complete', [1]), done)).toBe('true');
  });

  it('with an unknown pre-route history, a quest the route never touched is unknown', () => {
    const unknownHistory = ctx({ priorHistory: 'unknown' });
    expect(run(quest('turnedIn', [9]), base(), unknownHistory)).toBe('unknown');
    expect(run(quest('onQuest', [9], true), base(), unknownHistory)).toBe('unknown');
    expect(run(quest('onQuest', [1]), base(), unknownHistory)).toBe('true');
  });

  it('available asks the accept policy', () => {
    expect(run(quest('available', [2]))).toBe('false');
    expect(run(quest('available', [3]))).toBe('false');
    expect(run(quest('available', [99]))).toBe('unknown');
  });

  it('level skips: without `<` only while XP step skipping is on; lower bounds are unknown', () => {
    const atLeast = (level: number, xp: number | null = null, negate = false): StatePredicate => ({ kind: 'levelAtLeast', level, xp, negate });
    expect(run(atLeast(10))).toBe('true');
    expect(run(atLeast(10, 600))).toBe('false');
    expect(run(atLeast(11))).toBe('false');
    expect(run(atLeast(10), base(), ctx({ xpStepSkipping: false }))).toBe('false');
    expect(run(atLeast(11, null, true), base(), ctx({ xpStepSkipping: false }))).toBe('true');
    const uncertain = base();
    uncertain.unknownXpEvents = 1;
    expect(run(atLeast(11), uncertain)).toBe('unknown');
    expect(run(atLeast(11, null, true), uncertain)).toBe('unknown');
    expect(run(atLeast(9, null, true), uncertain)).toBe('false');
  });

  it('opaque predicates are unknown; a skip list is their OR', () => {
    expect(run({ kind: 'opaque', raw: '.cooldown item,6948' })).toBe('unknown');
    expect(evaluateSkipIf([], base(), ctx())).toBe('false');
    expect(evaluateSkipIf([{ kind: 'opaque', raw: '.money <5' }, quest('onQuest', [1])], base(), ctx())).toBe('true');
    expect(evaluateSkipIf([{ kind: 'opaque', raw: '.money <5' }, quest('onQuest', [2])], base(), ctx())).toBe('unknown');
  });
});
