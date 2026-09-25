import { uiMapId } from '../../../src/domain/ids';
import { canonicalGeometryContent } from '../../../src/geo/content';
import { canonicalFrameTuples } from '../../../src/geo/frame';
import { allAssignments, parseGeometryFile } from '../../../src/geo/geometry';
import type { GeometryAssignment, MapGeometry } from '../../../src/geo/types';
import {
  ART_ASPECT_EXCEPTIONS,
  ASPECT_TOLERANCE,
  DB2_BUILD,
  DB2_ONLY_ASSIGNMENT_IDS,
  DB2_ONLY_UIMAP_IDS,
  DEFAULT_ART_ASPECT,
  ERA_CHANGED_UIMAP_IDS,
  EXPECTED_FRAME_UIMAPS,
  EXPECTED_ROWS,
  EXPECTED_UIMAPS,
  REFERENCE_FRAME_COMMIT,
  REFERENCE_FRAME_HASH,
} from './constants';
import { isIdentity } from './conversion';
import { compareWithReference, geometryMapsFromRows } from './db2-rows';
import { sha256Hex } from './hash';
import type { PlaceholderBuild } from './placeholder';

/**
 * The placeholder checks of docs/MAPS.md §5.5 (P1-P5, P7 isotropy, P8 content hash and R1 byte
 * reproducibility; P6, the git tracking check, is in validate.ts). Each check compares the
 * committed file with the inputs directly, not only with the importer's output, so an importer
 * bug cannot hide itself.
 */

export interface CheckResult {
  readonly id: string;
  readonly title: string;
  readonly problems: readonly string[];
  /** Set when the check could not run; a skipped check is not a pass. */
  readonly skipped: string | null;
}

export const passed = (result: CheckResult): boolean => result.skipped === null && result.problems.length === 0;

const check = (id: string, title: string, problems: readonly string[]): CheckResult => ({ id, title, problems, skipped: null });

const sameIds = (a: readonly number[], b: readonly number[]): boolean => {
  const x = [...a].sort((m, n) => m - n);
  const y = [...b].sort((m, n) => m - n);
  return x.length === y.length && x.every((n, i) => n === y[i]);
};

const rowText = (row: GeometryAssignment): string => JSON.stringify(row);

/** Expected aspect `(Ymax − Ymin)/(Xmax − Xmin)` of a row, scaled by its UI rectangle; null when not isotropic by design. */
export function expectedAspect(id: number): number | null {
  const exception = ART_ASPECT_EXCEPTIONS[id];
  return exception === undefined ? DEFAULT_ART_ASPECT : exception;
}

/** Relative isotropy error of one row against the art aspect (coordinates.md §4.1). */
export function aspectError(row: GeometryAssignment, expected: number): number {
  const width = (row.yMax - row.yMin) / (row.uiMax[0] - row.uiMin[0]);
  const height = (row.xMax - row.xMin) / (row.uiMax[1] - row.uiMin[1]);
  return Math.abs(width / height / expected - 1);
}

/** Isotropy problems of every row of `geometry` (P7 for the placeholder, L2 for a local set). */
export function isotropyProblems(geometry: MapGeometry): readonly string[] {
  const problems: string[] = [];
  for (const { uiMapId: id, row } of allAssignments(geometry)) {
    const expected = expectedAspect(id);
    if (expected === null) continue;
    const error = aspectError(row, expected);
    if (error > ASPECT_TOLERANCE) problems.push(`UiMap ${String(id)} row ${String(row.id)}: aspect off by ${(100 * error).toFixed(3)}% (tolerance ${String(100 * ASPECT_TOLERANCE)}%)`);
  }
  return problems;
}

export interface PlaceholderCheckInputs {
  /** The committed geometry file as LF text. */
  readonly geometryText: string;
  /** The committed NOTICE.md as LF text, or null when missing. */
  readonly noticeText: string | null;
  /** The placeholder rebuilt from the pinned inputs. */
  readonly expected: PlaceholderBuild;
}

