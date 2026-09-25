import { describe, expect, it } from 'vitest';
import { groupId, npcId, questId, sequentialIdSource, skillId, spellId, uiMapId } from './ids';
import { zoneSourcedPoint } from './points';
import { STEP_KINDS, type RouteStep } from './route';
import {
  makeAbandonStep,
  makeAcceptStep,
  makeCompleteStep,
  makeFlightStep,
  makeGrindStep,
  makeHearthStep,
  makeNoteStep,
  makeTrainStep,
  makeTravelStep,
  makeTurnInStep,
  makeVendorStep,
} from './step-factory';

const COMMON_DEFAULTS = {
  location: null,
  note: null,
  locked: false,
  groupId: null,
  condition: null,
  durationOverride: null,
  origin: { source: 'manual', ref: null },
  rxp: null,
  ext: null,
};

const PLACEHOLDER_QUEST = questId(-1);

describe('step factories', () => {
  it('take ids from the IdSource, one per step', () => {
    const ids = sequentialIdSource(1);
    const a = makeNoteStep(ids, { text: 'Placeholder' });
    const b = makeTravelStep(ids);
    expect(a.id).toBe('step-1');
    expect(b.id).toBe('step-2');
  });

  it('fill defaults for every kind', () => {
    const ids = sequentialIdSource(1);
    const steps: RouteStep[] = [
      makeAcceptStep(ids, { questId: PLACEHOLDER_QUEST }),
      makeCompleteStep(ids, { targets: [{ questId: PLACEHOLDER_QUEST, objective: null }] }),
      makeTurnInStep(ids, { questId: PLACEHOLDER_QUEST }),
      makeAbandonStep(ids, { questId: PLACEHOLDER_QUEST }),
      makeTravelStep(ids),
      makeGrindStep(ids, { until: { kind: 'level', level: 2, offset: null } }),
      makeHearthStep(ids),
      makeFlightStep(ids),
      makeTrainStep(ids),
      makeVendorStep(ids),
      makeNoteStep(ids, { text: 'Placeholder' }),
    ];
    expect(steps.map((s) => s.kind)).toEqual(STEP_KINDS);
    for (const step of steps) expect(step).toMatchObject(COMMON_DEFAULTS);
    expect(steps).toEqual([
      { ...COMMON_DEFAULTS, id: 'step-1', kind: 'accept', questId: -1, anyOf: null, via: null },
      {
        ...COMMON_DEFAULTS,
        id: 'step-2',
        kind: 'complete',
        targets: [{ questId: -1, objective: null }],
        progress: 'finish',
      },
      {
        ...COMMON_DEFAULTS,
        id: 'step-3',
        kind: 'turnin',
        questId: -1,
        anyOf: null,
        rewardIndex: null,
        skipIfMissing: false,
        via: null,
      },
      { ...COMMON_DEFAULTS, id: 'step-4', kind: 'abandon', questId: -1 },
      { ...COMMON_DEFAULTS, id: 'step-5', kind: 'travel', mode: 'auto', transport: null },
      {
        ...COMMON_DEFAULTS,
        id: 'step-6',
        kind: 'grind',
        until: { kind: 'level', level: 2, offset: null },
        mobLevel: null,
        xpPerHour: null,
      },
      { ...COMMON_DEFAULTS, id: 'step-7', kind: 'hearth', mode: 'use' },
      { ...COMMON_DEFAULTS, id: 'step-8', kind: 'flight', mode: 'take', from: null, to: null, nodeQuery: null },
      {
        ...COMMON_DEFAULTS,
        id: 'step-9',
        kind: 'train',
        spellId: null,
        skill: null,
        skillId: null,
        rank: null,
        what: null,
        cost: null,
      },
      { ...COMMON_DEFAULTS, id: 'step-10', kind: 'vendor', what: null },
      { ...COMMON_DEFAULTS, id: 'step-11', kind: 'note', text: 'Placeholder', preserved: null },
    ]);
  });

  it('keep the fields they are given', () => {
    const ids = sequentialIdSource(1);
    const location = { source: zoneSourcedPoint(uiMapId(1411), 50, 50), label: 'Placeholder location', radius: 5 };
    const travel = makeTravelStep(ids, {
      location,
      mode: 'walk',
      note: 'Placeholder note',
      locked: true,
      groupId: groupId('group-1'),
      durationOverride: 60,
      origin: { source: 'optimizer', ref: 'run-1' },
      ext: { placeholder: true },
    });
    expect(travel).toMatchObject({
      location,
      mode: 'walk',
      note: 'Placeholder note',
      locked: true,
      groupId: 'group-1',
      durationOverride: 60,
      origin: { source: 'optimizer', ref: 'run-1' },
      ext: { placeholder: true },
    });
    const turnin = makeTurnInStep(ids, {
      questId: PLACEHOLDER_QUEST,
      anyOf: [questId(-2)],
      rewardIndex: 2,
      skipIfMissing: true,
      via: { kind: 'npc', id: npcId(-10) },
    });
    expect(turnin).toMatchObject({ anyOf: [-2], rewardIndex: 2, skipIfMissing: true, via: { kind: 'npc', id: -10 } });
    const train = makeTrainStep(ids, { spellId: spellId(1), skill: 'profession', skillId: skillId(2), rank: 1, cost: 0 });
    expect(train).toMatchObject({ spellId: 1, skill: 'profession', skillId: 2, rank: 1, cost: 0 });
    expect(makeHearthStep(ids, { mode: 'bind' }).mode).toBe('bind');
    expect(makeFlightStep(ids, { mode: 'discover', nodeQuery: 'Placeholder node' })).toMatchObject({
      mode: 'discover',
      nodeQuery: 'Placeholder node',
    });
    expect(makeCompleteStep(ids, { targets: [], progress: 'partial' }).progress).toBe('partial');
    expect(makeGrindStep(ids, { until: { kind: 'duration', seconds: 600 }, mobLevel: 5, xpPerHour: null })).toMatchObject({
      until: { kind: 'duration', seconds: 600 },
      mobLevel: 5,
    });
    expect(makeVendorStep(ids, { what: 'Placeholder goods' }).what).toBe('Placeholder goods');
  });

  it('give each step its own origin object', () => {
    const ids = sequentialIdSource();
    const a = makeNoteStep(ids, { text: 'a' });
    const b = makeNoteStep(ids, { text: 'b' });
    expect(a.origin).toEqual(b.origin);
    expect(a.origin).not.toBe(b.origin);
  });
});
