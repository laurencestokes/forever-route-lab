import { describe, expect, it } from 'vitest';
import { uiMapId } from '../domain/ids';
import { allAssignments, createMapGeometry, parseGeometryFile } from './geometry';
import { AZEROTH, DUROTAR, fixtureGeometry, KALIMDOR } from './test-fixtures';

/** A minimal placeholder file in the committed format (docs/MAPS.md §5.3). */
const placeholderJson = (): Record<string, unknown> => ({
  _generated: { by: 'test' },
  schema: 1,
  kind: 'placeholder',
  product: 'wow_classic_beta',
  frameHash: '2cb10551b1502b652e4d54922e8b3a1ecb48057fbfb7cf9c77863edd7efea78f',
  contentHash: 'c'.repeat(64),
  inputs: { anything: 'provenance, ignored by the parser' },
  maps: {
    '1414': {
      name: 'Kalimdor',
      nameSource: 'db2-csv',
      type: 2,
      parent: 947,
      assignments: [
        {
          id: 46724, mapId: 1, areaId: 0, orderIndex: 0, xMin: -11733.299804688, xMax: 12799.900390625, yMin: -19733.2109375,
          yMax: 17066.599609375, uiMin: [0, 0], uiMax: [1, 1], source: 'db2-csv', build: '1.60.1.70009',
        },
      ],
    },
    '1411': {
      name: 'Durotar',
      nameSource: 'questiedb-conversion',
      type: null,
      parent: null,
      assignments: [
        {
          id: 46721, mapId: 1, areaId: 14, orderIndex: 0, xMin: -1716.6666259766, xMax: 1808.3332519531, yMin: -7249.9995117188,
          yMax: -1962.4998779297, uiMin: [0, 0], uiMax: [1, 1], source: 'questiedb-conversion', build: '1.60.1.69893',
        },
      ],
    },
  },
  eraToForever: {
    '1412': {
      scaleX: 0.8348002068275978, offsetX: 7.007453108736848, scaleY: 0.8349418225477033, offsetY: 13.15387327724201,
      fromBuild: '1.15.9.69722', toBuild: '1.60.1.69893', source: 'questiedb-conversion',
    },
  },
});

type Mutable = Record<string, unknown>;
const at = (value: unknown, ...path: (string | number)[]): Mutable => {
  let node = value;
  for (const key of path) node = (node as Mutable)[key];
  return node as Mutable;
};
const errorsOf = (value: unknown): readonly string[] => {
  const result = parseGeometryFile(value);
  return result.ok ? [] : result.errors;
};

describe('createMapGeometry', () => {
  it('orders maps by UiMapId and rows by OrderIndex regardless of input order', () => {
    const [first, second] = AZEROTH.assignments;
    if (first === undefined || second === undefined) throw new Error('fixture');
    const geometry = fixtureGeometry([KALIMDOR, { ...AZEROTH, assignments: [second, first] }, DUROTAR], []);
    expect([...geometry.maps.keys()]).toEqual([947, 1411, 1414]);
    expect(geometry.maps.get(uiMapId(947))?.assignments.map((row) => row.orderIndex)).toEqual([0, 1]);
    expect(allAssignments(geometry).map(({ uiMapId: id, row }) => `${String(id)}:${String(row.id)}`)).toEqual([
      '947:46785',
      '947:46784',
      '1411:46721',
      '1414:46724',
    ]);
  });

  it('refuses duplicates, empty maps and degenerate rectangles', () => {
    const [row] = DUROTAR.assignments;
    if (row === undefined) throw new Error('fixture');
    const make = (maps: Parameters<typeof fixtureGeometry>[0]) => () => fixtureGeometry(maps, []);
    expect(make([DUROTAR, DUROTAR])).toThrow(/appears twice/);
    expect(make([{ ...DUROTAR, assignments: [] }])).toThrow(/no assignment rows/);
    expect(make([{ ...DUROTAR, assignments: [{ ...row, xMax: row.xMin }] }])).toThrow(/degenerate or reversed world bounds/);
    expect(make([{ ...DUROTAR, assignments: [{ ...row, uiMax: [0, 1] }] }])).toThrow(/UI rectangle/);
    expect(make([{ ...DUROTAR, assignments: [row, { ...row, id: 2 }] }])).toThrow(/OrderIndex 0 appears twice/);
    expect(() =>
      createMapGeometry({
        kind: 'placeholder',
        product: 'x',
        recordedFrameHash: null,
        maps: [DUROTAR],
        eraToForever: [[uiMapId(1412), { scaleX: 0, offsetX: 0, scaleY: 1, offsetY: 0, fromBuild: '1.1.1.1', toBuild: '1.1.1.2', source: 'questiedb-conversion' }]],
      }),
    ).toThrow(/non-zero scales/);
  });
});

