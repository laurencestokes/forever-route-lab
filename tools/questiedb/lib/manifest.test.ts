import { describe, expect, it } from 'vitest';
import { classifyThreeWay, type DatasetSnapshot, diffDatasets, diffOverlays, diffRecords, summarise } from './diff-lib';
import { sha256Hex } from './git';
import { compact, document, idMap, pretty } from './json';
import { buildManifest, computeDataRevision, type ManifestInput, ORIGINS, outputEntry } from './manifest';
import { CARVE_OUT, type NoticeInput, POSTURE, PROVENANCE_URL, readAuthorship, renderNotice, wrap } from './notice';
import { loadUpstream } from './upstream';

const pin = loadUpstream();

describe('dataRevision (DATA_PROVENANCE §8.3)', () => {
  it('hashes "path\\tsha256\\n" lines sorted by UTF-8 byte order', () => {
    const outputs = [
      { path: 'zones.json', sha256: 'a'.repeat(64) },
      { path: 'NOTICE.md', sha256: 'b'.repeat(64) },
      { path: 'items.json', sha256: 'c'.repeat(64) },
    ];
    const expected = sha256Hex(`NOTICE.md\t${'b'.repeat(64)}\nitems.json\t${'c'.repeat(64)}\nzones.json\t${'a'.repeat(64)}\n`);
    expect(computeDataRevision(outputs)).toBe(expected);
    expect(computeDataRevision([...outputs].reverse())).toBe(expected);
  });

  it('rejects paths with tabs or newlines and malformed hashes', () => {
    expect(() => computeDataRevision([{ path: 'a\tb', sha256: 'a'.repeat(64) }])).toThrow(/tab or newline/);
    expect(() => computeDataRevision([{ path: 'a', sha256: 'xyz' }])).toThrow(/malformed/);
  });

  it('records the sha256 and byte length of the UTF-8 content', () => {
    const entry = outputEntry('NOTICE.md', 'café\n', null, []);
    expect(entry.bytes).toBe(6);
    expect(entry.sha256).toBe(sha256Hex(Buffer.from('café\n', 'utf8')));
  });
});

