import { describe, expect, it } from 'vitest';
import canon01 from '../../tests/fixtures/rxp/canonical/01-basic-durotar.txt?raw';
import canon02 from '../../tests/fixtures/rxp/canonical/02-filters-and-step-tags.txt?raw';
import canon03a from '../../tests/fixtures/rxp/canonical/03-lua-wrapped-a.txt?raw';
import canon03b from '../../tests/fixtures/rxp/canonical/03-lua-wrapped-b.txt?raw';
import canon03c from '../../tests/fixtures/rxp/canonical/03-lua-wrapped-c.txt?raw';
import canon03d from '../../tests/fixtures/rxp/canonical/03-lua-wrapped-d.txt?raw';
import canon04 from '../../tests/fixtures/rxp/canonical/04-edge-cases.txt?raw';
import canon05 from '../../tests/fixtures/rxp/canonical/05-travel-and-conditions.txt?raw';
import canon06 from '../../tests/fixtures/rxp/canonical/06-lowering-and-export.txt?raw';
import fixture01 from '../../tests/fixtures/rxp/01-basic-durotar.txt?raw';
import fixture02 from '../../tests/fixtures/rxp/02-filters-and-step-tags.txt?raw';
import fixture03 from '../../tests/fixtures/rxp/03-lua-wrapped.txt?raw';
import fixture04 from '../../tests/fixtures/rxp/04-edge-cases-crlf.txt?raw';
import fixture05 from '../../tests/fixtures/rxp/05-travel-and-conditions.txt?raw';
import fixture06 from '../../tests/fixtures/rxp/06-lowering-and-export.txt?raw';
import { type QuestId, questId, sequentialIdSource, stepId, uiMapId, worldMapId } from '../domain/ids';
import type { RxpImport } from '../domain/project';
import type { RouteStep } from '../domain/route';
import { makeAcceptStep, makeCompleteStep, makeFlightStep, makeGrindStep, makeHearthStep, makeNoteStep, makeTrainStep, makeTravelStep, makeTurnInStep, makeVendorStep } from '../domain/step-factory';
import { canonicalizeRxp } from './canonical';
import { parseRxpCst } from './cst';
import { type ImportedGuide, importRxp } from './import';
import { type RxpExportResult, exportRxp } from './serialize';
import { testGeometry, testRoute, testZoneKey, ZONES_ONLY } from './test-fixtures';
import { unwrapRxpInput } from './unwrap';

const CTX = { zoneKey: testZoneKey, geometry: testGeometry };

function importOne(text: string): ImportedGuide {
  const result = importRxp(text, sequentialIdSource(), ZONES_ONLY);
  if (result.status !== 'ok') throw new Error('refused');
  const [guide] = result.guides;
  if (guide === undefined) throw new Error('no guide');
  return guide;
}

function exportSteps(guide: ImportedGuide, steps: readonly RouteStep[], imports: readonly RxpImport[] = [guide.import]): RxpExportResult {
  return exportRxp(testRoute(steps, guide.groups), imports, CTX);
}

function okText(result: RxpExportResult): string {
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '));
  return result.text;
}

/** Lowered content without line references, fingerprints and step/group ids (canonical idempotence, §13.7). */
function semantic(guide: ImportedGuide): unknown {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (['line', 'fingerprint', 'id', 'groupId', 'importId', 'ref'].includes(key)) continue;
        // Preserved lines are source text (a reference, like `line`); only their number is semantic.
        out[key] = key === 'lines' && Array.isArray(item) ? item.length : strip(item);
      }
      return out;
    }
    return value;
  };
  return strip({ steps: guide.steps, groups: Object.values(guide.groups).map((group) => group.rxp) });
}

const RAW_FIXTURES: Readonly<Record<string, string>> = { fixture01, fixture02, fixture04, fixture05, fixture06 };