describe('parseGeometryFile', () => {
  it('parses the committed placeholder format, ignoring provenance keys', () => {
    const result = parseGeometryFile(placeholderJson());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { geometry } = result;
    expect(geometry.kind).toBe('placeholder');
    expect(geometry.product).toBe('wow_classic_beta');
    expect(geometry.recordedFrameHash).toBe('2cb10551b1502b652e4d54922e8b3a1ecb48057fbfb7cf9c77863edd7efea78f');
    expect(geometry.recordedContentHash).toBe('c'.repeat(64));
    expect([...geometry.maps.keys()]).toEqual([1411, 1414]);
    expect(geometry.maps.get(uiMapId(1414))).toEqual({ ...KALIMDOR });
    expect(geometry.maps.get(uiMapId(1411))).toEqual(DUROTAR);
    expect([...geometry.eraToForever.keys()]).toEqual([1412]);
  });

  it('parses a local set, which must be marked local-only and have local-db2 rows', () => {
    const local = placeholderJson();
    local['kind'] = 'local';
    local['redistribution'] = 'local-only';
    delete local['frameHash'];
    delete local['contentHash'];
    for (const key of ['1411', '1414']) {
      at(local, 'maps', key)['nameSource'] = 'local-db2';
      at(local, 'maps', key, 'assignments', 0)['source'] = 'local-db2';
    }
    const result = parseGeometryFile(local);
    expect(result.ok && result.geometry.recordedFrameHash).toBeNull();
    expect(result.ok && result.geometry.recordedContentHash).toBeNull();
    // A local set may record either hash (informational); consumers recompute both.
    const withHashes = parseGeometryFile({ ...local, frameHash: 'a'.repeat(64), contentHash: 'b'.repeat(64) });
    expect(withHashes.ok && [withHashes.geometry.recordedFrameHash, withHashes.geometry.recordedContentHash]).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
    local['redistribution'] = 'public';
    expect(errorsOf(local)).toEqual(['redistribution: a local geometry must be "local-only"']);
  });

  it('rejects row sources that do not belong to the file kind', () => {
    const file = placeholderJson();
    at(file, 'maps', '1411', 'assignments', 0)['source'] = 'local-db2';
    expect(errorsOf(file)).toEqual(['maps.1411.assignments[0].source: must be one of questiedb-conversion, db2-csv']);
    const marked = placeholderJson();
    marked['redistribution'] = 'local-only';
    expect(errorsOf(marked)).toEqual(['redistribution: the committed placeholder carries no redistribution marker']);
  });

  it('reports every problem with its path and builds nothing', () => {
    const file = placeholderJson();
    const row = at(file, 'maps', '1411', 'assignments', 0);
    row['xMin'] = 'x';
    row['build'] = '69893';
    row['extra'] = 1;
    delete row['uiMax'];
    at(file, 'maps')['01415'] = at(file, 'maps', '1414');
    at(file, 'eraToForever', '1412')['source'] = 'db2-csv';
    file['frameHash'] = 'ABC';
    file['contentHash'] = 42;
    expect(errorsOf(file)).toEqual([
      'frameHash: must be a lowercase hex SHA-256 or null',
      'contentHash: must be a lowercase hex SHA-256 or null',
      'maps.1411.assignments[0].extra: unknown key',
      'maps.1411.assignments[0].uiMax: missing',
      'maps.1411.assignments[0].xMin: must be a finite number',
      'maps.1411.assignments[0].uiMax: must be a [u, v] pair',
      'maps.1411.assignments[0].build: must be a build such as 1.60.1.69893',
      'maps.01415: UiMap keys must be positive integers without leading zeros',
      'eraToForever.1412.source: must be questiedb-conversion',
    ]);
  });

  it('rejects the wrong schema, kind or root, and UI coordinates outside 0..1', () => {
    expect(errorsOf([])).toEqual(['(root): must be an object']);
    expect(errorsOf({ ...placeholderJson(), kind: 'art' })).toEqual(['kind: must be "placeholder" or "local"']);
    expect(errorsOf({ ...placeholderJson(), schema: 2 })).toEqual(['schema: must be 1']);
    const file = placeholderJson();
    at(file, 'maps', '1414', 'assignments', 0)['uiMax'] = [1.5, 1];
    expect(errorsOf(file)).toEqual(['maps.1414.assignments[0].uiMax: UI coordinates must lie in 0..1']);
    const noHash = placeholderJson();
    delete noHash['frameHash'];
    expect(errorsOf(noHash)).toEqual(['frameHash: the placeholder must record its frame hash']);
    const noContentHash = placeholderJson();
    noContentHash['contentHash'] = null;
    expect(errorsOf(noContentHash)).toEqual(['contentHash: the placeholder must record its content hash']);
  });

  it('reports structural problems (duplicate OrderIndex) found after the shape checks', () => {
    const file = placeholderJson();
    const rows = at(file, 'maps', '1411')['assignments'] as unknown[];
    rows.push({ ...(rows[0] as Mutable), id: 5 });
    expect(errorsOf(file)).toEqual(['UiMap 1411 row 5: OrderIndex 0 appears twice']);
  });
});