export function placeholderChecks({ geometryText, noticeText, expected }: PlaceholderCheckInputs): readonly CheckResult[] {
  const results: CheckResult[] = [];
  results.push(
    check('R1', 'regenerating from the pinned inputs reproduces both files byte for byte', [
      ...(geometryText === expected.geometryText ? [] : ['geometry.placeholder.json differs from a fresh import (run pnpm maps:placeholder)']),
      ...(noticeText === expected.noticeText ? [] : [noticeText === null ? 'NOTICE.md is missing' : 'NOTICE.md differs from a fresh import']),
    ]),
  );

  let raw: unknown;
  try {
    raw = JSON.parse(geometryText) as unknown;
  } catch (error) {
    results.push(check('P0', 'the committed file parses', [error instanceof Error ? error.message : String(error)]));
    return results;
  }
  const parsed = parseGeometryFile(raw);
  if (!parsed.ok) {
    results.push(check('P0', 'the committed file parses', parsed.errors));
    return results;
  }
  const geometry = parsed.geometry;
  const rows = allAssignments(geometry);
  const { conversion, rowsFile } = expected;

  // P1: the questiedb-conversion rows equal conversion.json, value for value
  {
    const problems: string[] = [];
    const conversionMaps = [...geometry.maps.values()].filter((m) => m.assignments.some((r) => r.source === 'questiedb-conversion'));
    if (conversionMaps.length !== EXPECTED_FRAME_UIMAPS) problems.push(`${String(conversionMaps.length)} UiMaps with questiedb-conversion rows, expected ${String(EXPECTED_FRAME_UIMAPS)}`);
    if (!sameIds(conversionMaps.map((m) => m.uiMapId), conversion.transforms.map((t) => t.uiMapId))) problems.push('the questiedb-conversion UiMaps are not the conversion.json transforms');
    for (const t of conversion.transforms) {
      const map = geometry.maps.get(uiMapId(t.uiMapId));
      const row = map?.assignments[0];
      if (map === undefined || row === undefined || map.assignments.length !== 1) {
        problems.push(`UiMap ${String(t.uiMapId)}: expected exactly one row`);
        continue;
      }
      const want: GeometryAssignment = {
        id: t.targetAssignmentId,
        mapId: row.mapId,
        areaId: row.areaId,
        orderIndex: 0,
        xMin: t.targetBounds.bottom,
        xMax: t.targetBounds.top,
        yMin: t.targetBounds.right,
        yMax: t.targetBounds.left,
        uiMin: [0, 0],
        uiMax: [1, 1],
        source: 'questiedb-conversion',
        build: conversion.targetBuild,
      };
      if (rowText(row) !== rowText(want) || row.mapId !== t.mapId || row.areaId !== t.areaId) problems.push(`UiMap ${String(t.uiMapId)}: row differs from target_bounds/ids`);
      if (map.name !== t.targetName || map.nameSource !== 'questiedb-conversion' || map.type !== null || map.parent !== null) {
        problems.push(`UiMap ${String(t.uiMapId)}: name, type or parent differ (expected ${t.targetName}, null, null)`);
      }
    }
    results.push(check('P1', `${String(EXPECTED_FRAME_UIMAPS)} questiedb-conversion frames equal conversion.json target_bounds (LF blob ${expected.conversionSha256.slice(0, 12)}…)`, problems));
  }

  // P2: the db2-csv rows equal the committed rows file
  {
    const problems: string[] = [];
    const db2Rows = rows.filter(({ row }) => row.source === 'db2-csv');
    if (!sameIds(db2Rows.map(({ row }) => row.id), DB2_ONLY_ASSIGNMENT_IDS)) problems.push(`db2-csv assignment IDs are ${db2Rows.map(({ row }) => row.id).join(', ')}`);
    const db2Maps = [...geometry.maps.values()].filter((m) => m.assignments.some((r) => r.source === 'db2-csv'));
    if (!sameIds(db2Maps.map((m) => m.uiMapId), DB2_ONLY_UIMAP_IDS)) problems.push('the db2-csv UiMaps are not the 11 of D-018');
    for (const want of geometryMapsFromRows(rowsFile)) {
      const got = geometry.maps.get(want.uiMapId);
      if (got === undefined) {
        problems.push(`UiMap ${String(want.uiMapId)} missing`);
        continue;
      }
      if (got.name !== want.name || got.type !== want.type || got.parent !== want.parent || got.nameSource !== 'db2-csv') problems.push(`UiMap ${String(want.uiMapId)}: name, type or parent differ from the rows file`);
      const wantRows = [...want.assignments].sort((a, b) => a.orderIndex - b.orderIndex).map(rowText);
      if (JSON.stringify(got.assignments.map(rowText)) !== JSON.stringify(wantRows)) problems.push(`UiMap ${String(want.uiMapId)}: rows differ from the rows file`);
    }
    problems.push(...compareWithReference(rowsFile));
    const inputs = (raw as { inputs?: { 'db2-csv'?: { sha256?: unknown; csvSha256?: { UiMapAssignment?: unknown; UiMap?: unknown } } } }).inputs?.['db2-csv'];
    if (inputs === undefined) problems.push('inputs.db2-csv is missing');
    else {
      if (inputs.sha256 !== expected.rowsSha256) problems.push(`inputs.db2-csv.sha256 is not the rows file's LF SHA-256 ${expected.rowsSha256}`);
      const csv = inputs.csvSha256;
      if (csv?.UiMapAssignment !== rowsFile.sources.UiMapAssignment.sha256 || csv.UiMap !== rowsFile.sources.UiMap.sha256) {
        problems.push('inputs.db2-csv.csvSha256 differs from the rows file sources');
      }
    }
    results.push(check('P2', '12 db2-csv rows for 11 UiMaps equal the committed rows file and the MAPS.md §8.3 reference table', problems));
  }

  // P3: sources, builds and totals
  {
    const problems: string[] = [];
    if (geometry.maps.size !== EXPECTED_UIMAPS) problems.push(`${String(geometry.maps.size)} UiMaps, expected ${String(EXPECTED_UIMAPS)}`);
    if (rows.length !== EXPECTED_ROWS) problems.push(`${String(rows.length)} rows, expected ${String(EXPECTED_ROWS)}`);
    for (const { uiMapId: id, row } of rows) {
      const build = row.source === 'questiedb-conversion' ? conversion.targetBuild : DB2_BUILD;
      if (row.build !== build) problems.push(`UiMap ${String(id)} row ${String(row.id)}: build ${row.build}, expected ${build} for ${row.source}`);
    }
    results.push(check('P3', `every row records source and build; ${String(EXPECTED_UIMAPS)} UiMaps, ${String(EXPECTED_ROWS)} rows, nothing else`, problems));
  }

  // P4: frame hash
  {
    const problems: string[] = [];
    const frame = canonicalFrameTuples(geometry, conversion.transforms.map((t) => uiMapId(t.uiMapId)));
    const hash = frame.ok ? sha256Hex(frame.canonical) : null;
    if (hash === null) problems.push('frame set incompatible');
    else if (hash !== geometry.recordedFrameHash) problems.push(`recorded frameHash ${String(geometry.recordedFrameHash)} differs from recomputed ${hash}`);
    if (hash !== null && hash !== REFERENCE_FRAME_HASH && isReferenceCommit(raw)) problems.push(`frame hash ${hash} differs from the MAPS.md §5.6 reference ${REFERENCE_FRAME_HASH}`);
    results.push(check('P4', 'frameHash equals the value recomputed from the 49 frames (and the MAPS.md §5.6 reference at its commit)', problems));
  }

  // P5: eraToForever
  {
    const problems: string[] = [];
    const keys = [...geometry.eraToForever.keys()];
    if (!sameIds(keys, ERA_CHANGED_UIMAP_IDS)) problems.push(`eraToForever has ${keys.join(', ')}, expected ${ERA_CHANGED_UIMAP_IDS.join(', ')}`);
    for (const t of conversion.transforms) {
      const got = geometry.eraToForever.get(uiMapId(t.uiMapId));
      if (got === undefined) {
        if (!isIdentity(t.coefficients)) problems.push(`UiMap ${String(t.uiMapId)}: non-identity conversion.json coefficients missing from eraToForever`);
        continue;
      }
      const c = t.coefficients;
      if (got.scaleX !== c.scaleX || got.offsetX !== c.offsetX || got.scaleY !== c.scaleY || got.offsetY !== c.offsetY) problems.push(`UiMap ${String(t.uiMapId)}: coefficients differ from conversion.json`);
      if (got.fromBuild !== conversion.sourceBuild || got.toBuild !== conversion.targetBuild) problems.push(`UiMap ${String(t.uiMapId)}: builds differ from conversion.json`);
    }
    results.push(check('P5', 'eraToForever is exactly 1412, 1423, 1433, 1453 with the conversion.json coefficients; the other 45 are identity', problems));
  }

  results.push(check('P7', 'isotropy: (Ymax − Ymin)/(Xmax − Xmin) matches the art aspect within 0.2% (1.5; 1.0 for 1463/1464; 2665 exempt)', isotropyProblems(geometry)));

  // P8: content hash, recomputed from the committed file exactly as infra/maps does at load
  {
    const content = sha256Hex(canonicalGeometryContent(geometry));
    const problems: string[] = [];
    if (content !== geometry.recordedContentHash) problems.push(`recorded contentHash ${String(geometry.recordedContentHash)} differs from recomputed ${content}`);
    if (content !== expected.contentHash) problems.push(`content hash ${content} differs from a fresh import's ${expected.contentHash}`);
    results.push(check('P8', 'contentHash equals the SHA-256 of canonicalGeometryContent (every row, name, parent and coefficient; MAPS.md §5.3)', problems));
  }
  return results;
}

/** True when the file says it was built from the commit the MAPS.md §5.6 reference hash was taken at. */
function isReferenceCommit(raw: unknown): boolean {
  const commit = (raw as { inputs?: { 'questiedb-conversion'?: { commit?: unknown } } }).inputs?.['questiedb-conversion']?.commit;
  return commit === REFERENCE_FRAME_COMMIT;
}
