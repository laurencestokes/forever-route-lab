import { describe, expect, it } from 'vitest';
import { areaId, uiMapId } from '../domain/ids';
import { canonicalFrameString, canonicalFrameTuples, frameSetOf, frameTuple, mergeLocalGeometry } from './frame';
import { createMapGeometry } from './geometry';
import {
  DUROTAR,
  ERA_TO_FOREVER,
  fixtureGeometry,
  FIXTURE_MAPS,
  KALIMDOR,
  MULGORE,
  MULGORE_ERA,
  questiedbFrame,
  STORMWIND,
  STORMWIND_ERA,
} from './test-fixtures';
import type { MapGeometry, UiMapGeometry } from './types';

const committed = fixtureGeometry();

/** The same UiMaps as a developer's local extraction: other assignment IDs, source and build. */
const asLocal = (map: UiMapGeometry): UiMapGeometry => ({
  ...map,
  nameSource: 'local-db2',
  assignments: map.assignments.map((row) => ({ ...row, id: row.id + 100000, source: 'local-db2', build: '1.60.1.70123' })),
});

const localGeometry = (maps: readonly UiMapGeometry[]): MapGeometry =>
  createMapGeometry({ kind: 'local', product: 'wow_classic_beta', recordedFrameHash: null, maps, eraToForever: [] });

const NEW_MAP: UiMapGeometry = asLocal({
  ...questiedbFrame(2999, 'Synthetic Test Isle', { id: 90001, mapId: 2991, areaId: 1, xMin: 0, xMax: 1000, yMin: 0, yMax: 1500 }),
  type: 3,
  parent: uiMapId(947),
});

describe('canonical frame tuples (MAPS.md §5.6)', () => {
  it('encodes [uiMapId, mapId, xMin, xMax, yMin, yMax, uiMin, uiMax] with every coordinate as float32', () => {
    const [row] = DUROTAR.assignments;
    if (row === undefined) throw new Error('fixture');
    expect(frameTuple(DUROTAR.uiMapId, row)).toEqual([1411, 1, -1716.6666259765625, 1808.333251953125, -7249.99951171875, -1962.4998779296875, 0, 0, 1, 1]);
    const one = canonicalFrameTuples(fixtureGeometry([DUROTAR], []));
    expect(one).toEqual({
      ok: true,
      tuples: [[1411, 1, -1716.6666259765625, 1808.333251953125, -7249.99951171875, -1962.4998779296875, 0, 0, 1, 1]],
      canonical: '[[1411,1,-1716.6666259765625,1808.333251953125,-7249.99951171875,-1962.4998779296875,0,0,1,1]]',
    });
  });

  it('agrees across exporters that print different decimals for the same float32', () => {
    const wago = fixtureGeometry([DUROTAR], []);
    const [row] = DUROTAR.assignments;
    if (row === undefined) throw new Error('fixture');
    const otherExporter = fixtureGeometry([{ ...DUROTAR, assignments: [{ ...row, xMin: -1716.66662597656, yMax: -1962.49987792969 }] }], []);
    const a = canonicalFrameTuples(wago);
    const b = canonicalFrameTuples(otherExporter);
    expect(a.ok && b.ok && a.canonical === b.canonical).toBe(true);
  });

  it('uses the questiedb-conversion UiMaps as the frame set, in ascending order', () => {
    expect(frameSetOf(committed)).toEqual([1411, 1412, 1413, 1453, 1454, 1456]);
    const result = canonicalFrameTuples(committed);
    expect(result.ok && result.tuples.map((tuple) => tuple[0])).toEqual([1411, 1412, 1413, 1453, 1454, 1456]);
    expect(result.ok && result.canonical).toBe(result.ok && canonicalFrameString(result.tuples));
  });

  it('is incompatible when a frame-set UiMap is missing or lacks exactly one OrderIndex 0 row', () => {
    expect(canonicalFrameTuples(fixtureGeometry([DUROTAR], []), [uiMapId(1411), uiMapId(1412)])).toEqual({ ok: false, incompatible: [1412] });
    const [row] = DUROTAR.assignments;
    if (row === undefined) throw new Error('fixture');
    const noPrimary = fixtureGeometry([{ ...DUROTAR, assignments: [{ ...row, orderIndex: 1 }] }], []);
    expect(canonicalFrameTuples(noPrimary, [uiMapId(1411)])).toEqual({ ok: false, incompatible: [1411] });
  });

  it('differs between the Era and Forever frames exactly at the changed UiMaps', () => {
    const forever = fixtureGeometry([DUROTAR, MULGORE, STORMWIND], []);
    const era = fixtureGeometry([DUROTAR, MULGORE_ERA, STORMWIND_ERA], []);
    const a = canonicalFrameTuples(forever);
    const b = canonicalFrameTuples(era);
    if (!a.ok || !b.ok) throw new Error('fixture');
    expect(a.canonical).not.toBe(b.canonical);
    const differing = a.tuples.filter((tuple, i) => JSON.stringify(tuple) !== JSON.stringify(b.tuples[i])).map((tuple) => tuple[0]);
    expect(differing).toEqual([1412, 1453]);
  });
});

