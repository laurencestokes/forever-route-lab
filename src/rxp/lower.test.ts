import { describe, expect, it } from 'vitest';
import fixture01 from '../../tests/fixtures/rxp/01-basic-durotar.txt?raw';
import fixture02 from '../../tests/fixtures/rxp/02-filters-and-step-tags.txt?raw';
import fixture04 from '../../tests/fixtures/rxp/04-edge-cases-crlf.txt?raw';
import fixture05 from '../../tests/fixtures/rxp/05-travel-and-conditions.txt?raw';
import fixture06 from '../../tests/fixtures/rxp/06-lowering-and-export.txt?raw';
import { sequentialIdSource, uiMapId } from '../domain/ids';
import type { RxpImport } from '../domain/project';
import type { RouteStep } from '../domain/route';
import { worldToMap } from '../geo/transforms';
import { finishDiagnostic, rxpCodeSpec, type RxpDiagnostic } from './diagnostics';
import { lowerImport } from './import';
import type { LoweredGroup, RxpLowerContext } from './lower';
import { sha256Hex } from './sha256';
import { FULL_CONTEXT, testGeometry } from './test-fixtures';

function imported(text: string, frame: 'forever' | 'era' = 'forever'): RxpImport {
  return { id: 'imp', name: 'fixture', sourceHash: sha256Hex(text), text, options: { changedZoneFrame: frame, lua: null } };
}

interface Lowered {
  readonly groups: readonly LoweredGroup[];
  readonly diagnostics: readonly RxpDiagnostic[];
  /** Diagnostics of RXP step `k` (by the line range of its group). */
  readonly codesOf: (k: number) => string[];
}

function lower(text: string, frame: 'forever' | 'era' = 'forever', ctx: RxpLowerContext = FULL_CONTEXT): Lowered {
  const imp = imported(text, frame);
  const result = lowerImport(imp, sequentialIdSource(), ctx);
  const diagnostics = result.diagnostics.map((raw) => finishDiagnostic(raw, imp.id));
  const groups = result.lowered;
  const codesOf = (k: number): string[] => {
    const group = groups[k];
    if (group === undefined) return [];
    return diagnostics.filter((d) => d.line > group.startLine && d.line <= group.endLine).map((d) => d.code);
  };
  return { groups, diagnostics, codesOf };
}

/** The payload of a step: its kind and kind-specific fields. */
function payload(step: RouteStep | undefined): Record<string, unknown> {
  if (step === undefined) return {};
  const { id: _id, location: _l, note: _n, locked: _k, groupId: _g, condition: _c, durationOverride: _d, origin: _o, rxp: _r, ext: _e, ...rest } = step;
  return rest;
}

const zone = (x: number, y: number, lexemes: readonly [string, string], ui = 1411, frame: 'forever' | 'era' = 'forever') => ({
  space: 'zone',
  uiMapId: ui,
  x,
  y,
  frame,
  lexemes,
});

