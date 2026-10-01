import { describe, expect, it } from 'vitest';
import { npcId, questId, skillId, stepId } from '../domain/ids';
import type { QuestRecord } from '../domain/dataset';
import type { CharacterState, ReadonlyQuestLogEntry, StepRecord } from '../engine/types';
import { fixtureGeometry } from '../geo/test-fixtures';
import { effectiveRules, FOREVER_BETA } from '../rules';
import { createAcceptChecks } from '../validate/availability';
import { stateWith, type StateFields } from '../validate/test-helpers';
import { MAP_TEST_DUROTAR, MAP_TEST_KALIMDOR, stubDataset, stubNpc, stubQuest, worldSpawn } from './map-test-helpers';
import { DRAW_LEVEL_CEILING, DRAWN_ROWS, LEVEL_WINDOW, PREREQUISITE_WINDOW, type QuestStateInput, type QuestStateModel, questStateModel, sameEntry, turnInOf } from './quest-state';
import { noStateText, withArticle } from './quest-state-text';
import { questsForCharacter } from './shell-support';
import { zoneSpans } from './zone-levels';

/**
 * The quest state at the selected step (map-presentation.md §7.1, §7.2, §7.5; step MP.3): every
 * class and reason, the windows, a lower-bound level giving "may be available", a turn-in whose
 * record is unknown never ready, and the words without route state.
 */

const GIVER = npcId(10);
const FINISHER = npcId(12);
const giver = [{ kind: 'npc' as const, id: GIVER }];
const finisher = [{ kind: 'npc' as const, id: FINISHER }];
const q = (id: number, fields: Partial<QuestRecord> & { readonly name: string }): QuestRecord =>
  stubQuest({ id: questId(id), level: 10, minLevel: 8, starters: giver, finishers: finisher, ...fields });

const QUESTS: readonly QuestRecord[] = [
  q(1, { name: 'Open door' }),
  q(2, { name: 'Grey chore', level: 4, minLevel: 1 }),
  q(3, { name: 'Soon', level: 13, minLevel: 10 + LEVEL_WINDOW }),
  q(4, { name: 'Far', level: 20, minLevel: 10 + LEVEL_WINDOW + 1 }),
  q(5, { name: 'Needs teeth', level: 11, prerequisites: { ...stubQuest({ id: questId(0), name: '' }).prerequisites, preQuestSingle: [questId(99)] } }),
  q(6, { name: 'Needs teeth, high', level: 10 + PREREQUISITE_WINDOW + 1, minLevel: 9, prerequisites: { ...stubQuest({ id: questId(0), name: '' }).prerequisites, preQuestSingle: [questId(99)] } }),
  q(7, { name: 'Follow-up', prerequisites: { ...stubQuest({ id: questId(0), name: '' }).prerequisites, preQuestSingle: [questId(98)] } }),
  q(8, { name: 'Both', level: 12, minLevel: 12, prerequisites: { ...stubQuest({ id: questId(0), name: '' }).prerequisites, preQuestSingle: [questId(99)] } }),
  q(9, { name: 'Too old for it', level: 6, minLevel: 1, maxLevel: 8 }),
  q(10, { name: 'Skinning', requirements: { ...stubQuest({ id: questId(0), name: '' }).requirements, skill: { skillId: skillId(393), value: 50 } } }),
  q(11, { name: 'Event', flags: { repeatable: false, needsEvent: true, questFlags: 0, specialFlags: 0 } }),
  q(12, { name: 'Unknown level', level: null, prerequisites: { ...stubQuest({ id: questId(0), name: '' }).prerequisites, preQuestSingle: [questId(99)] } }),
  q(13, { name: 'Dungeon run', dungeonQuest: true }),
  q(14, { name: 'Winter gifts', zoneOrSort: -404 }),
  q(94, { name: 'Done before' }),
  q(93, { name: 'Given up' }),
  q(95, { name: 'Ready one', objectives: [{ kind: 'kill', npcId: npcId(11), label: null, count: null }] }),
  q(96, { name: 'Declared log', objectives: [{ kind: 'kill', npcId: npcId(11), label: null, count: null }] }),
  q(97, { name: 'Half done', objectives: [{ kind: 'kill', npcId: npcId(11), label: null, count: null }, { kind: 'kill', npcId: npcId(11), label: null, count: null }] }),
  q(98, { name: 'Scout the camp' }),
  q(99, { name: 'Cutting Teeth' }),
];