describe('mergeLocalGeometry (ARCHITECTURE §6; MAPS.md §5.6 step 4)', () => {
  it('adds UiMaps the committed geometry lacks and keeps every committed UiMap as committed', () => {
    const result = mergeLocalGeometry(committed, localGeometry([...FIXTURE_MAPS.map(asLocal), NEW_MAP]));
    expect(result.kind).toBe('merged');
    if (result.kind !== 'merged') return;
    expect(result.added).toEqual([2999]);
    expect([...result.geometry.maps.keys()]).toEqual([...committed.maps.keys(), 2999].sort((a, b) => a - b));
    expect(result.geometry.maps.get(uiMapId(1411))).toStrictEqual(committed.maps.get(uiMapId(1411)));
    expect(result.geometry.maps.get(uiMapId(2999))?.assignments[0]?.source).toBe('local-db2');
    expect(result.geometry.kind).toBe('merged');
    expect([...result.geometry.eraToForever]).toEqual(ERA_TO_FOREVER);
  });

  it('accepts a local set that only adds, without repeating non-frame UiMaps', () => {
    const frameOnly = FIXTURE_MAPS.filter((map) => map.assignments.every((row) => row.source === 'questiedb-conversion')).map(asLocal);
    const result = mergeLocalGeometry(committed, localGeometry([...frameOnly, NEW_MAP]));
    expect(result).toMatchObject({ kind: 'merged', added: [2999] });
  });

  it('rejects the whole set when a committed db2-csv UiMap differs in one value', () => {
    const [row] = KALIMDOR.assignments;
    if (row === undefined) throw new Error('fixture');
    const changed = asLocal({ ...KALIMDOR, assignments: [{ ...row, xMax: row.xMax + 0.5 }] });
    const maps = FIXTURE_MAPS.map((map) => (map.uiMapId === KALIMDOR.uiMapId ? changed : asLocal(map)));
    expect(mergeLocalGeometry(committed, localGeometry([...maps, NEW_MAP]))).toEqual({
      kind: 'mismatch',
      frameUiMapIds: [],
      sharedRowUiMapIds: [1414],
    });
  });

  it('also compares OrderIndex and AreaID of shared rows, which resolution and zone attribution use', () => {
    const [row] = KALIMDOR.assignments;
    if (row === undefined) throw new Error('fixture');
    const changed = asLocal({ ...KALIMDOR, assignments: [{ ...row, areaId: areaId(5) }] });
    const maps = FIXTURE_MAPS.map((map) => (map.uiMapId === KALIMDOR.uiMapId ? changed : asLocal(map)));
    expect(mergeLocalGeometry(committed, localGeometry(maps))).toMatchObject({ kind: 'mismatch', sharedRowUiMapIds: [1414] });
  });

  it('ignores decimal spelling that rounds to the same float32, and assignment IDs, source and build', () => {
    const [row] = KALIMDOR.assignments;
    if (row === undefined) throw new Error('fixture');
    const respelled = asLocal({ ...KALIMDOR, assignments: [{ ...row, xMax: 12799.9003906 }] });
    const maps = FIXTURE_MAPS.map((map) => (map.uiMapId === KALIMDOR.uiMapId ? respelled : asLocal(map)));
    expect(mergeLocalGeometry(committed, localGeometry(maps))).toMatchObject({ kind: 'merged', added: [] });
  });

  it('rejects a set whose frame differs (another build moved a zone) or that lacks a frame UiMap', () => {
    const moved = FIXTURE_MAPS.map((map) => (map.uiMapId === MULGORE.uiMapId ? asLocal(MULGORE_ERA) : asLocal(map)));
    expect(mergeLocalGeometry(committed, localGeometry(moved))).toEqual({ kind: 'mismatch', frameUiMapIds: [1412], sharedRowUiMapIds: [] });
    const missing = FIXTURE_MAPS.filter((map) => map.uiMapId !== STORMWIND.uiMapId).map(asLocal);
    expect(mergeLocalGeometry(committed, localGeometry(missing))).toMatchObject({ kind: 'mismatch', frameUiMapIds: [1453] });
  });

  it('rejects extra rows for a committed UiMap even when its frame row matches', () => {
    const [row] = DUROTAR.assignments;
    if (row === undefined) throw new Error('fixture');
    const extra = asLocal({ ...DUROTAR, assignments: [row, { ...row, id: 1, orderIndex: 1 }] });
    const maps = FIXTURE_MAPS.map((map) => (map.uiMapId === DUROTAR.uiMapId ? extra : asLocal(map)));
    expect(mergeLocalGeometry(committed, localGeometry(maps))).toEqual({ kind: 'mismatch', frameUiMapIds: [], sharedRowUiMapIds: [1411] });
  });
});