describe('deterministic JSON', () => {
  it('writes one top-level key per line and one element per line for "lines" values', () => {
    const text = document([
      ['_generated', { by: 'x' }, 'inline'],
      ['rows', [{ id: 1 }, { id: 2 }], 'lines'],
      ['empty', [], 'lines'],
      ['map', idMap([[10, 'b'], [2, 'a']]), 'lines'],
    ]);
    expect(text).toBe('{\n"_generated":{"by":"x"},\n"rows":[\n{"id":1},\n{"id":2}\n],\n"empty":[],\n"map":{\n"2":"a",\n"10":"b"\n}\n}\n');
    expect(JSON.parse(text)).toEqual({ _generated: { by: 'x' }, rows: [{ id: 1 }, { id: 2 }], empty: [], map: { 2: 'a', 10: 'b' } });
  });

  it('uses shortest round-trip numbers and refuses undefined, NaN and Infinity', () => {
    expect(compact({ a: 42.1, b: 0.1 + 0.2, c: 8589934770 })).toBe('{"a":42.1,"b":0.30000000000000004,"c":8589934770}');
    expect(() => compact({ a: undefined })).toThrow(/undefined/);
    expect(() => compact([Number.NaN])).toThrow(/non-finite/);
    expect(() => pretty({ a: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
    expect(() => idMap([[-1, 'x']])).toThrow(/ordered JSON key/);
  });
});

describe('NOTICE.md', () => {
  const input: NoticeInput = {
    repository: 'https://github.com/Questie/QuestieDB',
    commit: 'b6f5b07b0acf1c820993cbb0ce2521c912bb4c92',
    commitDate: '2026-09-23T14:13:50+02:00',
    authorship: 'Code: Logonz Data: Everyone else',
    dbcTarget: '1.60.1.69893',
    conversionSource: '1.15.9.69722',
    slice: null,
    licenceCheck: pin.licenceCheck,
  };
  const oneLine = (text: string): string => text.replace(/\n {2}/g, ' ').replace(/\n(?![-#\n>])/g, ' ');

  it('quotes the carve-out verbatim, names the pin, and holds no dataRevision or timestamp', () => {
    const text = renderNotice(input);
    expect(text).toContain(`> ${CARVE_OUT}`);
    expect(text).toContain('b6f5b07b0acf1c820993cbb0ce2521c912bb4c92');
    expect(text).toContain('"automatically generated from wowhead data"');
    expect(text).toContain('not affiliated with or endorsed by Blizzard Entertainment');
    expect(text).not.toMatch(/dataRevision|extractedAt/);
    expect(text.endsWith('\n')).toBe(true);
  });

  it("states the posture as DATA_PROVENANCE §3.2 does (data-F8)", () => {
    expect(POSTURE).toBe(
      "This repository's own code is licensed GPL-3.0-or-later. Treating Questie-derived data under that licence is a posture, not a legal conclusion; it grants no rights that upstream has not granted.",
    );
    expect(oneLine(renderNotice(input))).toContain(POSTURE);
    expect(renderNotice(input)).not.toContain('This is a posture');
  });

  it("renders the licence finding from upstream.json's licenceCheck, not from code (data-F9)", () => {
    const text = oneLine(renderNotice(input));
    expect(text).toContain("No root licence file (none covering Questie's own code or data) on the default branch of Questie/QuestieDB or Questie/Questie");
    expect(text).toContain(`(full-history check of every branch, ${pin.licenceCheck.date}; [DATA_PROVENANCE.md §3.1](${PROVENANCE_URL})).`);
    expect(text).not.toMatch(/has ever had a licence file/);
    const later = oneLine(renderNotice({ ...input, licenceCheck: { ...pin.licenceCheck, date: '2027-01-02', note: null } }));
    expect(later).toContain('every branch, 2027-01-02;');
    expect(later).not.toContain('bundled third-party material');
  });

  it('links the provenance record by its repository URL, which a reader of the deployed site can follow (data-F15)', () => {
    const text = renderNotice(input);
    expect(PROVENANCE_URL).toBe('https://github.com/laurencestokes/forever-route-lab/blob/main/docs/DATA_PROVENANCE.md');
    expect(text).toContain(`- [docs/DATA_PROVENANCE.md](${PROVENANCE_URL}): the full provenance record.`);
    expect(text).toContain(`](${PROVENANCE_URL})).`);
    expect(text.split('\n').filter((line) => line.includes('docs/DATA_PROVENANCE.md') && !line.includes(PROVENANCE_URL))).toEqual([]);
  });

  it('wraps long bullets within the width, indenting continuation lines', () => {
    expect(wrap('- one two three four', 10, '  ')).toEqual(['- one two', '  three', '  four']);
    expect(wrap('word', 2, '  ')).toEqual(['word']);
    expect(wrap('- see [a b c](http://x) now', 8, '  ')).toEqual(['- see', '  [a b c](http://x)', '  now']);
  });

  it("reads QuestieDB's authorship line from generate.lua", () => {
    expect(readAuthorship('  out:write("## Author: Code: Logonz Data: Muehe/Everyone else\\n")')).toBe('Code: Logonz Data: Muehe/Everyone else');
    expect(() => readAuthorship('nothing here')).toThrow(/Author/);
  });
});

describe('pin-to-pin diff', () => {
  it('reports added, removed and changed records by field, and provenance changes', () => {
    const before = [
      { id: 1, name: 'A', level: 1, provenance: { upstreamDiff: 'era', corrected: false } },
      { id: 2, name: 'B', level: 2, provenance: { upstreamDiff: 'era', corrected: false } },
    ];
    const after = [
      { id: 2, name: 'B', level: 3, provenance: { upstreamDiff: 'era-coords', corrected: true } },
      { id: 3, name: 'C', level: 1, provenance: { upstreamDiff: 'era', corrected: false } },
    ];
    expect(diffRecords(before, after)).toEqual({
      added: [3],
      removed: [1],
      changed: { 2: ['level'] },
      upstreamDiffChanged: [{ id: 2, from: 'era', to: 'era-coords' }],
      correctedChanged: [2],
    });
  });

  it('has a three-way classifier stub that answers unknown', () => {
    expect(classifyThreeWay({ id: 1 })).toBe('unknown');
  });

  const manifest = (commit: string, revision: string, quests: number): Readonly<Record<string, unknown>> => ({
    dataRevision: revision,
    upstream: { commit },
    outputs: [{ path: 'quests.json', sha256: revision }],
    counts: { shipped: { quests } },
  });
  const snapshotOf = (label: string, commit: string, quests: readonly { id: number; name: string }[], overlays: Readonly<Record<string, unknown>> | null): DatasetSnapshot => ({
    label,
    records: { quests: quests.map((q) => ({ ...q, provenance: { upstreamDiff: 'era', corrected: false } })), npcs: [], objects: [], items: [] },
    spawns: { npc: {}, object: {} },
    zones: { areas: {}, uiMaps: {}, dungeons: {}, instanceAreas: {} },
    overlays,
    manifest: manifest(commit, label === 'a' ? 'a'.repeat(64) : 'b'.repeat(64), quests.length),
  });
  const layer = (quests: Readonly<Record<string, unknown>>) => ({ quests, npcs: {}, objects: {}, items: {}, dungeons: {} });

  it('compares overlays patch by patch, ignoring _generated, which changes at every pin bump (data-F11)', () => {
    const before = { _generated: { upstream: 'Questie/QuestieDB@old' }, faction: { Alliance: layer({ 1: { level: 1 } }), Horde: layer({}) }, class: { Horde: { SHAMAN: { quests: { 2: { level: 2 } } } } } };
    const sameButPin = { ...before, _generated: { upstream: 'Questie/QuestieDB@new' } };
    expect(diffOverlays(before, sameButPin)).toEqual({});
    const changed = { ...sameButPin, faction: { Alliance: layer({ 1: { level: 3 }, 4: { level: 4 } }), Horde: layer({}) }, class: { Horde: { SHAMAN: { quests: {} } } } };
    expect(diffOverlays(before, changed)).toEqual({ 'faction.Alliance.quests': ['1', '4'], 'class.Horde.SHAMAN.quests': ['2'] });
    const summary = summarise(diffDatasets(snapshotOf('a', 'x', [], before), snapshotOf('b', 'y', [], sameButPin)));
    expect(summary).toContain('  overlays: identical');
    expect(summarise(diffDatasets(snapshotOf('a', 'x', [], before), snapshotOf('b', 'y', [], changed)))).toContain('  overlays changed: class.Horde.SHAMAN.quests 1, faction.Alliance.quests 2');
  });

  it('diffs whole datasets: records, outputs, counts and the upstream commit (code-F13)', () => {
    const a = snapshotOf('a', 'old', [{ id: 1, name: 'A' }, { id: 2, name: 'B' }], null);
    const b = snapshotOf('b', 'new', [{ id: 2, name: 'B2' }, { id: 3, name: 'C' }], null);
    const diff = diffDatasets(a, b);
    expect(diff.upstreamCommit).toEqual({ from: 'old', to: 'new' });
    expect(diff.outputs).toEqual([{ path: 'quests.json', from: 'a'.repeat(64), to: 'b'.repeat(64) }]);
    expect(diff.records?.quests).toMatchObject({ added: [3], removed: [1], changed: { 2: ['name'] } });
    expect(diff.overlays).toBeNull();
    const summary = summarise(diff);
    expect(summary).toContain('  upstream old → new');
    expect(summary).toContain('  quests: +1 -1 ~1 (name 1); upstreamDiff changed 0, corrected changed 0');
    expect(summary).toContain('  outputs changed: quests.json');
  });

  it('compares two manifests alone on hashes and counts', () => {
    const only = (label: string, revision: string): DatasetSnapshot => ({ label, records: null, spawns: null, zones: null, overlays: null, manifest: manifest('c', revision, 5) });
    const diff = diffDatasets(only('a', 'a'.repeat(64)), only('b', 'a'.repeat(64)));
    expect(diff.records).toBeNull();
    expect(diff.outputs).toEqual([]);
    expect(summarise(diff)).toContain('  records: not compared (manifest only)');
    expect(summarise(diff)).toContain('  outputs: identical');
  });
});

describe('manifest contents', () => {
  const base: ManifestInput = {
    generated: { by: 'tools/questiedb' },
    slice: null,
    upstream: { repository: pin.repository, branchObserved: 'master', commit: pin.commit, commitDate: '2026-09-23T14:13:50+02:00' },
    flavour: 'Forever',
    sourceGameBuilds: { dbcTarget: '1.60.1.69893', conversionSource: '1.15.9.69722', uiSourceResearched: '1.60.1.69913', tocInterface: 16001 },
    licenceCheck: pin.licenceCheck,
    toolTreeHash: { tree: '0'.repeat(40), lockfile: '0'.repeat(64) },
    runtime: { luaparse: '0.3.1' },
    inputs: [],
    upstreamManifestCheck: { allMatch: true },
    layers: [],
    dynamicLayers: [],
    outputs: [],
    counts: {},
    provenance: {},
  };

  it('renders the licence object from upstream.json and carries no Node version (data-F5, data-F9)', () => {
    const built = buildManifest(base);
    expect(built.licence).toEqual({
      upstreamLicenceFile: null,
      checked: pin.licenceCheck.date,
      finding: `${pin.licenceCheck.result}, full-history check (docs/DATA_PROVENANCE.md §3.1)`,
      projectLicence: 'GPL-3.0-or-later',
      scope: CARVE_OUT,
      notice: 'NOTICE.md',
    });
    expect(built.runtime).toEqual({ luaparse: '0.3.1' });
    expect(JSON.stringify(built)).not.toContain('nodeMajor');
  });

  it('labels correction-written labels, derived fields and the itemStartFixes list honestly (data-F10)', () => {
    const originOf = (file: string, field: string): string | undefined => ORIGINS[file]?.find((o) => o.fields.includes(field))?.origin;
    expect(originOf('quests.json', 'objectives[].label')).toBe('blizzard-game-content or questiedb-authored (not distinguished)');
    expect(originOf('quests.json', 'objectives[kind=event].text')).toBe('blizzard-game-content or questiedb-authored (not distinguished)');
    expect(originOf('quests.json', 'dungeonQuest')).toBe('derived by forever-route-lab from questiedb');
    expect(originOf('zones.json', 'areas[].link')).toBe('derived by forever-route-lab from questiedb');
    expect(originOf('zones.json', 'dungeons[].entrances[].frameVerified')).toBe('derived by forever-route-lab from questiedb');
    expect(originOf('items.json', 'startsQuest (the items listed in manifest provenance.itemStartFixesOnly)')).toBe('declared:wowhead-generated via questiedb:itemStartFixes');
  });
});