const DATASET = stubDataset({
  quests: QUESTS,
  npcs: [stubNpc({ id: GIVER, name: 'Gornek' }), stubNpc({ id: npcId(11), name: 'Boar' }), stubNpc({ id: FINISHER, name: 'Zureetha' })],
  spawns: {
    'npc:10': [worldSpawn(MAP_TEST_KALIMDOR, 0, -4000, MAP_TEST_DUROTAR)],
    // Six Boars round (220, -4320): one 90 yd grid group, a four-cornered outline.
    'npc:11': [
      [200, -4300],
      [240, -4300],
      [200, -4340],
      [240, -4340],
      [220, -4320],
      [220, -4320],
    ].map(([x, y]) => worldSpawn(MAP_TEST_KALIMDOR, x ?? 0, y ?? 0, MAP_TEST_DUROTAR)),
    'npc:12': [worldSpawn(MAP_TEST_KALIMDOR, 50, -4100, MAP_TEST_DUROTAR)],
  },
  zones: [{ uiMapId: MAP_TEST_DUROTAR, name: 'Durotar', worldMapId: MAP_TEST_KALIMDOR }],
});
const GEOMETRY = fixtureGeometry();
const RULES = effectiveRules(FOREVER_BETA);
const CHARACTER = { race: 'Orc', class: 'WARRIOR', priorHistory: 'fresh', reputation: null } as const;

function logEntry(objectives: readonly ('open' | 'done')[], routeAccepted = true): ReadonlyQuestLogEntry {
  return { objectives: [...objectives], failed: false, routeAccepted };
}

/** Level 10 with quests 95-98 in the log (95 ready, 96 declared, 97 half done, 98 plain), 94 done and 93 abandoned. */
function baseState(fields: StateFields = {}): CharacterState {
  const state = stateWith({ level: 10, completed: [94], abandoned: [93], ...fields });
  state.questLog.set(questId(95), { ...logEntry(['done']), objectives: ['done'] });
  state.questLog.set(questId(96), { ...logEntry(['open'], false), objectives: ['open'] });
  state.questLog.set(questId(97), { ...logEntry(['done', 'open']), objectives: ['done', 'open'] });
  state.questLog.set(questId(98), { ...logEntry([]), objectives: [] });
  state.location = { mapId: MAP_TEST_KALIMDOR, x: 0, y: -4000 };
  return state;
}

function model(overrides: Partial<QuestStateInput> = {}, character: QuestStateInput['character'] = CHARACTER): QuestStateModel {
  return questStateModel({
    revision: 1,
    stepId: stepId('s-a'),
    stepIndex: 0,
    state: baseState(),
    records: [],
    dataset: DATASET,
    geometry: GEOMETRY,
    rules: RULES,
    character,
    checks: createAcceptChecks({ dataset: DATASET, rules: RULES }),
    open: questsForCharacter(DATASET, character).open,
    spans: zoneSpans(DATASET, GEOMETRY, character),
    ...overrides,
  });
}

const entryOf = (m: QuestStateModel, id: number) => {
  const entry = m.quests.get(questId(id));
  if (entry === undefined) throw new Error(`no entry for ${String(id)}`);
  return entry;
};

