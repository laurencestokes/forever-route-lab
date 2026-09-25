import { describe, expect, it } from 'vitest';
import { areaId, uiMapId, worldMapId } from '../domain/ids';
import { canonicalGeometryContent, GEOMETRY_CONTENT_FORMAT, GEOMETRY_CONTENT_VERSION } from './content';
import { mergeLocalGeometry } from './frame';
import { createMapGeometry, parseGeometryFile } from './geometry';
import { AZEROTH, DUROTAR, ERA_TO_FOREVER, fixtureGeometry, FIXTURE_MAPS, KALIMDOR, questiedbFrame } from './test-fixtures';
import type { EraToForeverCoefficients, GeometryAssignment, MapGeometry, UiMapGeometry } from './types';

const base = fixtureGeometry();
const content = canonicalGeometryContent(base);

const [durotarRow] = DUROTAR.assignments;
const [kalimdorRow] = KALIMDOR.assignments;
if (durotarRow === undefined || kalimdorRow === undefined) throw new Error('fixture');

/** The fixture geometry with one UiMap replaced. */
const withMap = (map: UiMapGeometry): MapGeometry => fixtureGeometry(FIXTURE_MAPS.map((m) => (m.uiMapId === map.uiMapId ? map : m)));
const withDurotarRow = (row: Partial<GeometryAssignment>): MapGeometry => withMap({ ...DUROTAR, assignments: [{ ...durotarRow, ...row }] });
const withKalimdorRow = (row: Partial<GeometryAssignment>): MapGeometry => withMap({ ...KALIMDOR, assignments: [{ ...kalimdorRow, ...row }] });
const withEra = (edit: Partial<EraToForeverCoefficients>): MapGeometry =>
  fixtureGeometry(FIXTURE_MAPS, ERA_TO_FOREVER.map(([id, c], i) => [id, i === 0 ? { ...c, ...edit } : c] as const));