describe('lowering fixture 06 (docs/RXP.md §19.3)', () => {
  const six = lower(fixture06);
  const group = (k: number): LoweredGroup => {
    const found = six.groups[k];
    if (found === undefined) throw new Error(`no group ${String(k)}`);
    return found;
  };

  it('makes one group per RXP step, in source order, with rxp origin and group ids on every step', () => {
    expect(six.groups.map((g) => g.stepIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const g of six.groups) {
      expect(g.group.rxp?.importId).toBe('imp');
      expect(g.group.rxp?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      for (const step of g.steps) {
        expect(step.groupId).toBe(g.group.id);
        expect(step.origin).toEqual({ source: 'rxp', ref: 'imp' });
      }
    }
  });

  it('L01: a world-form location that resolves to Gornek in Durotar, a skip-if-missing turn-in and an accept', () => {
    const l01 = group(0);
    expect(l01.location).toEqual({
      source: { space: 'world', mapId: 1, x: -600.3, y: -4186.42, uiMapId: 1411, lexemes: ['-4186.42', '-600.30'] },
      label: null,
      radius: null,
    });
    const source = l01.location?.source;
    if (source?.space !== 'world') throw new Error('expected a world point');
    const percent = worldToMap(source, uiMapId(1411), testGeometry);
    expect(percent?.x).toBeCloseTo(42.06, 4);
    expect(percent?.y).toBeCloseTo(68.33, 4);
    expect(l01.steps.map(payload)).toEqual([
      { kind: 'turnin', questId: 788, anyOf: null, rewardIndex: null, skipIfMissing: true, via: null },
      { kind: 'accept', questId: 789, anyOf: null, via: null },
    ]);
    expect(l01.steps[0]?.rxp).toEqual({ text: 'Hand in Cutting Teeth if it is in your log', line: { importId: 'imp', firstLine: 18, lastLine: 18 } });
    expect(l01.steps.every((step) => step.location === l01.location)).toBe(true);
    expect(six.codesOf(0)).toEqual([]);
  });

  it('L02: frame-ambiguous percent points take the import option’s frame (RXP030 × 3)', () => {
    const l02 = group(1);
    expect(l02.group.rxp?.waypoints.map((w) => [w.role, w.point, w.radius])).toEqual([
      ['pin', zone(43.89, 76.66, ['43.89', '76.66'], 1412), 0],
      ['pin', zone(44, 77, ['44.00', '77.00'], 1412), 0],
    ]);
    expect(l02.location?.source).toEqual(zone(60, 70, ['60.00', '70.00'], 1453));
    expect(l02.steps.map(payload)).toEqual([{ kind: 'note', text: 'Three frame-ambiguous points', preserved: null }]);
    expect(six.codesOf(1)).toEqual(['RXP030-frame-ambiguous', 'RXP030-frame-ambiguous', 'RXP030-frame-ambiguous']);
    const era = lower(fixture06, 'era').groups[1];
    expect(era?.group.rxp?.waypoints.map((w) => w.point.space === 'zone' && w.point.frame)).toEqual(['era', 'era']);
    expect(era?.location?.source).toEqual(zone(60, 70, ['60.00', '70.00'], 1453, 'era'));
  });

  it('L03: an unconvertible pseudo-zone gives no location (RXP036)', () => {
    const l03 = group(2);
    expect(l03.location).toBeNull();
    expect(l03.steps.map(payload)).toEqual([{ kind: 'note', text: 'An unconvertible pseudo-zone point', preserved: null }]);
    expect(six.codesOf(2)).toEqual(['RXP036-pseudo-zone-unconverted']);
  });

  it('L04: waypoint kinds, a radius location with its travel step, merged .complete lines and an annotation', () => {
    const l04 = group(3);
    expect(l04.group.rxp?.waypoints.map((w) => [w.role, w.point, w.radius, w.filter])).toEqual([
      ['leg', zone(45, 70, ['45.00', '70.00']), 35, null],
      ['leg', zone(46, 68, ['46.00', '68.00']), 35, null],
      ['pin', zone(45.5, 69, ['45.50', '69.00']), 0, null],
      ['leg', zone(44.2, 69.2, ['44.20', '69.20']), null, { kind: 'word', word: 'Orc' }],
    ]);
    expect(l04.location).toEqual({ source: zone(44, 69, ['44.00', '69.00']), label: null, radius: 20 });
    expect(l04.steps.map(payload)).toEqual([
      { kind: 'travel', mode: 'auto', transport: null },
      {
        kind: 'complete',
        targets: [
          { questId: 788, objective: 0 },
          { questId: 789, objective: 0 },
          { questId: 788, objective: 1 },
        ],
        progress: 'finish',
      },
    ]);
    expect(l04.steps[1]?.rxp?.line).toEqual({ importId: 'imp', firstLine: 38, lastLine: 40 });
    expect(l04.group.rxp?.annotations.map((a) => [a.command, a.args])).toEqual([['mob', ['Mottled Boar']]]);
    expect(six.codesOf(3)).toEqual(['RXP034-not-simulated', 'RXP031-objective-out-of-range']);
  });

  it('L05: every quest target in a #completewith step is partial; an unknown quest is unchecked (RXP032)', () => {
    const l05 = group(4);
    expect(l05.group.rxp?.tags.map((t) => [t.name, t.value, t.assignment])).toEqual([['completewith', 'next', false]]);
    expect(l05.steps.map(payload)).toEqual([
      { kind: 'complete', targets: [{ questId: 792, objective: 0 }], progress: 'partial' },
      { kind: 'complete', targets: [{ questId: 789, objective: 0 }], progress: 'partial' },
      { kind: 'complete', targets: [{ questId: 900001, objective: 0 }], progress: 'partial' },
    ]);
    expect(six.codesOf(4)).toEqual(['RXP032-objective-unchecked']);
  });

  it('L06: an any-of accept and a turn-in with a reward choice', () => {
    const l06 = group(5);
    expect(l06.location?.source).toEqual(zone(42.06, 68.33, ['42.06', '68.33']));
    expect(l06.steps.map(payload)).toEqual([
      { kind: 'accept', questId: 790, anyOf: [790, 792], via: null },
      { kind: 'turnin', questId: 789, anyOf: null, rewardIndex: 2, skipIfMissing: false, via: null },
    ]);
    expect(six.codesOf(5)).toEqual([]);
  });

  it('L07: grind targets with exact offsets', () => {
    expect(group(6).steps.map((step) => (step.kind === 'grind' ? step.until : null))).toEqual([
      { kind: 'level', level: 6, offset: null },
      { kind: 'level', level: 6, offset: { kind: 'xpInto', xp: 150 } },
      { kind: 'level', level: 7, offset: { kind: 'xpShort', xp: 200 } },
      { kind: 'level', level: 7, offset: { kind: 'fraction', fraction: 0.5 } },
    ]);
  });

  it('L08: the group condition holds the step filter, variant entries and skip predicates', () => {
    const l08 = group(7);
    expect(l08.group.rxp?.condition).toEqual({
      filter: { kind: 'or', exprs: [{ kind: 'word', word: 'Orc' }, { kind: 'word', word: 'Troll' }] },
      variant: [
        { name: 'xprate', value: '<1.5', filter: null },
        { name: 'softcore', value: null, filter: null },
        { name: '.dungeon', value: 'RFC', filter: null },
      ],
      skipIf: [{ kind: 'questState', state: 'onQuest', questIds: [790], match: 'any', negate: true }],
    });
    expect(l08.location?.source).toEqual(zone(40.6, 62.58, ['40.60', '62.58']));
    expect(l08.steps.map(payload)).toEqual([{ kind: 'turnin', questId: 790, anyOf: null, rewardIndex: null, skipIfMissing: false, via: null }]);
  });

  it('L09: travel, bind, flight and hearth steps', () => {
    const [travel, bind, flight, hearth] = [group(8), group(9), group(10), group(11)];
    expect(travel.location).toEqual({ source: zone(52, 41, ['52.00', '41.00']), label: null, radius: 15 });
    expect(travel.steps.map(payload)).toEqual([
      { kind: 'travel', mode: 'auto', transport: null },
      { kind: 'note', text: 'Walk to the placeholder point', preserved: null },
    ]);
    expect(bind.location?.source).toEqual(zone(51.9, 41.6, ['51.90', '41.60']));
    expect(bind.steps.map(payload)).toEqual([{ kind: 'hearth', mode: 'bind' }]);
    expect(flight.location?.source).toEqual(zone(45.5, 12.5, ['45.50', '12.50']));
    expect(flight.steps.map(payload)).toEqual([
      { kind: 'flight', mode: 'discover', from: null, to: null, nodeQuery: 'Orgrimmar' },
      { kind: 'flight', mode: 'take', from: null, to: null, nodeQuery: 'Crossroads' },
    ]);
    expect(hearth.location).toBeNull();
    expect(hearth.steps.map(payload)).toEqual([{ kind: 'hearth', mode: 'use' }]);
  });

  it('L10: trainer, spell, a preserved death skip with its implicit softcore entry, and an any-of turn-in', () => {
    const l10 = group(12);
    expect(l10.group.rxp?.condition?.variant).toEqual([{ name: 'softcore', value: null, filter: null }]);
    expect(l10.steps.map(payload)).toEqual([
      { kind: 'train', spellId: null, skill: null, skillId: null, rank: null, what: null, cost: null },
      { kind: 'train', spellId: 6673, skill: null, skillId: null, rank: null, what: null, cost: null },
      { kind: 'note', text: '.deathskip >> Kept as a preserved note', preserved: { format: 'rxp', lines: ['    .deathskip >>Kept as a preserved note'] } },
      { kind: 'turnin', questId: 790, anyOf: [790, 792], rewardIndex: null, skipIfMissing: false, via: null },
    ]);
    expect(l10.steps[3]?.rxp?.text).toBe('Hand in whichever of the two you have');
    expect(six.codesOf(12)).toEqual(['RXP034-not-simulated']);
  });

  it('is deterministic and does not depend on the dataset or geometry lookups', () => {
    const again = lower(fixture06);
    expect(again.groups).toEqual(six.groups);
    const bare = lower(fixture06, 'forever', { zoneKey: FULL_CONTEXT.zoneKey });
    expect(bare.groups).toEqual(six.groups);
    expect(bare.diagnostics.map((d) => d.code)).not.toContain('RXP031-objective-out-of-range');
  });
});

describe('lowering other fixtures', () => {
  it('fixture 05: travel commands, hearth, flights, death skip and every skip predicate', () => {
    const five = lower(fixture05);
    const [zoneStep, run, home, fp, fly, hs, death, skips, collect, legs, vendor] = five.groups;
    expect(zoneStep?.steps.map(payload)).toEqual([{ kind: 'travel', mode: 'auto', transport: null }]);
    expect(zoneStep?.steps[0]?.location).toBeNull();
    expect(zoneStep?.group.rxp?.tags.map((t) => t.name)).toEqual(['completewith']);
    expect(run?.location).toEqual({
      source: { space: 'world', mapId: 1, x: -1300, y: -4800, uiMapId: 1411, lexemes: ['-4800.00', '-1300.00'] },
      label: null,
      radius: 15,
    });
    expect(run?.steps.map((s) => s.kind)).toEqual(['travel', 'note']);
    expect(home?.steps.map(payload)).toEqual([{ kind: 'hearth', mode: 'bind' }]);
    expect(home?.group.rxp?.condition?.skipIf).toEqual([{ kind: 'opaque', raw: '.bindlocation 362 >> Skipped if already bound to Razor Hill (area 362)' }]);
    expect(fp?.steps.map(payload)).toEqual([{ kind: 'flight', mode: 'discover', from: null, to: null, nodeQuery: 'Orgrimmar' }]);
    expect(fly?.steps.map(payload)).toEqual([{ kind: 'flight', mode: 'take', from: null, to: null, nodeQuery: 'Crossroads' }]);
    expect(hs?.steps.map(payload)).toEqual([{ kind: 'hearth', mode: 'use' }]);
    expect(hs?.group.rxp?.condition?.skipIf.map((p) => p.kind)).toEqual(['opaque', 'opaque']);
    expect(death?.group.rxp?.condition?.variant).toEqual([
      { name: 'softcore', value: null, filter: null },
      { name: 'softcore', value: null, filter: null },
    ]);
    expect(skips?.group.rxp?.condition?.skipIf).toEqual([
      { kind: 'questState', state: 'onQuest', questIds: [788], match: 'any', negate: true },
      { kind: 'questState', state: 'turnedIn', questIds: [4641], match: 'any', negate: true },
      { kind: 'questState', state: 'turnedIn', questIds: [789], match: 'any', negate: false },
      { kind: 'questState', state: 'complete', questIds: [792], match: 'any', negate: true },
      { kind: 'questState', state: 'onQuest', questIds: [790], match: 'any', negate: false },
      { kind: 'opaque', raw: '.itemcount 4862,10' },
      { kind: 'opaque', raw: '.money <0.10' },
      { kind: 'levelAtLeast', level: 13, xp: null, negate: false },
      { kind: 'levelAtLeast', level: 11, xp: null, negate: true },
      { kind: 'opaque', raw: '.train 6673,1' },
      { kind: 'opaque', raw: '.zoneskip Orgrimmar/Mulgore,1' },
    ]);
    expect(skips?.steps.map(payload)).toEqual([{ kind: 'note', text: 'Condition-only step (all elements are text-only)', preserved: null }]);
    expect(collect?.steps.map(payload)).toEqual([
      { kind: 'complete', targets: [{ questId: 789, objective: 0 }], progress: 'finish' },
      { kind: 'abandon', questId: 790 },
    ]);
    expect(collect?.group.rxp?.annotations.map((a) => a.command)).toEqual(['use']);
    expect(legs?.group.rxp?.waypoints.map((w) => [w.role, w.point.space, w.radius])).toEqual([
      ['leg', 'zone', 20],
      ['leg', 'world', 20],
    ]);
    expect(legs?.group.rxp?.annotations.map((a) => a.command)).toEqual(['line', 'loop']);
    expect(legs?.steps.map((s) => s.kind)).toEqual(['travel', 'note']);
    expect(vendor?.steps.map((s) => s.kind)).toEqual(['vendor', 'train', 'train']);
    expect(vendor?.steps.map((s) => s.condition?.filter ?? null)).toEqual([null, { kind: 'word', word: 'Warrior' }, { kind: 'word', word: 'Warrior' }]);
    expect(vendor?.group.rxp?.annotations.map((a) => [a.command, a.args])).toEqual([
      ['buy', ['159', '10']],
      ['timer', ['30', 'Boat arrives']],
      ['link', ['https://example.org/route-notes']],
    ]);
    expect(vendor?.group.rxp?.condition?.variant).toEqual([{ name: '.dungeon', value: 'RFC', filter: null }]);
    expect(five.diagnostics.map((d) => `${String(d.line)} ${d.code}`)).toEqual(['39 RXP034-not-simulated']);
  });

  it('fixture 02: step tags, empty steps as carriers, closest-point locations and line filters', () => {
    const two = lower(fixture02);
    const [notOrc, sticky, lowXp, highXp, requires, boars, loop, closest, lines, skip, filteredTags] = two.groups;
    expect(notOrc?.group.rxp?.condition?.filter).toEqual({ kind: 'and', exprs: [{ kind: 'not', expr: { kind: 'word', word: 'Orc' } }, { kind: 'not', expr: { kind: 'word', word: 'Troll' } }] });
    expect(sticky?.steps.map(payload)).toEqual([
      { kind: 'note', text: 'Keep an eye out for |cRXP_ENEMY_Scorpid Workers|r while questing', preserved: null },
      { kind: 'complete', targets: [{ questId: 789, objective: 0 }], progress: 'partial' },
    ]);
    expect(lowXp?.group.rxp?.condition?.variant).toEqual([
      { name: 'xprate', value: '<1.5', filter: null },
      { name: 'season', value: '0', filter: null },
      { name: 'softcore', value: null, filter: null },
    ]);
    expect(highXp?.group.rxp?.condition?.variant?.map((v) => v.name)).toEqual(['xprate', 'hardcore']);
    expect(requires?.group.rxp?.tags.map((t) => [t.name, t.value])).toEqual([
      ['requires', 'WarriorSticky'],
      ['completewith', 'WarriorSticky'],
    ]);
    expect(boars?.steps.map(payload)).toEqual([{ kind: 'note', text: '', preserved: { format: 'rxp', lines: [] } }]);
    expect(boars?.steps[0]?.rxp).toBeNull();
    expect(loop?.group.rxp?.waypoints.map((w) => [w.role, w.radius])).toEqual([
      ['pin', 0],
      ['leg', 35],
      ['leg', 35],
    ]);
    expect(loop?.location?.radius).toBe(35);
    expect(loop?.steps.map((s) => s.kind)).toEqual(['note']);
    expect(closest?.location?.source).toEqual(zone(44.5, 71, ['44.50', '71.00']));
    expect(closest?.location?.radius).toBeNull();
    expect(closest?.group.rxp?.waypoints.map((w) => [w.role, w.radius])).toEqual([['closest', -1]]);
    expect(lines?.steps.filter((s) => s.kind === 'note')).toHaveLength(16);
    expect(lines?.steps.find((s) => s.kind === 'turnin')?.condition?.filter).toEqual({ kind: 'word', word: 'Horde' });
    expect(lines?.location).toBeNull();
    expect(lines?.group.rxp?.waypoints.map((w) => w.filter)).toEqual([{ kind: 'word', word: 'Warrior' }]);
    expect(skip?.group.rxp?.condition?.filter).toEqual({ kind: 'word', word: 'skip' });
    expect(filteredTags?.steps.find((s) => s.kind === 'complete')).toMatchObject({ progress: 'partial' });
    expect(two.diagnostics.filter((d) => d.code === 'RXP028-level-filter')).toHaveLength(1);
    expect(two.diagnostics.filter((d) => d.code === 'RXP034-not-simulated').map((d) => d.line)).toEqual([63, 86, 98, 99]);
  });

  it('fixture 01: accepts, turn-ins, merged completes in a #completewith step, notes and trainer', () => {
    const one = lower(fixture01);
    expect(one.groups).toHaveLength(18);
    expect(one.groups[0]?.steps.map(payload)).toEqual([
      { kind: 'note', text: 'Talk to |cRXP_FRIENDLY_Kaltunk|r', preserved: null },
      { kind: 'accept', questId: 4641, anyOf: null, via: null },
    ]);
    expect(one.groups[7]?.steps.find((s) => s.kind === 'complete')).toMatchObject({
      targets: [
        { questId: 789, objective: 0 },
        { questId: 4402, objective: 0 },
      ],
      progress: 'partial',
    });
    expect(one.groups[16]?.steps.map(payload)).toEqual([
      { kind: 'note', text: 'Tick this box once you have sold your junk', preserved: null },
      { kind: 'vendor', what: null },
    ]);
    expect(one.diagnostics).toEqual([]);
  });
});

describe('lowering rules (docs/RXP.md §12)', () => {
  const body = (lines: string, ctx: RxpLowerContext = FULL_CONTEXT): Lowered => lower(`#forever\n#name T\n#group G\nstep\n${lines}\n`, 'forever', ctx);

  it('keeps unknown commands, stray lines and required-text failures as preserved notes', () => {
    const out = body('.frobnicate 1 >>text\nstray words\n.hs\n.zone Durotar');
    expect(out.groups[0]?.steps.map((s) => (s.kind === 'note' ? s.preserved?.lines : null))).toEqual([['.frobnicate 1 >>text'], ['stray words'], ['.hs'], ['.zone Durotar']]);
    expect(out.diagnostics.map((d) => d.code)).toEqual(['RXP001-unknown-command', 'RXP002-stray-line', 'RXP018-missing-text', 'RXP018-missing-text']);
  });

  it('remaps quest IDs after .convertquest for the rest of the guide (RXP029)', () => {
    const out = lower('#name T\n#group G\nstep\n.accept 5\n.convertquest 5,6\n.turnin 5\nstep\n.complete 5,1\n.isOnQuest 5\n', 'forever', { zoneKey: FULL_CONTEXT.zoneKey });
    const steps = out.groups.flatMap((g) => g.steps);
    expect(steps.map((s) => ('questId' in s ? s.questId : s.kind === 'complete' ? s.targets[0]?.questId : null))).toEqual([5, 6, 6]);
    expect(out.groups[1]?.group.rxp?.condition?.skipIf).toEqual([{ kind: 'questState', state: 'onQuest', questIds: [6], match: 'any', negate: true }]);
    expect(out.diagnostics.map((d) => d.code)).toEqual(['RXP029-convertquest']);
  });

  it('turns filtered skip lines opaque and keeps filters on variant, waypoint and annotation lines (G1)', () => {
    const out = body('.isOnQuest 5 << Orc\n.dungeon RFC << Troll\n.mob Boar << Orc\n.goto Durotar,1,2 << Orc');
    const rxp = out.groups[0]?.group.rxp;
    expect(rxp?.condition?.skipIf).toEqual([{ kind: 'opaque', raw: '.isOnQuest 5 << Orc' }]);
    expect(rxp?.condition?.variant).toEqual([{ name: '.dungeon', value: 'RFC', filter: { kind: 'word', word: 'Troll' } }]);
    expect(rxp?.annotations[0]?.filter).toEqual({ kind: 'word', word: 'Orc' });
    expect(rxp?.waypoints[0]?.filter).toEqual({ kind: 'word', word: 'Orc' });
  });

  it('reads .xp skip forms, jumps and malformed expressions (§9.4)', () => {
    const out = body('.xp 10+500,1\n.xp 10-5,1\n.xp <7,1,Label\n.xp 5x\n.xp <4');
    expect(out.groups[0]?.group.rxp?.condition?.skipIf).toEqual([
      { kind: 'levelAtLeast', level: 10, xp: 500, negate: false },
      { kind: 'opaque', raw: '.xp 10-5,1' },
      { kind: 'levelAtLeast', level: 7, xp: null, negate: true },
    ]);
    expect(out.groups[0]?.steps.map((s) => s.kind)).toEqual(['grind', 'note']);
    expect(out.diagnostics.map((d) => [d.code, d.severity])).toEqual([
      ['RXP034-not-simulated', 'info'],
      ['RXP004-malformed-number', 'warning'],
      ['RXP034-not-simulated', 'info'],
    ]);
  });

  it('reports world points outside their UiMap when geometry is known (RXP035)', () => {
    const out = body('.goto 1411/1,-9000.00,-600.00');
    expect(out.diagnostics.map((d) => d.code)).toEqual(['RXP035-goto-outside-map']);
    expect(body('.goto 1411/1,-9000.00,-600.00', { zoneKey: FULL_CONTEXT.zoneKey }).diagnostics).toEqual([]);
  });

  it('marks a complete step partial when .disablecheckbox follows it, and makes one abandon step per ID', () => {
    const out = body('.complete 788,1\n.mob Boar\n.disablecheckbox\n.abandon 1,2');
    expect(out.groups[0]?.steps.map(payload)).toEqual([
      { kind: 'complete', targets: [{ questId: 788, objective: 0 }], progress: 'partial' },
      { kind: 'abandon', questId: 1 },
      { kind: 'abandon', questId: 2 },
    ]);
  });

  it('does not merge .complete lines with different filters or blocking status', () => {
    const out = body('.complete 788,1\n.complete 789,1 << Orc\n.complete 790,1,0,1\n-- a comment\n.complete 792,1,0,1');
    expect(out.groups[0]?.steps.map((s) => (s.kind === 'complete' ? s.targets.map((t) => t.questId) : []))).toEqual([[788], [789], [790, 792]]);
  });

  it('merges .complete lines whose filters mean the same, however they are spelled (§12.3)', () => {
    const out = body('.complete 788,1 << Orc/Troll\n.complete 789,1 << Orc  /  Troll\n.complete 790,1 << (Orc/Troll)');
    expect(out.groups[0]?.steps.map((s) => (s.kind === 'complete' ? s.targets.map((t) => t.questId) : []))).toEqual([[788, 789, 790]]);
    expect(out.groups[0]?.steps[0]?.rxp?.line).toEqual({ importId: 'imp', firstLine: 5, lastLine: 7 });
  });

  it('refuses quest IDs of 0 or less where RXP gives them no meaning (§12.3, RXP004)', () => {
    const out = body('.accept -5\n.accept 0\n.acceptmultiple 5,-6\n.turninmultiple 0,5\n.isOnQuest -5\n.isQuestTurnedIn 7,0\n.turnin -8\n.complete -9,1');
    const [group] = out.groups;
    expect(group?.steps.map((s) => (s.kind === 'note' ? `note ${s.preserved?.lines[0] ?? ''}` : s.kind))).toEqual([
      'note .accept -5',
      'note .accept 0',
      'note .acceptmultiple 5,-6',
      'note .turninmultiple 0,5',
      'turnin',
      'complete',
    ]);
    expect(group?.group.rxp?.condition?.skipIf).toEqual([
      { kind: 'opaque', raw: '.isOnQuest -5' },
      { kind: 'opaque', raw: '.isQuestTurnedIn 7,0' },
    ]);
    const codes = out.diagnostics.map((d) => `${String(d.line)} ${d.code} ${d.severity}`);
    expect(codes.filter((code) => code.includes('RXP004'))).toEqual([5, 6, 7, 8, 9, 10].map((line) => `${String(line)} RXP004-malformed-number error`));
    expect(out.diagnostics.find((d) => d.line === 5)?.message).toContain('-5 is not a quest ID for ".accept"');
  });

  it('reads a .xp skip flag that is not a number as no flag: a grind objective with an RXP004 warning (§9.4)', () => {
    const out = body('.xp 10,abc\n.xp <5,abc');
    expect(out.groups[0]?.steps.map(payload)).toEqual([
      { kind: 'grind', until: { kind: 'level', level: 10, offset: null }, mobLevel: null, xpPerHour: null },
      { kind: 'note', text: '.xp <5,abc', preserved: { format: 'rxp', lines: ['.xp <5,abc'] } },
    ]);
    expect(out.groups[0]?.group.rxp?.condition).toBeNull();
    expect(out.diagnostics.map((d) => [d.line, d.code, d.severity])).toEqual([
      [5, 'RXP004-malformed-number', 'warning'],
      [6, 'RXP004-malformed-number', 'warning'],
      [6, 'RXP034-not-simulated', 'info'],
    ]);
  });

  it('stores no number the project schema cannot hold: huge or zero UiMapIDs and huge .xp values (§9.4, §10.4)', () => {
    const out = body(
      ['.goto 99999999999999999999/1,1,2', '.goto 1411/99999999999999999999,1,2', '.goto 0/1,1,2', '.xp 99999999999999999999', '.xp 5+99999999999999999999', '.xp 10.99999999999999999999', '.xp <99999999999999999999,1'].join('\n'),
    );
    const [group] = out.groups;
    expect(group?.location).toBeNull();
    expect(group?.group.rxp?.waypoints).toEqual([]);
    expect(group?.steps.every((s) => s.kind === 'note' && s.preserved !== null)).toBe(true);
    expect(group?.steps).toHaveLength(4);
    expect(out.diagnostics.map((d) => `${String(d.line)} ${d.code}`)).toEqual([5, 6, 7, 8, 9, 10, 11].map((line) => `${String(line)} RXP004-malformed-number`));
    expect(out.diagnostics[0]?.message).toContain('names no map');
  });

  it('gives RXP034 only to route-relevant preserved commands (§9.7)', () => {
    const out = body('.noop\n.beta 1\n.achievement 123\n.mirrorquest 1,2\n.setquestdb x = 1\n.destroy 159');
    expect(out.groups[0]?.steps.map((s) => s.kind)).toEqual(['note', 'note', 'note', 'note', 'note', 'note']);
    expect(out.diagnostics.map((d) => `${String(d.line)} ${d.code}`)).toEqual(['9 RXP034-not-simulated', '10 RXP034-not-simulated']);
  });

  it('keeps the new filter readings in the group condition: empty alternatives, word-less alternatives, merged words (§6.2)', () => {
    const out = lower('#forever\n#name T\n#group G\nstep << Orc/\n    .accept 1\nstep << /\n    .accept 2\nstep << Orc(Warrior)\n    .accept 3\n');
    expect(out.groups.map((g) => g.group.rxp?.condition?.filter)).toEqual([
      { kind: 'word', word: 'Orc' },
      { kind: 'or', exprs: [] },
      { kind: 'word', word: 'Orc(Warrior)' },
    ]);
  });
});

describe('lowering fixture 04 (docs/RXP.md §11, edge cases)', () => {
  const four = lower(fixture04);
  const lowering = four.diagnostics.filter((d) => rxpCodeSpec(d.code).stage === 'lowering');

  it('reports the lowering-stage edge cases on their lines: missing zone, localised zone, malformed number', () => {
    expect(lowering.map((d) => `${String(d.line)} ${d.code}`).sort()).toEqual(
      ['35 RXP003-goto-missing-zone', '39 RXP030-frame-ambiguous', '41 RXP009-localized-zone-name', '43 RXP004-malformed-number', '83 RXP034-not-simulated'].sort(),
    );
    expect(lowering.find((d) => d.code === 'RXP003-goto-missing-zone')?.message).toContain('"45.20" is a number');
    expect(lowering.find((d) => d.code === 'RXP009-localized-zone-name')?.message).toContain('"Wald von Elwynn"');
    expect(lowering.find((d) => d.code === 'RXP004-malformed-number')?.message).toContain('"-600.00.00"');
    expect(lowering.every((d) => d.severity === rxpCodeSpec(d.code).severity)).toBe(true);
  });

  it('keeps the lines that yield no point out of the model (§12.4 rule 6)', () => {
    const points = four.groups.flatMap((g) => [g.location?.source ?? null, ...(g.group.rxp?.waypoints ?? []).map((w) => w.point)]).filter((p) => p !== null);
    expect(points.some((p) => p.lexemes?.[0] === '45.20' || p.lexemes?.[1] === '-600.00.00' || p.lexemes?.[0] === '40.00')).toBe(false);
  });
});