describe('questStateModel: classes and reasons (§7.2)', () => {
  const m = model();

  it('available, with its difficulty at the level after the step', () => {
    expect(entryOf(m, 1)).toMatchObject({ cls: 'available', mark: 'available', row: 'available', level: 10, difficulty: 'difficult', reason: 'Available (difficult, level 10)' });
  });

  it('low level when trivial by COL-1', () => {
    expect(entryOf(m, 2)).toMatchObject({ cls: 'low-level', mark: 'low-level', row: 'low-level', difficulty: 'trivial', reason: 'Low level (trivial, level 4)' });
  });

  it('unlocks soon within 3 levels, and outside beyond them', () => {
    expect(entryOf(m, 3)).toMatchObject({ cls: 'unlocks-soon', mark: 'unlocks-soon', row: 'unlocks-soon', reason: 'Unlocks at level 13' });
    expect(entryOf(m, 4)).toMatchObject({ cls: 'outside', outside: 'level-ahead', mark: 'unlocks-soon', row: null, reason: 'Unlocks at level 14' });
  });

  it('needs a prerequisite inside the window, naming it; outside the window beyond level + 4', () => {
    expect(entryOf(m, 5)).toMatchObject({ cls: 'locked', mark: 'locked', row: 'needs-prerequisite', reason: 'Needs “Cutting Teeth”', needs: [questId(99)] });
    expect(entryOf(m, 6)).toMatchObject({ cls: 'outside', outside: 'prerequisite-outside', reason: 'Needs “Cutting Teeth”; outside the window: level 15, more than 4 above' });
  });

  it('a follow-up of a quest in the log is outside the window', () => {
    expect(entryOf(m, 7)).toMatchObject({ cls: 'outside', outside: 'follow-up', reason: 'Follows “Scout the camp”, in the quest log; needs “Scout the camp”' });
  });

  it('locked by both a level and a prerequisite is outside the window', () => {
    expect(entryOf(m, 8)).toMatchObject({ cls: 'outside', outside: 'level-and-prerequisite', reason: 'Unlocks at level 12; needs “Cutting Teeth”' });
  });

  it('any other error closes it, with the check’s own words', () => {
    const entry = entryOf(m, 9);
    expect(entry).toMatchObject({ cls: 'outside', outside: 'closed', mark: 'locked', reason: 'It is offered only up to level 8; the character is level 10' });
    expect(entry.codes).toContain('VAL005-max-level');
  });

  it('another doubt (a skill the profile does not declare) is "may be available"', () => {
    const entry = entryOf(m, 10);
    expect(entry).toMatchObject({ cls: 'uncertain-other', mark: 'uncertain', row: 'may-be-available' });
    expect(entry.reason).toMatch(/^May be available: it needs skill 393 at 50; the profile does not declare this skill/);
  });

  it('VAL-22 never blocks: a quest whose completion needs a trigger is available', () => {
    expect(entryOf(m, 11)).toMatchObject({ cls: 'available', codes: [] });
  });

  it('an unknown quest level gives no difficulty and no window', () => {
    expect(entryOf(m, 12)).toMatchObject({ cls: 'outside', outside: 'level-unknown', level: null, difficulty: null, reason: 'Needs “Cutting Teeth”; its level is unknown' });
  });

  it('a holiday or event quest is outside the windows, with its category (the design’s "event-only" row)', () => {
    expect(entryOf(m, 14)).toMatchObject({ cls: 'outside', outside: 'event', mark: 'locked', row: null, reason: 'Offered only while its holiday or event is on (QuestieDB event category -404)' });
  });

  it('keeps the dungeon-quest flag for the arch badge', () => {
    expect(entryOf(m, 13)).toMatchObject({ cls: 'available', dungeonQuest: true });
  });

  it('done: turned in or abandoned', () => {
    expect(entryOf(m, 94)).toMatchObject({ cls: 'done', mark: null, row: null, reason: 'Turned in' });
    expect(entryOf(m, 93)).toMatchObject({ cls: 'done', reason: 'Abandoned' });
  });

  it('counts every class and row, and the outside reasons', () => {
    expect(m.counts.rows).toMatchObject({ available: 4, 'may-be-available': 1, 'needs-prerequisite': 1, 'unlocks-soon': 1, 'low-level': 1, 'turn-ins': 4 });
    expect(m.counts.outside).toEqual({ 'level-ahead': 1, 'prerequisite-outside': 1, 'follow-up': 1, 'level-and-prerequisite': 1, closed: 1, 'level-unknown': 1, event: 1 });
    expect(m.counts.classes.done).toBe(2);
    expect(m.counts.availableGivers).toBe(1);
    expect(m.who).toBe('Orc Warrior');
  });
});

