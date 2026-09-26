import { describe, expect, it } from 'vitest';
import { CLASS_TOKENS, createEmptyProject, type ProjectV1, questId, RACE_FACTION, RACE_TOKENS, sequentialIdSource, uiMapId, zoneSourcedPoint } from '../domain';
import { makeAcceptStep, makeCompleteStep, makeNoteStep } from '../domain/step-factory';
import { isRegisteredCode } from '../validate/codes';
import { fixedClock } from './clock';
import type { CommandContext } from './commands';
import { stubDataset, stubQuest } from './map-test-helpers';
import {
  buildCustomQuest,
  classesOf,
  CUSTOM_SHADOWED_CODE,
  type CustomQuestFields,
  customQuestProblems,
  deleteCustomQuest,
  FOREVER_RACE_CLASSES,
  isPlayablePair,
  maxLevelOf,
  nextInventedQuestId,
  questStepCount,
  racesOf,
  saveCustomQuest,
  setCustomQuestLocation,
  shadowedQuest,
  updateSettings,
} from './project-commands';
import { createEditorStore } from './store';

const T0 = '2026-09-26T00:00:00.000Z';
const CTX: CommandContext = { ids: sequentialIdSource(), nowIso: T0 };
const project = (): ProjectV1 => createEmptyProject({ ids: sequentialIdSource(), nowIso: T0, name: 'Settings' });

const FIELDS: CustomQuestFields = {
  id: questId(-1),
  name: 'A new Forever quest',
  level: 5,
  minLevel: 3,
  baseXp: 450,
  foreverStatus: 'user-declared-new',
  starterLocation: null,
  finisherLocation: null,
};

describe('race and class tables', () => {
  it('holds the 56 Forever client pairs, each race on its faction', () => {
    const pairs = RACE_TOKENS.reduce((n, race) => n + FOREVER_RACE_CLASSES[race].length, 0);
    expect(pairs).toBe(56);
    for (const race of RACE_TOKENS) for (const cls of FOREVER_RACE_CLASSES[race]) expect(CLASS_TOKENS).toContain(cls);
    expect(racesOf('Horde')).toEqual(['Orc', 'Scourge', 'Tauren', 'Troll', 'WindshaperSkyborne']);
    expect(racesOf('Alliance').every((race) => RACE_FACTION[race] === 'Alliance')).toBe(true);
    expect(isPlayablePair('Orc', 'MAGE')).toBe(true);
    expect(isPlayablePair('Tauren', 'MAGE')).toBe(false);
    expect(classesOf('Tauren')).toEqual(['WARRIOR', 'HUNTER', 'SHAMAN', 'DRUID']);
  });

  it('checks the start level against the assumed level cap, else 60', () => {
    expect(maxLevelOf(project())).toBe(60);
    expect(maxLevelOf({ assumptions: { maxLevel: 25 } })).toBe(25);
  });
});

describe('updateSettings', () => {
  it('changes the character and route profile in one command, and nothing when they are restated', () => {
    const p = project();
    const out = updateSettings({ character: { race: 'Troll', class: 'SHAMAN', startLevel: 10, priorHistory: 'unknown' }, routeProfile: { hardcore: true, dungeons: ['RFC'] } }).apply(p, CTX);
    expect(out.character).toMatchObject({ race: 'Troll', class: 'SHAMAN', startLevel: 10, priorHistory: 'unknown', faction: 'Horde' });
    expect(out.routeProfile).toMatchObject({ hardcore: true, dungeons: ['RFC'] });
    expect(updateSettings({ character: { race: p.character.race }, routeProfile: { dungeons: [] } }).apply(p, CTX)).toBe(p);
    expect(updateSettings({}).apply(p, CTX)).toBe(p);
    const routeOnly = updateSettings({ routeProfile: { xpRate: 2 } }).apply(p, CTX);
    expect(routeOnly.character).toBe(p.character);
  });

  it('is one undo entry', () => {
    const store = createEditorStore({ project: project(), ids: sequentialIdSource(), clock: fixedClock(T0) });
    store.dispatch(updateSettings({ character: { startLevel: 12, startXp: 300 }, routeProfile: { ssf: true } }));
    expect(store.getState().history.undoLabel).toBe('Edit settings');
    store.undo();
    expect(store.getState().project.character.startLevel).toBe(1);
    expect(store.getState().project.routeProfile.ssf).toBe(false);
  });
});

