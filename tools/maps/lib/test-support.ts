/**
 * Test support for tools/maps (not used by the tools themselves): synthetic `conversion.json`
 * fixtures, a conversion.json reconstructed from the committed placeholder (so the checks can be
 * exercised on the full 49 frames without a QuestieDB checkout), and small file helpers.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { REPO_ROOT } from '../../build/lib/fs';
import { CONVERSION_PATH, GEOMETRY_FILE, PLACEHOLDER_DIR, RESEARCH_CSVS, ROWS_FILE, type ResearchCsv } from './constants';
import { ASSIGNMENT_COLUMNS, buildDb2RowsFile, rowsFileJson } from './db2-rows';
import { resolveCommit } from './git';
import { sha256Hex } from './hash';
import { formatJson } from './json';
import { resolvePin } from './pin';
import type { PlaceholderInputs } from './placeholder';

/**
 * Test oracle only: the pin as DATA_PROVENANCE §2 and §4.1 record it (commit, repository and the
 * LF-blob SHA-256 of conversion.json). The tools read the pin from tools/questiedb/upstream.json
 * (lib/pin.ts); tests check that the two agree and use these values for synthetic inputs.
 */
export const RECORDED_PIN = {
  commit: 'b6f5b07b0acf1c820993cbb0ce2521c912bb4c92',
  repository: 'https://github.com/Questie/QuestieDB',
  cachePath: '.cache/questiedb',
  conversionSha256: 'f4477d6c575575152225f2a9d40858029bf9d2d5fdf6b083c06557fce8b5984b',
  licenceCheckDate: '2026-09-25',
} as const;

export interface TransformSpec {
  readonly id: number;
  readonly name: string;
  readonly mapId: number;
  readonly areaId: number;
  readonly assignmentId: number;
  /** World bounds: xMin (bottom), xMax (top), yMin (right), yMax (left). */
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  readonly coefficients?: { readonly scaleX: number; readonly offsetX: number; readonly scaleY: number; readonly offsetY: number };
}

/** A conversion.json-shaped object with the given transforms (conversion.json field names). */
export function syntheticConversion(specs: readonly TransformSpec[]): Record<string, unknown> {
  return {
    tool: 'synthetic test fixture',
    format: 1,
    geometry: {
      transforms: specs.map((t) => {
        const c = t.coefficients ?? { scaleX: 1, offsetX: 0, scaleY: 1, offsetY: 0 };
        const bounds = { left: t.yMax, right: t.yMin, top: t.xMax, bottom: t.xMin };
        return {
          ui_map_id: t.id,
          source_name: t.name,
          target_name: t.name,
          area_id: t.areaId,
          map_id: t.mapId,
          source_assignment_id: t.assignmentId,
          target_assignment_id: t.assignmentId,
          changed: t.coefficients !== undefined,
          coefficients: { scale_x: c.scaleX, offset_x: c.offsetX, scale_y: c.scaleY, offset_y: c.offsetY },
          source_bounds: bounds,
          target_bounds: bounds,
        };
      }),
      unsupported: [],
      added_maps: [],
      removed_maps: [],
      source_build: '1.15.9.69722',
      target_build: '1.60.1.69893',
    },
  };
}

type Json = Record<string, unknown>;

export const readRepoText = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');
export const committedGeometryJson = (): Json => JSON.parse(readRepoText(`${PLACEHOLDER_DIR}/${GEOMETRY_FILE}`)) as Json;
export const committedRowsBytes = (): Buffer => readFileSync(join(REPO_ROOT, ROWS_FILE));

/** Rebuilds conversion.json's geometry block from the committed placeholder's questiedb-conversion rows. */
export function conversionFromCommitted(geometry: Json = committedGeometryJson()): Record<string, unknown> {
  const maps = geometry['maps'] as Record<string, Json>;
  const era = geometry['eraToForever'] as Record<string, { scaleX: number; offsetX: number; scaleY: number; offsetY: number }>;
  const specs: TransformSpec[] = [];
  for (const [key, map] of Object.entries(maps)) {
    const [row] = map['assignments'] as Json[];
    if (row === undefined || row['source'] !== 'questiedb-conversion') continue;
    const coefficients = era[key];
    specs.push({
      id: Number(key),
      name: String(map['name']),
      mapId: Number(row['mapId']),
      areaId: Number(row['areaId']),
      assignmentId: Number(row['id']),
      xMin: Number(row['xMin']),
      xMax: Number(row['xMax']),
      yMin: Number(row['yMin']),
      yMax: Number(row['yMax']),
      ...(coefficients === undefined ? {} : { coefficients }),
    });
  }
  return syntheticConversion(specs);
}

/** Placeholder inputs from a conversion object (hashed as written) and rows bytes, at the recorded pin's commit. */
export function inputsFrom(conversion: unknown, rowsBytes: Uint8Array = committedRowsBytes()): PlaceholderInputs {
  const bytes = Buffer.from(JSON.stringify(conversion, null, 2));
  return {
    conversion: { bytes, repoUrl: RECORDED_PIN.repository, commit: RECORDED_PIN.commit, path: CONVERSION_PATH, expectedSha256: sha256Hex(bytes) },
    rows: { bytes: rowsBytes, path: ROWS_FILE },
    licenceCheckDate: RECORDED_PIN.licenceCheckDate,
  };
}

/**
 * A synthetic rows file with one DB2-only UiMap (Kalimdor 1414, its cited row) in the committed
 * format. `parseDb2RowsFile` accepts it: it checks the source URLs and files, not the row set.
 */
export function syntheticRowsBytes(): Buffer {
  const header = ASSIGNMENT_COLUMNS.join(',');
  const line = '0,0,1,1,-11733.299804688,-19733.2109375,-1000000,12799.900390625,17066.599609375,1000000,46724,1414,0,1,0,0,0,0';
  const assignmentCsv = `${header}\n${line}\n`;
  const uiMapCsv = 'Name_lang,ID,ParentUiMapID,Type\nKalimdor,1414,947,2\n';
  const entry = (base: ResearchCsv, text: string): ResearchCsv => ({ ...base, bytes: Buffer.byteLength(text), rows: 1, sha256: sha256Hex(text) });
  const file = buildDb2RowsFile({ UiMapAssignment: Buffer.from(assignmentCsv), UiMap: Buffer.from(uiMapCsv) }, null, {
    csvs: { UiMapAssignment: entry(RESEARCH_CSVS.UiMapAssignment, assignmentCsv), UiMap: entry(RESEARCH_CSVS.UiMap, uiMapCsv) },
    uiMapIds: [1414],
    assignmentIds: [46724],
    rawLinesSha256: sha256Hex(`${line}\n`),
    reference: [[1414, 'Kalimdor', 2, 947, 46724, 0, 1, 0, 0, 0, 1, 1, -11733.299804688, 12799.900390625, -19733.2109375, 17066.599609375]],
  });
  return Buffer.from(formatJson(rowsFileJson(file)));
}

/** True when the pin's default QuestieDB checkout has the pinned commit, so real-input tests can run. */
export function hasPinnedCheckout(): boolean {
  try {
    const pin = resolvePin(REPO_ROOT, null);
    const repo = join(REPO_ROOT, pin.cachePath);
    return existsSync(repo) && resolveCommit(repo, pin.commit) === pin.commit;
  } catch {
    return false;
  }
}

/** A fresh temporary directory and a disposer. */
export function tempDir(prefix: string): { readonly dir: string; readonly dispose: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

export function writeFile(root: string, path: string, content: string | Uint8Array): string {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
}