describe('questStateModel: an unknown history and a lower-bound level', () => {
  it('an unverifiable prerequisite inside the window is "may be available", with the history in words', () => {
    const m = model({}, { ...CHARACTER, priorHistory: 'unknown' });
    expect(entryOf(m, 5)).toMatchObject({ cls: 'uncertain-history', mark: 'uncertain', row: 'may-be-available', needs: [questId(99)] });
    expect(entryOf(m, 5).reason).toBe('May be available: needs “Cutting Teeth”, and the history before the route is unknown');
    expect(entryOf(m, 6)).toMatchObject({ cls: 'outside', outside: 'prerequisite-outside' });
  });

  it('a lower-bound level never locks a quest for level: it may be available, with the bound', () => {
    const m = model({ state: baseState({ unknownXpEvents: 2 }) });
    expect(m.levelLowerBound).toBe(true);
    expect(entryOf(m, 3)).toMatchObject({ cls: 'uncertain-level', mark: 'uncertain', row: 'may-be-available' });
    expect(entryOf(m, 3).reason).toBe('May be available: the level is a lower bound (at least 10; it needs 13)');
    // Beyond the level window it stays outside, and says the level is a lower bound.
    expect(entryOf(m, 4)).toMatchObject({ cls: 'outside', outside: 'level-ahead', reason: 'Unlocks at level 14 (the level is a lower bound, at least 10)' });
  });
});

describe('questStateModel: turn-ins (§7.5)', () => {
  const records: StepRecord[] = [
    { step: { id: stepId('s-a'), kind: 'note' }, delta: { objectivesDone: [], abandoned: null, turnedIn: null } },
    { step: { id: stepId('s-b'), kind: 'complete' }, delta: { objectivesDone: [{ questId: questId(97), objective: 1 }], abandoned: null, turnedIn: null } },
    { step: { id: stepId('s-c'), kind: 'turnin' }, delta: { objectivesDone: [{ questId: questId(96), objective: 0 }], abandoned: null, turnedIn: questId(96) } },
  ] as unknown as StepRecord[];
  const m = model({ records });

  it('ready when every objective is done; in progress with the share done; never ready while the progress is unknown', () => {
    expect(entryOf(m, 95).turnIn).toMatchObject({ kind: 'ready', done: 1, total: 1 });
    expect(entryOf(m, 95)).toMatchObject({ cls: 'in-log', mark: 'ready', row: 'turn-ins', reason: 'In the quest log: ready to turn in' });
    expect(entryOf(m, 97)).toMatchObject({ mark: 'in-progress', reason: 'In the quest log: 1 of 2 objectives done' });
    expect(entryOf(m, 96)).toMatchObject({ mark: 'record-unknown' });
    expect(entryOf(m, 96).reason).toMatch(/progress before the route is unknown \(never shown as ready\)/);
    // A quest with no objectives, accepted in the route: nothing is open, so it is ready.
    expect(entryOf(m, 98).turnIn?.kind).toBe('ready');
    expect(m.counts.ready).toBe(2);
  });

  it('a log quest the dataset does not know is never ready', () => {
    const state = baseState();
    state.questLog.set(questId(500), { objectives: [], failed: false, routeAccepted: true });
    const unknown = model({ state });
    expect(entryOf(unknown, 500)).toMatchObject({ cls: 'in-log', mark: 'record-unknown', name: 'Quest 500' });
    expect(entryOf(unknown, 500).reason).toMatch(/the dataset has no record of it/);
    expect(turnInOf({ objectives: [], failed: false, routeAccepted: true }, undefined).kind).toBe('record-unknown');
    expect(unknown.map.turnInNotes.unknownQuests).toBe(1);
  });

  it('finds the step that completes the open objectives, and marks a turn-in that carries them', () => {
    expect(entryOf(m, 97).turnIn?.completedBy).toEqual({ stepId: stepId('s-b'), turnIn: false });
    expect(entryOf(m, 96).turnIn?.completedBy).toEqual({ stepId: stepId('s-c'), turnIn: true });
    expect(entryOf(m, 95).turnIn?.completedBy).toBeNull();
  });

  it('the turn-ins layer draws every log quest’s finisher with its best state, without a step number', () => {
    const [group] = m.map.turnIns.groups;
    expect(group?.subject).toEqual({ kind: 'npc', id: FINISHER });
    expect(group?.mark).toMatchObject({ state: 'ready', progress: null });
    expect(group?.label).toMatch(/^Zureetha: 4 quests: turn in Ready one: in the quest log: ready to turn in/);
    expect(group?.label).not.toMatch(/step \d/);
  });

  it('the log objectives: counted marks per target and zone, and an outline of 5 points or more labelled with the completing step', () => {
    const log = m.map.log;
    // Quest 96 (progress unknown: every objective) and 97 (its open objective) kill Boars: one mark each in Durotar.
    expect(log.counted.map((mark) => mark.id)).toEqual(['count:96:npc:11:1:1411', 'count:97:npc:11:1:1411']);
    expect(log.counted[1]?.label).toBe('Boar · kill for Half done · 6 spawns in Durotar');
    expect(log.counted[1]?.point).toEqual({ mapId: MAP_TEST_KALIMDOR, x: 220, y: -4320 });
    const area = log.areas.find((entry) => entry.questId === questId(97));
    expect(area).toMatchObject({ labelStep: stepId('s-b'), labelTurnIn: false, label: 'Objectives of Half done', uiMapId: MAP_TEST_DUROTAR });
    expect(area?.ring).toHaveLength(4);
    expect(log.areas.find((entry) => entry.questId === questId(96))).toMatchObject({ labelTurnIn: true });
    // Ready quests have nothing left to do: no marks, no outlines.
    expect(log.counted.some((mark) => mark.questId === questId(95))).toBe(false);
    expect(m.counts.objectives).toBe(2);
  });
});