describe('export guarantee: unedited imports (docs/RXP.md §13.3 rule 1, X1)', () => {
  it.each(Object.entries(RAW_FIXTURES))('exports %s byte for byte', (_name, text) => {
    const guide = importOne(text);
    const result = exportSteps(guide, guide.steps);
    expect(okText(result)).toBe(text);
    expect(result.ok && result.unedited).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('decides "unedited" by comparing with the template first, and by the fingerprint when the template lowers differently (§13.2)', () => {
    const guide = importOne(fixture06);
    // Content equal to the template lowered again: unedited, whatever the stored fingerprint says.
    const stale = Object.fromEntries(Object.entries(guide.groups).map(([id, group]) => [id, { ...group, rxp: group.rxp === null ? null : { ...group.rxp, fingerprint: 'stale' } }]));
    const fast = exportRxp(testRoute(guide.steps, stale), [guide.import], CTX);
    expect(fast.ok && fast.unedited).toBe(true);
    expect(okText(fast)).toBe(fixture06);
    // A zone-key table without Durotar lowers the template differently: the stored fingerprints decide, and still match.
    const noDurotar = { ...CTX, zoneKey: (name: string) => (name === 'Durotar' ? null : testZoneKey(name)) };
    const slow = exportRxp(testRoute(guide.steps, guide.groups), [guide.import], noDurotar);
    expect(slow.ok && slow.unedited).toBe(true);
    expect(okText(slow)).toBe(fixture06);
  });

  it('exports each extracted guide of fixture 03 as its extracted text', () => {
    const result = importRxp(fixture03, sequentialIdSource(), ZONES_ONLY);
    if (result.status !== 'ok') throw new Error('refused');
    expect(result.guides).toHaveLength(4);
    for (const guide of result.guides) expect(okText(exportSteps(guide, guide.steps))).toBe(guide.import.text);
  });

  it('keeps a BOM, CR-only endings and a missing final newline when nothing was edited', () => {
    const text = String.fromCharCode(0xfeff) + '#forever\r#name T\r#group G\rstep\r    .accept 1 -- c';
    const guide = importOne(text);
    expect(okText(exportSteps(guide, guide.steps))).toBe(text);
  });
});

describe('export after edits (docs/RXP.md §13.5, X2-X5)', () => {
  const guide = importOne(fixture06);
  const steps = guide.steps;
  const [header = ''] = fixture06.split('\nstep\n');

  it('X2: deleting a step rewrites only its group in canonical form', () => {
    const text = okText(exportSteps(guide, steps.filter((s) => !(s.kind === 'accept' && s.questId === 789))));
    const l01 = [
      'step',
      "    -- L01: Gornek's position in world form: UiMap 1411 on world map 1, HereBeDragons order (world",
      '    -- Y, then world X). It must resolve to Durotar 42.06,68.33 (docs/research/coordinates.md 7).',
      '    .goto 1411/1,-4186.42,-600.30',
      '    .turnin -788 >> Hand in Cutting Teeth if it is in your log',
      '',
    ].join('\n');
    const original = fixture06.split('\nstep\n');
    expect(text).toBe(`${header}\n${l01}step\n${original.slice(2).join('\nstep\n')}`);
  });

  it('X3: moving a step out of its group splits the group (RXP040) and keeps the others byte-identical', () => {
    const turnin = steps.find((s) => s.kind === 'turnin' && s.questId === 789);
    if (turnin === undefined) throw new Error('no L06 turn-in');
    const rest = steps.filter((s) => s !== turnin);
    const afterL07 = rest.map((s) => s.kind).lastIndexOf('grind') + 1;
    const result = exportSteps(guide, [...rest.slice(0, afterL07), turnin, ...rest.slice(afterL07)]);
    const text = okText(result);
    expect(text).toContain(
      [
        'step',
        '    -- L06: any-of accept and a turn-in with a reward choice.',
        '    .goto Durotar,42.06,68.33',
        '    .acceptmultiple 790,792 >> Take whichever of the two is offered',
        'step',
        '    -- L07: grind targets: plain level, xpInto (L+N), xpShort (L-N) and fraction (L.F) offsets.',
        '    .xp 6',
        '    .xp 6+150',
        '    .xp 7-200',
        '    .xp 7.5',
        'step',
        '    .goto Durotar,42.06,68.33',
        '    .turnin 789,2',
        'step << Orc/Troll',
      ].join('\n'),
    );
    expect(result.diagnostics.map((d) => d.code)).toEqual(['RXP040-group-split']);
  });

  it('X4: a location moved in the app is written in world form in the smallest containing frame', () => {
    const travel = steps.find((s) => s.kind === 'travel' && s.location?.radius === 15);
    const moved = steps.map((s) =>
      s.groupId === travel?.groupId ? { ...s, location: { source: { space: 'world' as const, mapId: worldMapId(1), x: -500, y: -4000, uiMapId: null, lexemes: null }, label: null, radius: 15 } } : s,
    );
    const text = okText(exportSteps(guide, moved));
    expect(text).toContain(['step', '    -- L09: travel, bind, flight and hearth steps.', '    .goto 1411/1,-4000.00,-500.00,15', '    >> Walk to the placeholder point', 'step'].join('\n'));
    expect(text.replace(/step\n {4}-- L09[^]*?(?=step\n {4}\.goto Durotar,51\.90)/, '')).toBe(fixture06.replace(/step\n {4}-- L09[^]*?(?=step\n {4}\.goto Durotar,51\.90)/, ''));
  });

  it('X5: an app-created step after the last group keeps the copied location’s UiMap and lexemes', () => {
    const first = steps[0];
    if (first === undefined) throw new Error('empty');
    const added = makeAcceptStep(sequentialIdSource(100), { questId: questId(790), location: first.location });
    const text = okText(exportSteps(guide, [...steps, added]));
    expect(text).toBe(`${fixture06}step\n    .goto 1411/1,-4186.42,-600.30\n    .accept 790\n`);
  });

  it('re-imports an edited export to the same model (semantic round trip)', () => {
    const edited = steps.filter((s) => !(s.kind === 'accept' && s.questId === 789));
    const again = importOne(okText(exportSteps(guide, edited)));
    const reference = importOne(fixture06);
    const expected = semantic({ ...reference, steps: reference.steps.filter((s) => !(s.kind === 'accept' && s.questId === 789)) });
    expect(semantic(again)).toEqual(expected);
  });

  it('rebuilds a changed step from the model and keeps what only the template line holds', () => {
    const changed = steps.map((s) => (s.kind === 'turnin' && s.questId === 789 ? { ...s, rewardIndex: 1 } : s));
    expect(okText(exportSteps(guide, changed))).toContain('    .turnin 789,1\n');
    const dropped = steps.map((s) => (s.kind === 'complete' && s.targets.length === 3 ? { ...s, targets: s.targets.slice(0, 2) } : s));
    const text = okText(exportSteps(guide, dropped));
    expect(text).toContain('    .complete 788,1\n    .complete 789,1\n    .mob Mottled Boar\n');
    expect(text).not.toContain('.complete 788,2');
  });

  it('drops the comments of a deleted line (RXP045) and the texts of rebuilt merged lines (RXP044)', () => {
    const one = importOne('#name T\n#group G\nstep\n    -- about quest 1\n    .accept 1 --trailing\n    .accept 2\n');
    const result = exportSteps(one, one.steps.filter((s) => !(s.kind === 'accept' && s.questId === 1)));
    expect(okText(result)).toBe('#name T\n#group G\nstep\n    .accept 2\n');
    expect(result.diagnostics.map((d) => `${String(d.line)} ${d.code}`)).toEqual(['4 RXP045-comment-dropped', '5 RXP045-comment-dropped']);
    const merged = importOne('#forever\n#name T\n#group G\nstep\n    .complete 788,1 >>first\n    .complete 789,1 >>second\n');
    const rebuilt = merged.steps.map((s) => (s.kind === 'complete' ? { ...s, targets: [...s.targets].reverse() } : s));
    const out = exportSteps(merged, rebuilt);
    expect(okText(out)).toBe('#forever\n#name T\n#group G\nstep\n    .complete 789,1 >> first\n    .complete 788,1\n');
    expect(out.diagnostics.map((d) => d.code)).toEqual(['RXP044-text-dropped']);
  });

  it('repeats the step filter, variants, predicates, tags and location in every run of a split group, #label only in the first', () => {
    const text = '#forever\n#name T\n#group G\nstep << Orc\n    #label Here\n    #sticky\n    #xprate <1.5\n    .isOnQuest 5\n    .goto Durotar,40.00,60.00\n    .accept 1\n    .accept 2\nstep\n    .accept 3\n';
    const split = importOne(text);
    const [a1, a2, a3] = split.steps;
    if (a1 === undefined || a2 === undefined || a3 === undefined) throw new Error('steps');
    expect(okText(exportSteps(split, [a1, a3, a2]))).toBe(
      [
        '#forever',
        '#name T',
        '#group G',
        'step << Orc',
        '    #label Here',
        '    #sticky',
        '    #xprate <1.5',
        '    .isOnQuest 5',
        '    .goto Durotar,40.00,60.00',
        '    .accept 1',
        'step',
        '    .accept 3',
        'step << Orc',
        '    #sticky',
        '    #xprate <1.5',
        '    .isOnQuest 5',
        '    .goto Durotar,40.00,60.00',
        '    .accept 2',
        '',
      ].join('\n'),
    );
  });

  it('keeps the trailing comment of a line rebuilt from the model (§13.4 rule 11, §13.5 rule 2)', () => {
    const text = '#name T\n#group G\nstep\n    #label Here --the tag\n    .goto Durotar,40.00,60.00 -- the camp\n    .mob Boar --boars\n    .turnin 789 -- keep me\n';
    const one = importOne(text);
    const reward = one.steps.map((s) => (s.kind === 'turnin' ? { ...s, rewardIndex: 2 } : s));
    const rewarded = exportSteps(one, reward);
    expect(okText(rewarded)).toBe('#name T\n#group G\nstep\n    #label Here --the tag\n    .goto Durotar,40.00,60.00 -- the camp\n    .mob Boar --boars\n    .turnin 789,2 -- keep me\n');
    expect(rewarded.diagnostics).toEqual([]);
    // The location moved in the app, and the sidecar lines were changed: every rebuilt line keeps its comment.
    const [group] = Object.values(one.groups);
    const rxp = group?.rxp;
    if (group === undefined || rxp === undefined || rxp === null) throw new Error('no group');
    const groups = {
      [group.id]: {
        ...group,
        rxp: { ...rxp, tags: rxp.tags.map((tag) => ({ ...tag, value: 'There' })), annotations: rxp.annotations.map((note) => ({ ...note, args: ['Wolf'] })) },
      },
    };
    const moved = one.steps.map((s) => ({ ...s, location: { source: { space: 'world' as const, mapId: worldMapId(1), x: -500, y: -4000, uiMapId: null, lexemes: null }, label: null, radius: null } }));
    const out = exportRxp(testRoute(moved, groups), [one.import], CTX);
    expect(okText(out)).toBe('#name T\n#group G\nstep\n    #label There --the tag\n    .goto 1411/1,-4000.00,-500.00 -- the camp\n    .mob Wolf --boars\n    .turnin 789 -- keep me\n');
    expect(out.diagnostics).toEqual([]);
    // A location cleared in the app takes its line and that line's comment with it.
    const cleared = exportSteps(one, one.steps.map((s) => ({ ...s, location: null })));
    expect(okText(cleared)).toBe('#name T\n#group G\nstep\n    #label Here --the tag\n    .mob Boar --boars\n    .turnin 789 -- keep me\n');
    expect(cleared.diagnostics.map((d) => `${String(d.line)} ${d.code}`)).toEqual(['5 RXP045-comment-dropped']);
  });

  it('keeps the trailing comment of each merged .complete line with its target, and drops it with a removed target (RXP045)', () => {
    const merged = importOne('#forever\n#name T\n#group G\nstep\n    .complete 788,1 -- first\n    .complete 789,1 -- second\n    .complete 790,1 -- third\n');
    const reordered = merged.steps.map((s) => (s.kind === 'complete' ? { ...s, targets: [s.targets[2], s.targets[0]].filter((t) => t !== undefined) } : s));
    const out = exportSteps(merged, reordered);
    expect(okText(out)).toBe('#forever\n#name T\n#group G\nstep\n    .complete 790,1 -- third\n    .complete 788,1 -- first\n');
    expect(out.diagnostics.map((d) => `${String(d.line)} ${d.code}`)).toEqual(['6 RXP045-comment-dropped']);
  });

  it('drops the comments of a line rebuilt to nothing, such as a note emptied in the app (RXP041, RXP045)', () => {
    const one = importOne('#name T\n#group G\nstep\n    -- about the note\n    >>A note --trailing\n    .accept 1\n');
    const emptied = one.steps.map((s) => (s.kind === 'note' ? { ...s, text: '  ' } : s));
    const out = exportSteps(one, emptied);
    expect(okText(out)).toBe('#name T\n#group G\nstep\n    .accept 1\n');
    expect(out.diagnostics.map((d) => `${String(d.line)} ${d.code}`)).toEqual(['4 RXP045-comment-dropped', '5 RXP045-comment-dropped', '0 RXP041-app-fields-not-exported']);
    expect(out.diagnostics.at(-1)?.message).toContain('note without text × 1');
  });

  it('writes a tab in a comment as a space instead of refusing the export (§13.4 rule 11)', () => {
    const one = importOne('#name T\n#group G\nstep\n    -- a\tcomment\n    .accept 1 --x\ty\n    .accept 2\n');
    const out = exportSteps(one, one.steps.filter((s) => !(s.kind === 'accept' && s.questId === 2)));
    expect(okText(out)).toBe('#name T\n#group G\nstep\n    -- a comment\n    .accept 1 --x y\n');
    expect(canonicalizeRxp('#name T\n#group G\nstep\n    -- a\tcomment\n').ok).toBe(true);
    expect(canonicalizeRxp('#name T\n#group G\nstep\n    >>a\ttab\n').ok).toBe(false);
  });

  it('makes the text-only flag follow the model’s progress, both ways (§13.5 rule 2)', () => {
    const one = importOne('#forever\n#name T\n#group G\nstep\n    .complete 788,1,0,1\n    .complete 789,1,0,3\nstep\n    .collect 4862,10,789,1,1\nstep\n    .complete 790,1\n    .disablecheckbox\n');
    expect(one.steps.map((s) => (s.kind === 'complete' ? s.progress : s.kind))).toEqual(['partial', 'partial', 'partial']);
    const finished = one.steps.map((s) => (s.kind === 'complete' ? { ...s, progress: 'finish' as const } : s));
    const out = exportSteps(one, finished);
    expect(okText(out)).toBe('#forever\n#name T\n#group G\nstep\n    .complete 788,1,0,0\n    .complete 789,1,0,2\nstep\n    .collect 4862,10,789,1,0\nstep\n    .complete 790,1\n    .disablecheckbox\n');
    expect(out.diagnostics.map((d) => d.code)).toEqual(['RXP041-app-fields-not-exported']);
    expect(out.diagnostics[0]?.message).toContain('finish progress of a step that a .disablecheckbox follows × 1');
    const again = importOne(okText(out));
    expect(again.steps.map((s) => (s.kind === 'complete' ? s.progress : s.kind))).toEqual(['finish', 'finish', 'partial']);
    // And back: partial sets the flag again (giving the original text), but not where .disablecheckbox already makes the step partial.
    const partial = again.steps.map((s) => (s.kind === 'complete' ? { ...s, progress: 'partial' as const } : s));
    expect(okText(exportSteps(again, partial))).toBe(okText(exportSteps(one, one.steps)));
  });

  it('writes an "all objectives" target as one .complete per objective when the context knows the count (§13.6)', () => {
    const ctx = { ...CTX, quest: (id: QuestId) => (id === questId(788) ? { objectiveCount: 3, custom: false } : id === questId(789) ? { objectiveCount: 0, custom: true } : null) };
    const one = importOne('#forever\n#name T\n#group G\nstep\n    .complete 788,1 >>Kill them -- all of them\n');
    const all = one.steps.map((s) => (s.kind === 'complete' ? { ...s, targets: [{ questId: questId(788), objective: null }] } : s));
    const out = exportRxp(testRoute(all, one.groups), [one.import], ctx);
    expect(okText(out)).toBe('#forever\n#name T\n#group G\nstep\n    .complete 788,1 >> Kill them -- all of them\n    .complete 788,2\n    .complete 788,3\n');
    expect(out.diagnostics.map((d) => d.code)).toEqual(['RXP041-app-fields-not-exported']);
    const ids = sequentialIdSource(700);
    const app = [
      makeCompleteStep(ids, { targets: [{ questId: questId(788), objective: 1 }, { questId: questId(788), objective: null }] }),
      makeCompleteStep(ids, { targets: [{ questId: questId(789), objective: null }] }),
      makeCompleteStep(ids, { targets: [{ questId: questId(1), objective: null }] }),
    ];
    const made = exportRxp(testRoute(app, {}, 'R'), [], ctx);
    expect(okText(made)).toContain(
      [
        'step',
        '    .complete 788,2',
        '    .complete 788,1',
        '    .complete 788,3',
        '    >> (not representable in RXP) complete: a target means all objectives of a quest whose objective count is not known',
        '    >> (not representable in RXP) complete: a target means all objectives of a quest whose objective count is not known',
        '',
      ].join('\n'),
    );
    expect(made.diagnostics.map((d) => d.code)).toEqual(['RXP043-header', 'RXP042-unrepresentable-step', 'RXP042-unrepresentable-step', 'RXP041-app-fields-not-exported']);
    // Without quest facts in the context, the rebuilt step is a note too: never a refusal.
    const without = exportRxp(testRoute(all, one.groups), [one.import], CTX);
    expect(okText(without)).toContain('    >> (not representable in RXP) complete: a target means all objectives of a quest whose objective count is not known -- all of them\n');
  });

  it('keeps an app-created radius without making it an arrival objective (§13.6)', () => {
    const ids = sequentialIdSource(800);
    const at = { source: { space: 'zone' as const, uiMapId: uiMapId(1411), x: 42.06, y: 68.33, frame: 'forever' as const, lexemes: null }, label: null, radius: 5 };
    const text = okText(exportRxp(testRoute([makeAcceptStep(ids, { questId: questId(790), location: at })], {}, 'R'), [], CTX));
    expect(text).toContain('step\n    .goto 1411/1,-4186.42,-600.30,5,0\n    .accept 790\n');
    const again = importOne(text);
    expect(again.steps.map((s) => s.kind)).toEqual(['accept']);
    expect(again.steps[0]?.location?.radius).toBe(5);
    const travel = okText(exportRxp(testRoute([makeTravelStep(ids, { location: at })], {}, 'R'), [], CTX));
    expect(travel).toContain('    .goto 1411/1,-4186.42,-600.30,5\n');
  });

  it('writes an app-created note without text as nothing, instead of refusing the export (§13.6, RXP041)', () => {
    const ids = sequentialIdSource(900);
    const out = exportRxp(testRoute([makeNoteStep(ids, { text: '' }), makeAcceptStep(ids, { questId: questId(1) })], {}, 'R'), [], CTX);
    expect(okText(out)).toBe('#forever\n#name R\n#version 1\n#group R\n\nstep\n    .accept 1\n');
    expect(out.diagnostics.map((d) => d.code)).toEqual(['RXP043-header', 'RXP041-app-fields-not-exported']);
  });

  it('writes the special filter shapes so that they read back the same (§6.2, §13.4 rule 10)', () => {
    const one = importOne('#forever\n#name T\n#group G\nstep << Orc/\n    .accept 1\n    .accept 2 << Orc( Warrior / Mage )\n    .accept 3 << /\n    .accept 4 << Orc/ - \n');
    const out = okText(exportSteps(one, one.steps.filter((s) => !(s.kind === 'accept' && s.questId === 1))));
    expect(out).toBe('#forever\n#name T\n#group G\nstep << Orc\n    .accept 2 << Orc(Warrior/Mage)\n    .accept 3 << /\n    .accept 4 << Orc/-\n');
    expect(semantic(importOne(out))).toEqual(semantic({ ...one, steps: one.steps.filter((s) => !(s.kind === 'accept' && s.questId === 1)) }));
  });

  it('keeps a travel objective’s radius but drops the objective when the travel step is deleted', () => {
    const travel = importOne('#name T\n#group G\nstep\n    .goto Durotar,52.00,41.00,15\n    >>Walk\n');
    const text = okText(exportSteps(travel, travel.steps.filter((s) => s.kind !== 'travel')));
    expect(text).toBe('#name T\n#group G\nstep\n    .goto Durotar,52.00,41.00,15,0\n    >> Walk\n');
    expect(semantic(importOne(text))).toEqual(semantic({ ...travel, steps: travel.steps.filter((s) => s.kind !== 'travel') }));
  });
});

describe('app-created steps, headers and wrappers (docs/RXP.md §13.6, §13.4 rule 14)', () => {
  const ids = sequentialIdSource(1);
  const durotar = { source: { space: 'zone' as const, uiMapId: uiMapId(1411), x: 42.06, y: 68.33, frame: 'forever' as const, lexemes: null }, label: null, radius: null };
  const at = { location: durotar };

  it('writes one RXP step per run of steps sharing a location, with a generated header (RXP043)', () => {
    const steps: RouteStep[] = [
      makeTravelStep(ids, at),
      makeAcceptStep(ids, { ...at, questId: questId(1), rxp: { text: 'Take it', line: null } }),
      makeAcceptStep(ids, { ...at, questId: questId(2), anyOf: [questId(2), questId(3)] }),
      makeCompleteStep(ids, { ...at, targets: [{ questId: questId(1), objective: 0 }, { questId: questId(1), objective: 1 }], progress: 'partial' }),
      makeTurnInStep(ids, { ...at, questId: questId(1), rewardIndex: 2, skipIfMissing: true }),
      makeGrindStep(ids, { until: { kind: 'level', level: 7, offset: { kind: 'fraction', fraction: 0.25 } } }),
      makeHearthStep(ids, { mode: 'use' }),
      makeHearthStep(ids, { mode: 'bind' }),
      makeFlightStep(ids, { mode: 'take', nodeQuery: 'Crossroads' }),
      makeTrainStep(ids, { spellId: null }),
      makeVendorStep(ids, { what: 'food', condition: { filter: { kind: 'word', word: 'Orc' }, variant: null, skipIf: [] } }),
      makeNoteStep(ids, { text: 'Hello' }),
    ];
    const result = exportRxp(testRoute(steps, {}, 'My Route'), [], CTX);
    expect(okText(result)).toBe(
      [
        '#forever',
        '#name My Route',
        '#version 1',
        '#group My Route',
        '',
        'step',
        '    #completewith next',
        '    .goto 1411/1,-4186.42,-600.30,10',
        '    .accept 1 >> Take it',
        '    .acceptmultiple 2,3',
        '    .complete 1,1',
        '    .complete 1,2',
        '    .turnin -1,2',
        'step',
        '    .xp 7.25',
        '    .hs >> Use the Hearthstone',
        '    .home',
        '    .fly Crossroads',
        '    .trainer',
        '    .vendor >> food << Orc',
        '    >> Hello',
        '',
      ].join('\n'),
    );
    expect(result.diagnostics.map((d) => d.code)).toEqual(['RXP043-header']);
  });

  it('writes unrepresentable steps as notes (RXP042) and counts app-only fields (RXP041)', () => {
    const steps: RouteStep[] = [
      makeGrindStep(ids, { until: { kind: 'duration', seconds: 600 }, note: 'mine' }),
      makeTravelStep(ids, { mode: 'mount' }),
      makeCompleteStep(ids, { targets: [{ questId: questId(1), objective: null }], locked: true }),
    ];
    const result = exportRxp(testRoute(steps, {}, 'R'), [], CTX);
    expect(okText(result)).toContain('    >> (not representable in RXP) grind: 600 seconds\n    >> (not representable in RXP) travel: no destination\n');
    expect(result.diagnostics.map((d) => d.code)).toEqual(['RXP043-header', 'RXP042-unrepresentable-step', 'RXP042-unrepresentable-step', 'RXP042-unrepresentable-step', 'RXP041-app-fields-not-exported']);
    expect(result.diagnostics.at(-1)?.message).toContain('lock × 1');
  });

  it('refuses content RXP would read differently instead of changing it', () => {
    const bad = exportRxp(testRoute([makeNoteStep(ids, { text: 'a -- b' })], {}, 'R'), [], CTX);
    expect(bad.ok).toBe(false);
    expect(bad.ok ? [] : bad.errors.map((e) => e.message)).toEqual([expect.stringContaining('"--"')]);
    expect(exportRxp(testRoute([], {}, 'A << B'), [], CTX).ok).toBe(false);
  });

  it('uses the first import’s header and drops the others (RXP043)', () => {
    const a = importOne(fixture06);
    const result = importRxp(fixture05, sequentialIdSource(500), ZONES_ONLY);
    if (result.status !== 'ok') throw new Error('refused');
    const [b] = result.guides;
    if (b === undefined) throw new Error('no guide');
    const route = testRoute([...a.steps, ...b.steps], { ...a.groups, ...b.groups });
    const out = exportRxp(route, [a.import, b.import], CTX);
    const text = okText(out);
    expect(text.startsWith(fixture06)).toBe(true);
    expect(text.slice(fixture06.length)).toBe(fixture05.slice(fixture05.indexOf('\nstep\n') + 1));
    expect(out.diagnostics.map((d) => d.code)).toEqual(['RXP043-header']);
  });

  it('wraps the export in RegisterGuide on request, and warns on a raw export of a two-argument guide (RXP046)', () => {
    const lua = importRxp(fixture03, sequentialIdSource(), ZONES_ONLY);
    if (lua.status !== 'ok') throw new Error('refused');
    const guideC = lua.guides[2];
    if (guideC === undefined) throw new Error('no guide C');
    const raw = exportSteps(guideC, guideC.steps);
    expect(raw.diagnostics.map((d) => d.code)).toEqual(['RXP046-wrapper-args']);
    const wrapped = exportRxp(testRoute(guideC.steps, guideC.groups), [guideC.import], CTX, { wrapper: 'lua' });
    const text = okText(wrapped);
    expect(text.startsWith('RXPGuides.RegisterGuide("Forever Route Lab Fixtures", [[\n')).toBe(true);
    expect(text.endsWith(']], "Orc/Troll")\n')).toBe(true);
    const back = unwrapRxpInput(text);
    expect(back.guides.map((g) => [g.text, g.groupArg, g.defaultForArg])).toEqual([[guideC.import.text, 'Forever Route Lab Fixtures', 'Orc/Troll']]);
    const plain = importOne(fixture01);
    const plainWrapped = okText(exportRxp(testRoute(plain.steps, plain.groups), [plain.import], CTX, { wrapper: 'lua' }));
    expect(plainWrapped.startsWith('RXPGuides.RegisterGuide([[\n')).toBe(true);
    expect(unwrapRxpInput(plainWrapped).guides[0]?.text).toBe(fixture01);
  });
});

describe('canonical form (docs/RXP.md §13.4, §13.7)', () => {
  const GOLDEN: readonly (readonly [string, string, string])[] = [
    ['fixture01', fixture01, canon01],
    ['fixture02', fixture02, canon02],
    ['fixture04', fixture04, canon04],
    ['fixture05', fixture05, canon05],
    ['fixture06', fixture06, canon06],
    ...unwrapRxpInput(fixture03).guides.map((guide, k) => [`fixture03 guide ${'ABCD'[k] ?? ''}`, guide.text, [canon03a, canon03b, canon03c, canon03d][k] ?? ''] as const),
  ];

  it.each(GOLDEN)('%s matches its golden canonical file and is idempotent', (_name, text, golden) => {
    const once = canonicalizeRxp(text);
    if (!once.ok) throw new Error(once.errors.join('; '));
    expect(once.text).toBe(golden);
    const twice = canonicalizeRxp(once.text);
    expect(twice.ok && twice.text).toBe(once.text);
    expect(once.text).not.toMatch(/[ \t]$|\t|\r/m);
    expect(once.text.endsWith('\n') && !once.text.endsWith('\n\n')).toBe(true);
  });

  it.each(GOLDEN)('%s lowers the same before and after canonicalisation (line references aside)', (_name, text, golden) => {
    expect(semantic(importOne(golden))).toEqual(semantic(importOne(text)));
  });

  it.each(GOLDEN)('%s lowers the same under whitespace fuzzing around separators', (_name, text) => {
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const any = (): string => ['', ' ', '  ', '\t', ' \t '][Math.floor(random() * 5)] ?? '';
    const some = (): string => [' ', '  ', '\t', ' \t '][Math.floor(random() * 4)] ?? ' ';
    const cst = parseRxpCst(text);
    const fuzzed = cst.lines
      .map((line) => {
        const filter = line.filter === null ? '' : `${any()}<<${any()}${line.filter.text}`;
        const textPart = line.text === null ? '' : `${any()}>>${any()}${line.text}`;
        let content = line.content;
        const command = line.command;
        if (line.kind === 'command' && command !== null && command.spec !== null && command.spec.lowering.kind !== 'preserved') {
          const separator = command.spec.separator === 'semicolon' ? ';' : ',';
          const args = command.spec.separator === 'rest' ? command.argsRaw : command.args.join(`${any()}${separator}${any()}`);
          content = `.${command.name}${args === '' ? '' : some() + args}${textPart}${filter}`;
        } else if (line.kind === 'note' && line.text !== null) {
          content = `${line.lead === null || line.lead === '' ? '' : line.lead + any()}>>${any()}${line.text}${filter}`;
        } else if ((line.kind === 'objective' || line.kind === 'star') && line.lead !== null) {
          content = `${line.lead}${textPart}${filter}`;
        } else if (line.kind === 'tag' && line.tag !== null && !line.tag.key.includes('=')) {
          const { key, value, assignment } = line.tag;
          content = `#${key}${assignment ? `${any()}=${any()}` : value === null ? '' : some()}${value ?? ''}${filter}`;
        } else if (line.kind === 'step' && line.stepSuffix === null) {
          content = `step${filter}`;
        } else if (line.kind === 'enabledFor') content = filter.trimStart();
        if (content === '') return line.raw + line.eol;
        return `${any()}${content}${line.comment === null ? any() : `${any()}--${line.comment}`}${line.eol}`;
      })
      .join('');
    expect(fuzzed).not.toBe(text);
    expect(semantic(importOne(fuzzed))).toEqual(semantic(importOne(text)));
  });

  it.each([
    ['merged .complete lines with differently spelled filters (RXP review F4)', 'step\n    .complete 788,1 << Orc/Troll\n    .complete 789,1 << Orc / Troll\n'],
    ['empty and word-less filter alternatives (F2)', 'step << Orc/\n    .accept 1 << /Orc\n    .accept 2 << Orc//Troll\n    .accept 3 << /\n    .accept 4 << Orc/ - /Troll\n'],
    ['groups written against words (F15)', 'step << Orc( Warrior / Mage )\n    .accept 1 << !Orc(Warrior) Rogue\n    .accept 2 << (Orc)(Troll)\n'],
    ['a tab in a comment (F8)', 'step\n    -- a\tcomment\n    .accept 1 --x\ty\n'],
  ])('%s: canonical form is idempotent and lowers the same', (_name, steps) => {
    const text = `#forever\n#name T\n#group G\n${steps}`;
    const once = canonicalizeRxp(text);
    if (!once.ok) throw new Error(once.errors.join('; '));
    expect(canonicalizeRxp(once.text)).toEqual(once);
    expect(semantic(importOne(once.text))).toEqual(semantic(importOne(text)));
  });

  it('keeps quest ids branded (compile-time check of the step factory shapes)', () => {
    const id: QuestId = questId(1);
    expect(makeAcceptStep(sequentialIdSource(), { questId: id }).id).toBe(stepId('step-1'));
  });
});