describe('canonicalGeometryContent (MAPS.md §5.3 content hash)', () => {
  it('has the documented version-1 form', () => {
    const one = createMapGeometry({
      kind: 'placeholder',
      product: 'wow_classic_beta',
      recordedFrameHash: null,
      maps: [DUROTAR, KALIMDOR],
      eraToForever: ERA_TO_FOREVER.slice(0, 1),
    });
    expect(canonicalGeometryContent(one)).toBe(
      JSON.stringify([
        GEOMETRY_CONTENT_FORMAT,
        GEOMETRY_CONTENT_VERSION,
        'placeholder',
        'wow_classic_beta',
        [
          [1411, 'Durotar', 'questiedb-conversion', null, null, [[46721, 1, 14, 0, -1716.6666259766, 1808.3332519531, -7249.9995117188, -1962.4998779297, 0, 0, 1, 1, 'questiedb-conversion', '1.60.1.69893']]],
          [1414, 'Kalimdor', 'db2-csv', 2, 947, [[46724, 1, 0, 0, -11733.299804688, 12799.900390625, -19733.2109375, 17066.599609375, 0, 0, 1, 1, 'db2-csv', '1.60.1.70009']]],
        ],
        [[1412, 0.8348002068275978, 7.007453108736848, 0.8349418225477033, 13.15387327724201, '1.15.9.69722', '1.60.1.69893', 'questiedb-conversion']],
      ]),
    );
    expect(canonicalGeometryContent(one).startsWith('["frl-geometry-content",1,"placeholder","wow_classic_beta",[[1411,"Durotar"')).toBe(true);
  });

  it('does not depend on the order the geometry was built in', () => {
    const [first, second] = AZEROTH.assignments;
    if (first === undefined || second === undefined) throw new Error('fixture');
    const shuffled = fixtureGeometry([...FIXTURE_MAPS].reverse().map((map) => (map.uiMapId === AZEROTH.uiMapId ? { ...map, assignments: [second, first] } : map)), [...ERA_TO_FOREVER].reverse());
    expect(canonicalGeometryContent(shuffled)).toBe(content);
    // Also for a hand-built MapGeometry whose Maps were not sorted by createMapGeometry.
    const unsorted: MapGeometry = { ...base, maps: new Map([...base.maps].reverse()), eraToForever: new Map([...base.eraToForever].reverse()) };
    expect(canonicalGeometryContent(unsorted)).toBe(content);
  });

  it('changes with every field resolution, attribution, Era conversion or display reads', () => {
    const variants: Record<string, MapGeometry> = {
      'zone xMin (below float32 resolution too)': withDurotarRow({ xMin: durotarRow.xMin + 1e-9 }),
      'zone yMax': withDurotarRow({ yMax: durotarRow.yMax + 0.5 }),
      'zone areaId': withDurotarRow({ areaId: areaId(15) }),
      'zone mapId': withDurotarRow({ mapId: worldMapId(0) }),
      'zone assignment id': withDurotarRow({ id: 1 }),
      'zone build': withDurotarRow({ build: '1.60.1.70009' }),
      'zone source': withDurotarRow({ source: 'db2-csv' }),
      'continent xMin (a db2-csv row)': withKalimdorRow({ xMin: -5000 }),
      'continent UI rectangle': withKalimdorRow({ uiMax: [1, 0.99] }),
      'continent orderIndex': withKalimdorRow({ orderIndex: 1 }),
      name: withMap({ ...DUROTAR, name: 'Durotar (edited)' }),
      nameSource: withMap({ ...DUROTAR, nameSource: 'db2-csv' }),
      type: withMap({ ...KALIMDOR, type: 3 }),
      parent: withMap({ ...KALIMDOR, parent: uiMapId(0) }),
      'an added UiMap': fixtureGeometry([...FIXTURE_MAPS, questiedbFrame(2999, 'Synthetic', { id: 9, mapId: 2991, areaId: 1, xMin: 0, xMax: 10, yMin: 0, yMax: 15 })]),
      'a removed UiMap': fixtureGeometry(FIXTURE_MAPS.filter((map) => map.uiMapId !== KALIMDOR.uiMapId)),
      'Era scaleX ×1.5': withEra({ scaleX: (ERA_TO_FOREVER[0]?.[1].scaleX ?? 0) * 1.5 }),
      'Era offsetY': withEra({ offsetY: 0 }),
      'Era fromBuild': withEra({ fromBuild: '1.15.8.1' }),
      'a removed Era set': fixtureGeometry(FIXTURE_MAPS, ERA_TO_FOREVER.slice(1)),
      product: { ...base, product: 'wow_classic_era' },
      kind: { ...base, kind: 'local' },
    };
    const seen = new Set([content]);
    for (const [label, geometry] of Object.entries(variants)) {
      const text = canonicalGeometryContent(geometry);
      expect(text, label).not.toBe(content);
      seen.add(text);
    }
    expect(seen.size).toBe(Object.keys(variants).length + 1);
  });

  it('ignores the recorded hashes', () => {
    expect(canonicalGeometryContent({ ...base, recordedFrameHash: 'a'.repeat(64), recordedContentHash: 'b'.repeat(64) })).toBe(content);
  });

  it('is the same for a writer’s in-memory geometry and a reader’s parsed file (numbers round-trip)', () => {
    const maps: Record<string, unknown> = {};
    for (const map of base.maps.values()) {
      maps[String(map.uiMapId)] = { name: map.name, nameSource: map.nameSource, type: map.type, parent: map.parent, assignments: map.assignments };
    }
    const era: Record<string, unknown> = {};
    for (const [id, c] of base.eraToForever) era[String(id)] = c;
    const file = { _generated: { by: 'test' }, schema: 1, kind: 'placeholder', product: base.product, frameHash: 'a'.repeat(64), contentHash: 'b'.repeat(64), inputs: {}, maps, eraToForever: era };
    const parsed = parseGeometryFile(JSON.parse(JSON.stringify(file)) as unknown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(canonicalGeometryContent(parsed.geometry)).toBe(content);
    // Provenance keys the parser ignores are not content.
    const reprovenanced = parseGeometryFile(JSON.parse(JSON.stringify({ ...file, _generated: { by: 'other' }, inputs: { x: 1 } })) as unknown);
    expect(reprovenanced.ok && canonicalGeometryContent(reprovenanced.geometry)).toBe(content);
  });

  it('a merged geometry records no content hash: its content is not the committed file’s', () => {
    const committed: MapGeometry = { ...base, recordedContentHash: 'c'.repeat(64) };
    const local = createMapGeometry({
      kind: 'local',
      product: 'wow_classic_beta',
      recordedFrameHash: null,
      maps: FIXTURE_MAPS.map((map) => ({ ...map, nameSource: 'local-db2', assignments: map.assignments.map((row) => ({ ...row, source: 'local-db2' as const })) })),
      eraToForever: [],
    });
    const merged = mergeLocalGeometry(committed, local);
    expect(merged.kind === 'merged' && merged.geometry.recordedContentHash).toBeNull();
  });
});