describe('questStateModel: the Available tab’s groups and the map’s givers', () => {
  const m = model();

  it('groups the listed quests by their giver’s zone, then Unlocks soon and Low level, in list order', () => {
    expect(m.groups.map((group) => [group.kind, group.title])).toEqual([
      ['zone', 'Durotar'],
      ['unlocks-soon', 'Unlocks soon'],
      ['low-level', 'Low level'],
    ]);
    const [durotar] = m.groups;
    // Available first (by level, then name), then may be available, then needs a prerequisite.
    expect(durotar?.questIds).toEqual([questId(99), questId(13), questId(11), questId(1), questId(10), questId(5)]);
    expect(durotar?.distance).toBe(0);
  });

  it('the givers layer holds the quests drawn by default, one group per NPC with the best state and words', () => {
    const [group] = m.map.givers.groups;
    expect(group?.questIds).toEqual([questId(1), questId(5), questId(10), questId(11), questId(13), questId(99)]);
    expect(group?.mark).toMatchObject({ state: 'available', difficulty: 'difficult', dungeonQuest: true });
    expect(group?.label).toMatch(/^Gornek: 6 quests: Open door: available \(difficult, level 10\); /);
    expect(group?.label).toContain('Needs teeth: needs “Cutting Teeth”');
  });

  it('gives the focused quests outside the drawn rows their givers, the same object for the same ids', () => {
    const a = m.giversOf([questId(3), questId(4), questId(1), questId(94)]);
    expect(a.groups[0]?.questIds).toEqual([questId(3), questId(4)]);
    expect(a.groups[0]?.mark?.state).toBe('unlocks-soon');
    expect(m.giversOf([questId(4), questId(3)])).toBe(a);
    expect(m.giversOf([]).groups).toEqual([]);
  });

  it('keeps an unchanged entry’s object from the previous model', () => {
    const next = model({ previous: m, stepId: stepId('s-b') });
    expect(next.quests.get(questId(1))).toBe(m.quests.get(questId(1)));
    expect(sameEntry(entryOf(next, 5), entryOf(m, 5))).toBe(true);
  });

  it('says when the log is full, without blanking the classes', () => {
    const full = model({ rules: effectiveRules(FOREVER_BETA, { questLogCapacity: 4 }), checks: createAcceptChecks({ dataset: DATASET, rules: effectiveRules(FOREVER_BETA, { questLogCapacity: 4 }) }) });
    expect(full.log).toEqual({ size: 4, capacity: 4, full: true });
    expect(entryOf(full, 1).cls).toBe('available');
  });
});