describe('custom quests', () => {
  it('numbers invented quests below the lowest id in use', () => {
    expect(nextInventedQuestId({ customQuests: [] })).toBe(-1);
    const quests = [buildCustomQuest({ ...FIELDS, id: questId(-4) }, null), buildCustomQuest({ ...FIELDS, id: questId(700) }, null)];
    expect(nextInventedQuestId({ customQuests: quests })).toBe(-5);
  });

  it('builds an invented quest that claims nothing it was not told, with user XP at its level', () => {
    const quest = buildCustomQuest(FIELDS, null);
    expect(quest).toMatchObject({
      id: -1,
      name: 'A new Forever quest',
      level: 5,
      minLevel: 3,
      races: null,
      classes: null,
      starters: [],
      objectives: [],
      objectivesText: null,
      xp: { questLevel: 5, baseXp: 450, basis: 'user' },
      provenance: { upstreamDiff: 'era', foreverStatus: 'user-declared-new', source: 'custom' },
    });
    expect(buildCustomQuest({ ...FIELDS, baseXp: null }, null).xp).toBeNull();
  });

  it('keeps a replaced dataset quest’s record and replaces only the edited fields', () => {
    const dataset = stubQuest({ id: questId(4641), name: 'Your Place in the World', level: 1, starters: [{ kind: 'npc', id: 3143 as never }], xp: { questLevel: 1, baseXp: 40, basis: 'era-seed' } });
    const quest = buildCustomQuest({ ...FIELDS, id: dataset.id, name: 'Renamed', baseXp: null, foreverStatus: 'user-declared-changed' }, dataset);
    expect(quest.starters).toBe(dataset.starters);
    expect(quest).toMatchObject({ id: 4641, name: 'Renamed', level: 5, xp: null, provenance: { upstreamDiff: 'era', foreverStatus: 'user-declared-changed', source: 'custom' } });
  });

  it('says what stops a save, with the field each problem is about', () => {
    const p = { customQuests: [buildCustomQuest(FIELDS, null)] };
    expect(customQuestProblems({ ...FIELDS, id: questId(-2) }, p, null)).toEqual([]);
    expect(customQuestProblems(FIELDS, p, null)).toEqual([{ field: 'id', message: 'The project already has a custom quest with id -1.' }]);
    expect(customQuestProblems(FIELDS, p, questId(-1))).toEqual([]);
    // The id of an edited custom quest does not change (CR-10).
    expect(customQuestProblems({ ...FIELDS, id: questId(-3) }, p, questId(-1)).map((problem) => problem.field)).toEqual(['id']);
    expect(customQuestProblems({ ...FIELDS, id: questId(0), name: ' ', level: 0, minLevel: 1.5, baseXp: -1 }, p, null).map((problem) => problem.field)).toEqual([
      'id',
      'name',
      'level',
      'minLevel',
      'xp',
    ]);
    expect(customQuestProblems({ ...FIELDS, id: questId(-9), level: null }, p, null)).toEqual([
      { field: 'xp', message: 'Enter the quest level to enter XP: quest XP is taken at the quest level.' },
    ]);
  });

  it('adds, edits, relocates and deletes, each one command that restating changes nothing', () => {
    const p = project();
    const quest = buildCustomQuest(FIELDS, null);
    const added = saveCustomQuest(quest).apply(p, CTX);
    expect(added.customQuests).toEqual([quest]);
    expect(saveCustomQuest(quest, quest.id).apply(added, CTX)).toBe(added);
    // The id is the quest's identity: changing it, adding a second quest with it, or editing a quest the project lacks changes nothing (CR-10).
    expect(saveCustomQuest({ ...quest, id: questId(-7), name: 'Other' }, quest.id).apply(added, CTX)).toBe(added);
    expect(saveCustomQuest({ ...quest, name: 'Duplicate' }).apply(added, CTX)).toBe(added);
    expect(saveCustomQuest({ ...quest, id: questId(-7) }, questId(-7)).apply(added, CTX)).toBe(added);
    const second = saveCustomQuest({ ...quest, id: questId(-7), name: 'Other' }).apply(added, CTX);
    const renamed = deleteCustomQuest(quest.id).apply(second, CTX);
    expect(renamed.customQuests.map((q) => [q.id, q.name])).toEqual([[-7, 'Other']]);
    const other = renamed.customQuests[0];
    if (other === undefined) throw new Error('quest missing');
    expect(saveCustomQuest({ ...other, name: 'Renamed' }, questId(-7)).apply(renamed, CTX).customQuests.map((q) => q.name)).toEqual(['Renamed']);
    const location = { source: zoneSourcedPoint(uiMapId(1411), 40, 60), label: null, radius: null };
    const placed = setCustomQuestLocation(questId(-7), 'finisher', location).apply(renamed, CTX);
    expect(placed.customQuests[0]?.finisherLocation).toBe(location);
    expect(setCustomQuestLocation(questId(-7), 'finisher', location).apply(placed, CTX)).toBe(placed);
    expect(setCustomQuestLocation(questId(-99), 'starter', location).apply(placed, CTX)).toBe(placed);
    expect(deleteCustomQuest(questId(-7)).apply(placed, CTX).customQuests).toEqual([]);
    expect(deleteCustomQuest(questId(-7)).apply(p, CTX)).toBe(p);
    expect(saveCustomQuest(quest).label).toBe('Add custom quest');
    expect(saveCustomQuest(quest, quest.id).label).toBe('Edit custom quest');
  });

  it('counts the steps that use a quest, for the delete warning (CR-10)', () => {
    const ids = sequentialIdSource(50);
    const base = project();
    const steps = [
      makeAcceptStep(ids, { questId: questId(-1) }),
      makeCompleteStep(ids, { targets: [{ questId: questId(-1), objective: 0 }, { questId: questId(-1), objective: 1 }] }),
      makeNoteStep(ids, { text: 'Quest -1' }),
      makeAcceptStep(ids, { questId: questId(-2) }),
    ];
    const withSteps = { ...base, route: { ...base.route, steps } };
    expect(questStepCount(withSteps, questId(-1))).toBe(2);
    expect(questStepCount(withSteps, questId(-2))).toBe(1);
    expect(questStepCount(withSteps, questId(-3))).toBe(0);
  });

  it('finds the dataset quest a custom quest with a real id replaces (DATA001-custom-shadowed)', () => {
    const base = stubDataset({ quests: [stubQuest({ id: questId(10), name: 'Dataset quest' })] });
    expect(CUSTOM_SHADOWED_CODE).toBe('DATA001-custom-shadowed');
    // The validator's registry knows it (the constant stays here so the registry stays out of the entry chunk).
    expect(isRegisteredCode(CUSTOM_SHADOWED_CODE)).toBe(true);
    expect(shadowedQuest(base, questId(10))?.name).toBe('Dataset quest');
    expect(shadowedQuest(base, questId(11))).toBeNull();
    expect(shadowedQuest(base, questId(-10))).toBeNull();
  });
});