describe('the map’s level ceiling (D-050 item 3; review PR-18)', () => {
  const OTHER = npcId(20);
  const other = [{ kind: 'npc' as const, id: OTHER }];
  // At level 10: a quest at the ceiling, one just above it, and a level-60 repeatable open from level 1.
  const ceilingQuests: readonly QuestRecord[] = [
    q(1, { name: 'Open door' }),
    q(40, { name: 'At the ceiling', level: 10 + DRAW_LEVEL_CEILING, minLevel: 1, starters: other }),
    q(41, { name: 'Just above', level: 10 + DRAW_LEVEL_CEILING + 1, minLevel: 1, starters: other }),
    q(42, { name: 'Copper bars', level: 60, minLevel: 1, starters: other }),
  ];
  const dataset = stubDataset({
    quests: ceilingQuests,
    npcs: [stubNpc({ id: GIVER, name: 'Gornek' }), stubNpc({ id: OTHER, name: 'Miner Cromwell' })],
    spawns: { 'npc:10': [worldSpawn(MAP_TEST_KALIMDOR, 0, -4000, MAP_TEST_DUROTAR)], 'npc:20': [worldSpawn(MAP_TEST_KALIMDOR, 30, -4000, MAP_TEST_DUROTAR)] },
    zones: [{ uiMapId: MAP_TEST_DUROTAR, name: 'Durotar', worldMapId: MAP_TEST_KALIMDOR }],
  });
  const m = model({
    dataset,
    state: stateWith({ level: 10 }),
    checks: createAcceptChecks({ dataset, rules: RULES }),
    open: questsForCharacter(dataset, CHARACTER).open,
    spans: zoneSpans(dataset, GEOMETRY, CHARACTER),
  });
  const drawnIds = (input: { readonly groups: readonly { readonly questIds: readonly unknown[] }[] }) => input.groups.flatMap((group) => group.questIds);

  it('keeps quests more than 5 levels above the character off the givers’ layer, and still lists them', () => {
    expect(entryOf(m, 41).cls).toBe('available');
    expect(entryOf(m, 42)).toMatchObject({ cls: 'available', row: 'available', difficulty: 'impossible' });
    expect(drawnIds(m.map.givers)).toEqual([questId(1), questId(40)]);
    expect(m.counts.aboveCeiling).toBe(2);
    expect(m.counts.rows.available).toBe(4);
    expect(m.groups.flatMap((group) => group.questIds)).toEqual(expect.arrayContaining([questId(41), questId(42)]));
  });

  it('counts them in the notes as an assumption', () => {
    expect(m.map.notes.givers.join(' ')).toContain(`Not drawn by the level ceiling (an assumption): 2 quests are more than ${String(DRAW_LEVEL_CEILING)} levels above the character's level; the Available tab lists them.`);
    expect(model().map.notes.givers.join(' ')).not.toContain('level ceiling');
  });

  it('draws one all the same when it is in focus, and applies to the drawer’s other rows too', () => {
    expect(drawnIds(m.giversOf([questId(42)]))).toEqual([questId(42)]);
    expect(drawnIds(m.giversFor(DRAWN_ROWS, [questId(42)]))).toEqual([questId(1), questId(40), questId(42)]);
    expect(drawnIds(m.giversFor(new Set(['available'] as const), []))).toEqual([questId(1), questId(40)]);
  });

  it('holds back nothing at a level of 55 or more', () => {
    const high = model({ dataset, state: stateWith({ level: 55 }), checks: createAcceptChecks({ dataset, rules: RULES }), open: questsForCharacter(dataset, CHARACTER).open, spans: zoneSpans(dataset, GEOMETRY, CHARACTER) });
    expect(high.counts.aboveCeiling).toBe(0);
    expect(drawnIds(high.map.givers)).toContain(questId(42));
  });
});

describe('the words without route state (§7.1)', () => {
  it('names the character with its article, and never a step', () => {
    expect(noStateText('Orc Warrior')).toBe('Quests open to an Orc Warrior (no route state yet)');
    expect(noStateText('Human Warrior')).toBe('Quests open to a Human Warrior (no route state yet)');
    expect(withArticle('Undead Mage')).toBe('an Undead Mage');
    expect(noStateText('Orc Warrior')).not.toMatch(/step/);
  });
});

