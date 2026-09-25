import { areaId, uiMapId, worldMapId } from '../../../src/domain/ids';
import type { GeometryAssignment, UiMapGeometry } from '../../../src/geo/types';
import { parseCsv, recordColumns, requireColumns, type CsvTable } from './csv';
import {
  DB2_BUILD,
  DB2_ONLY_ASSIGNMENT_IDS,
  DB2_ONLY_UIMAP_IDS,
  DB2_ROWS_RAW_LINES_SHA256,
  PRODUCT,
  RESEARCH_CSVS,
  type ResearchCsv,
} from './constants';
import { sha256Hex } from './hash';

/**
 * The committed rows file `tools/maps/inputs/db2-rows-1.60.1.70009.json` (docs/MAPS.md §8.3;
 * D-018, D-022): the 12 DB2-only `UiMapAssignment` rows for 11 UiMaps and those UiMaps'
 * `Name_lang`, `Type` and `ParentUiMapID`, each cited by table, build, row ID and CSV line, with
 * every value kept as the CSV's decimal string, plus the SHA-256 of both full research CSVs.
 *
 * Written once by `lib/make-db2-rows.ts` from the research CSVs; read by `import.ts --placeholder`
 * and checked by `validate.ts` (P2). No tool ever fetches the CSVs (D-011).
 */

export const ASSIGNMENT_COLUMNS = [
  'UiMin_0', 'UiMin_1', 'UiMax_0', 'UiMax_1', 'Region_0', 'Region_1', 'Region_2', 'Region_3', 'Region_4', 'Region_5',
  'ID', 'UiMapID', 'OrderIndex', 'MapID', 'AreaID', 'WMODoodadPlacementID', 'WMOGroupID', 'Field_11_2_5_62687_010',
] as const;
export const UIMAP_COLUMNS = ['Name_lang', 'Type', 'ParentUiMapID'] as const;

type AssignmentColumn = (typeof ASSIGNMENT_COLUMNS)[number];
type UiMapColumn = (typeof UIMAP_COLUMNS)[number];

export interface Db2Source {
  readonly url: string;
  readonly fetched: string;
  readonly obtained: string;
  readonly file: string;
  readonly bytes: number;
  readonly rows: number;
  readonly sha256: string;
  readonly header: readonly string[];
}

export interface Db2AssignmentRow {
  readonly table: 'UiMapAssignment';
  readonly build: string;
  readonly id: number;
  /** 1-based line of the row in the full CSV (the header is line 1). */
  readonly csvLine: number;
  readonly columns: Readonly<Record<AssignmentColumn, string>>;
}

export interface Db2UiMapRow {
  readonly table: 'UiMap';
  readonly build: string;
  readonly id: number;
  readonly csvLine: number;
  readonly columns: Readonly<Record<UiMapColumn, string>>;
}

export interface Db2RowsFile {
  readonly schema: 1;
  readonly product: string;
  readonly build: string;
  readonly sources: { readonly UiMapAssignment: Db2Source; readonly UiMap: Db2Source };
  /** SHA-256 of the 12 rows' CSV lines, LF-joined in file order with a trailing LF (MAPS.md §8.3). */
  readonly rawLinesSha256: string;
  /** Ascending by (UiMapID, OrderIndex). */
  readonly assignments: readonly Db2AssignmentRow[];
  /** Ascending by ID. */
  readonly uiMaps: readonly Db2UiMapRow[];
}

export const ROWS_FILE_COMMENT: readonly string[] = [
  'The 12 DB2-only UiMapAssignment rows (11 UiMaps; Azeroth 947 has two) and the 11 UiMaps\' Name_lang, Type and ParentUiMapID,',
  'Blizzard client values at build 1.60.1.70009, each cited by table, build, row ID and CSV line, values kept as the CSV\'s decimal strings.',
  'Committed by owner decision (D-018; cited individual values, D-022; exception to bulk tables staying local, D-026).',
  'The CSVs were fetched on 2026-09-25 from wago.tools as individual requests during research, not by scripted crawling (D-011).',
  'Written once by tools/maps/lib/make-db2-rows.ts from those CSVs (docs/MAPS.md §8.3). Do not edit by hand.',
  'Read by tools/maps/import.ts --placeholder; checked by tools/maps/validate.ts (P2).',
];

const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** Parses a CSV decimal string strictly (no exponents, spaces or empty strings). */
export function decimal(value: string, what: string): number {
  if (!DECIMAL.test(value)) throw new Error(`${what}: "${value}" is not a decimal number`);
  return Number(value);
}

// =============================================================================================
// Building the file from the research CSVs

/**
 * MAPS.md §8.3 reference table, the independent check on the 12 rows: UiMap, name, type, parent,
 * assignment ID, OrderIndex, MapID, AreaID, UiMin (u, v), UiMax (u, v), Region_0 (xMin),
 * Region_3 (xMax), Region_1 (yMin), Region_4 (yMax). Cited client values at 1.60.1.70009 (D-022).
 */
export type ReferenceRow = readonly [number, string, number, number, number, number, number, number, number, number, number, number, number, number, number, number];

export const REFERENCE_ROWS: readonly ReferenceRow[] = [
  [947, 'Azeroth', 1, 0, 46785, 0, 1, 0, 0.03990000114, 0.08550000191, 0.40830001235, 0.92339998484, -12800, 12266.700195312, -9600, 6933.2998046875],
  [947, 'Azeroth', 1, 0, 46784, 1, 0, 0, 0.55049997568, 0.09939999878, 0.89660000801, 0.86909997463, -16000, 6933.2998046875, -7466.7001953125, 8000],
  [1414, 'Kalimdor', 2, 947, 46724, 0, 1, 0, 0, 0, 1, 1, -11733.299804688, 12799.900390625, -19733.2109375, 17066.599609375],
  [1415, 'Eastern Kingdoms', 2, 947, 46725, 0, 0, 0, 0, 0, 1, 1, -16000, 7466.6000976562, -19199.900390625, 16000],
  [1463, 'Eastern Kingdoms', 2, 0, 46774, 0, 0, 0, 0, 0, 1, 1, -15980, 5817, -11880, 9917],
  [1464, 'Kalimdor', 2, 0, 46775, 0, 1, 0, 0, 0, 1, 1, -11870, 12470, -13370, 10970],
  [2482, 'Mount Hyjal', 3, 1414, 69032, 0, 1, 616, 0, 0, 1, 1, 3989.5830078125, 6304.166015625, -4395.833984375, -922.916015625],
  [2521, 'Zephras Isle', 3, 947, 69208, 0, 2991, 16593, 0, 0, 1, 1, 1247.9169921875, 4956.25, -1331.25, 4231.25],
  [2524, 'Darkspear Islands', 6, 1414, 69219, 0, 2997, 16606, 0, 0, 1, 1, -835.416015625, 447.916015625, 993.75, 2918.75],
  [2548, 'Riverglades', 3, 1415, 69323, 0, 0, 16591, 0, 0, 1, 1, -9700, -6466.666015625, -6741.666015625, -1891.666015625],
  [2652, "Shen'dralas", 3, 1414, 69778, 0, 1, 16651, 0, 0, 1, 1, -3266.666015625, -1900, -25, 2025],
  [2665, 'Zephras Isle', 3, 0, 69852, 0, 2991, 0, 0, 0, 1, 1, 1247.9200439453, 4956.25, -1331.25, 4231.25],
];

export interface ResearchCsvBytes {
  readonly UiMapAssignment: Uint8Array;
  readonly UiMap: Uint8Array;
}

/** What the research CSVs must contain. The defaults are the recorded facts; tests pass synthetic ones. */
export interface RowsExpectations {
  readonly csvs: Readonly<Record<'UiMapAssignment' | 'UiMap', ResearchCsv>>;
  readonly uiMapIds: readonly number[];
  readonly assignmentIds: readonly number[];
  readonly rawLinesSha256: string;
  readonly reference: readonly ReferenceRow[];
}

export const RECORDED_EXPECTATIONS: RowsExpectations = {
  csvs: RESEARCH_CSVS,
  uiMapIds: DB2_ONLY_UIMAP_IDS,
  assignmentIds: DB2_ONLY_ASSIGNMENT_IDS,
  rawLinesSha256: DB2_ROWS_RAW_LINES_SHA256,
  reference: REFERENCE_ROWS,
};

function checkResearchCsv(bytes: Uint8Array, expected: ResearchCsv): CsvTable {
  const hash = sha256Hex(bytes);
  if (hash !== expected.sha256) {
    throw new Error(
      `${expected.file}: SHA-256 ${hash} differs from the recorded ${expected.sha256}. Do not edit values: follow docs/MAPS.md §8.3 ` +
        '"Writing the rows file" step 4 (compare parsed rows with the reference table and the frame hash; owner review if any value differs).',
    );
  }
  if (bytes.length !== expected.bytes) throw new Error(`${expected.file}: ${String(bytes.length)} bytes, expected ${String(expected.bytes)}`);
  const table = parseCsv(Buffer.from(bytes).toString('utf8'));
  if (table.records.length !== expected.rows) {
    throw new Error(`${expected.file}: ${String(table.records.length)} rows, expected ${String(expected.rows)}`);
  }
  return table;
}

const source = (csv: ResearchCsv, table: CsvTable): Db2Source => ({
  url: csv.url,
  fetched: csv.fetched,
  obtained: csv.obtained,
  file: csv.file,
  bytes: csv.bytes,
  rows: csv.rows,
  sha256: csv.sha256,
  header: table.header,
});

const pick = <K extends string>(columns: Readonly<Record<string, string>>, names: readonly K[]): Record<K, string> =>
  Object.fromEntries(names.map((name) => [name, columns[name] ?? ''])) as Record<K, string>;

const sameNumbers = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((n, i) => n === b[i]);

/**
 * Builds the rows file from the two research CSVs (MAPS.md §8.3 "Writing the rows file"): checks
 * both SHA-256 values against the inventory, selects the rows of the 11 DB2-only UiMaps by column
 * name, checks them against the reference table and the raw-lines hash, and, when
 * `frameUiMapIds` (the 49 `conversion.json` UiMaps) is given, that the other 49 rows are exactly
 * those UiMaps.
 */
export function buildDb2RowsFile(
  csv: ResearchCsvBytes,
  frameUiMapIds: readonly number[] | null,
  expect: RowsExpectations = RECORDED_EXPECTATIONS,
): Db2RowsFile {
  const assignmentsTable = checkResearchCsv(csv.UiMapAssignment, expect.csvs.UiMapAssignment);
  const uiMapTable = checkResearchCsv(csv.UiMap, expect.csvs.UiMap);
  requireColumns(assignmentsTable, ASSIGNMENT_COLUMNS, expect.csvs.UiMapAssignment.file);
  requireColumns(uiMapTable, ['ID', ...UIMAP_COLUMNS], expect.csvs.UiMap.file);

  const records = assignmentsTable.records.map((record) => ({ record, columns: recordColumns(assignmentsTable, record) }));
  const selected = records.filter(({ columns }) => expect.uiMapIds.includes(decimal(columns['UiMapID'] ?? '', 'UiMapID')));
  const others = records.filter((entry) => !selected.includes(entry));
  const ids = selected.map(({ columns }) => decimal(columns['ID'] ?? '', 'ID')).sort((a, b) => a - b);
  const wantIds = [...expect.assignmentIds].sort((a, b) => a - b);
  if (!sameNumbers(ids, wantIds)) throw new Error(`DB2-only assignment IDs are ${ids.join(', ')}, expected ${wantIds.join(', ')}`);
  const raw = `${selected.map(({ record }) => record.raw).join('\n')}\n`;
  if (sha256Hex(raw) !== expect.rawLinesSha256) {
    throw new Error(`the ${String(selected.length)} raw CSV lines hash to ${sha256Hex(raw)}, expected ${expect.rawLinesSha256}`);
  }
  if (frameUiMapIds !== null) {
    const rest = others.map(({ columns }) => decimal(columns['UiMapID'] ?? '', 'UiMapID')).sort((a, b) => a - b);
    const want = [...frameUiMapIds].sort((a, b) => a - b);
    if (!sameNumbers(rest, want)) throw new Error('the other UiMapAssignment rows are not exactly the conversion.json UiMaps');
  }

  const assignments = selected
    .map(({ record, columns }): Db2AssignmentRow => ({
      table: 'UiMapAssignment',
      build: DB2_BUILD,
      id: decimal(columns['ID'] ?? '', 'ID'),
      csvLine: record.line,
      columns: pick(columns, ASSIGNMENT_COLUMNS),
    }))
    .sort((a, b) => Number(a.columns.UiMapID) - Number(b.columns.UiMapID) || Number(a.columns.OrderIndex) - Number(b.columns.OrderIndex));

  const uiMaps = uiMapTable.records
    .map((record) => ({ record, columns: recordColumns(uiMapTable, record) }))
    .filter(({ columns }) => expect.uiMapIds.includes(decimal(columns['ID'] ?? '', 'UiMap.ID')))
    .map(({ record, columns }): Db2UiMapRow => ({
      table: 'UiMap',
      build: DB2_BUILD,
      id: decimal(columns['ID'] ?? '', 'UiMap.ID'),
      csvLine: record.line,
      columns: pick(columns, UIMAP_COLUMNS),
    }))
    .sort((a, b) => a.id - b.id);

  const file: Db2RowsFile = {
    schema: 1,
    product: PRODUCT,
    build: DB2_BUILD,
    sources: { UiMapAssignment: source(expect.csvs.UiMapAssignment, assignmentsTable), UiMap: source(expect.csvs.UiMap, uiMapTable) },
    rawLinesSha256: expect.rawLinesSha256,
    assignments,
    uiMaps,
  };
  const problems = compareWithReference(file, expect.reference);
  if (problems.length > 0) throw new Error(`rows differ from the MAPS.md §8.3 reference table: ${problems.join('; ')}`);
  return file;
}

/** Differences between a rows file and the reference table (empty when they agree). */
export function compareWithReference(file: Db2RowsFile, reference: readonly ReferenceRow[] = REFERENCE_ROWS): readonly string[] {
  const problems: string[] = [];
  const maps = geometryMapsFromRows(file);
  const rows = maps.flatMap((map) => map.assignments.map((row) => ({ map, row })));
  if (rows.length !== reference.length) problems.push(`${String(rows.length)} rows, reference has ${String(reference.length)}`);
  for (const ref of reference) {
    const [ui, name, type, parent, id, order, mapId, area, u0, v0, u1, v1, xMin, xMax, yMin, yMax] = ref;
    const hit = rows.find(({ row }) => row.id === id);
    if (hit === undefined) {
      problems.push(`row ${String(id)} missing`);
      continue;
    }
    const { map, row } = hit;
    const got = [map.uiMapId, map.type ?? -1, map.parent ?? -1, row.orderIndex, row.mapId, row.areaId, ...row.uiMin, ...row.uiMax, row.xMin, row.xMax, row.yMin, row.yMax];
    const want = [ui, type, parent, order, mapId, area, u0, v0, u1, v1, xMin, xMax, yMin, yMax];
    if (map.name !== name || !sameNumbers(got, want)) problems.push(`row ${String(id)} (UiMap ${String(ui)}) differs`);
  }
  return problems;
}

// =============================================================================================
// Reading the committed file

type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

function readColumns<K extends string>(value: unknown, names: readonly K[], path: string): Record<K, string> {
  if (!isRecord(value)) throw new Error(`${path}: expected an object`);
  const keys = Object.keys(value);
  if (keys.length !== names.length || !names.every((name, i) => keys[i] === name)) {
    throw new Error(`${path}: columns must be exactly ${names.join(', ')} in that order`);
  }
  for (const name of names) if (typeof value[name] !== 'string') throw new Error(`${path}.${name}: expected the CSV string`);
  return value as Record<K, string>;
}

function readSource(value: unknown, expected: ResearchCsv, path: string): Db2Source {
  if (!isRecord(value)) throw new Error(`${path}: expected an object`);
  const header = value['header'];
  if (!Array.isArray(header) || !header.every((name) => typeof name === 'string')) throw new Error(`${path}.header: expected the CSV header`);
  const str = (key: string): string => {
    const v = value[key];
    if (typeof v !== 'string' || v === '') throw new Error(`${path}.${key}: expected a non-empty string`);
    return v;
  };
  const int = (key: string): number => {
    const v = value[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new Error(`${path}.${key}: expected a non-negative integer`);
    return v;
  };
  const out: Db2Source = {
    url: str('url'),
    fetched: str('fetched'),
    obtained: str('obtained'),
    file: str('file'),
    bytes: int('bytes'),
    rows: int('rows'),
    sha256: str('sha256'),
    header,
  };
  if (!/^[0-9a-f]{64}$/.test(out.sha256)) throw new Error(`${path}.sha256: expected a SHA-256`);
  if (out.url !== expected.url || out.file !== expected.file) throw new Error(`${path}: url or file does not match the research inventory`);
  return out;
}

/** Parses and checks the committed rows file (fails closed on any shape problem). */
export function parseDb2RowsFile(value: unknown, csvs: RowsExpectations['csvs'] = RESEARCH_CSVS): Db2RowsFile {
  if (!isRecord(value)) throw new Error('rows file: expected an object');
  if (value['schema'] !== 1) throw new Error('rows file: schema must be 1');
  if (value['product'] !== PRODUCT || value['build'] !== DB2_BUILD) throw new Error(`rows file: product/build must be ${PRODUCT} ${DB2_BUILD}`);
  const sources = value['sources'];
  if (!isRecord(sources)) throw new Error('rows file: sources must be an object');
  const rawLinesSha256 = value['rawLinesSha256'];
  if (typeof rawLinesSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(rawLinesSha256)) throw new Error('rows file: rawLinesSha256 must be a SHA-256');
  const assignments = value['assignments'];
  const uiMaps = value['uiMaps'];
  if (!Array.isArray(assignments) || !Array.isArray(uiMaps)) throw new Error('rows file: assignments and uiMaps must be arrays');
  const row = <T extends 'UiMapAssignment' | 'UiMap'>(entry: unknown, table: T, path: string): { id: number; csvLine: number; build: string; raw: Json } => {
    if (!isRecord(entry) || entry['table'] !== table) throw new Error(`${path}: expected a ${table} row`);
    if (entry['build'] !== DB2_BUILD) throw new Error(`${path}.build: must be ${DB2_BUILD}`);
    const id = entry['id'];
    const csvLine = entry['csvLine'];
    if (typeof id !== 'number' || !Number.isInteger(id) || typeof csvLine !== 'number' || !Number.isInteger(csvLine)) {
      throw new Error(`${path}: id and csvLine must be integers`);
    }
    return { id, csvLine, build: DB2_BUILD, raw: entry };
  };
  const file: Db2RowsFile = {
    schema: 1,
    product: PRODUCT,
    build: DB2_BUILD,
    sources: {
      UiMapAssignment: readSource(sources['UiMapAssignment'], csvs.UiMapAssignment, 'sources.UiMapAssignment'),
      UiMap: readSource(sources['UiMap'], csvs.UiMap, 'sources.UiMap'),
    },
    rawLinesSha256,
    assignments: assignments.map((entry: unknown, i) => {
      const path = `assignments[${String(i)}]`;
      const { id, csvLine, raw } = row(entry, 'UiMapAssignment', path);
      const columns = readColumns(raw['columns'], ASSIGNMENT_COLUMNS, `${path}.columns`);
      if (decimal(columns.ID, `${path}.columns.ID`) !== id) throw new Error(`${path}: id does not match columns.ID`);
      return { table: 'UiMapAssignment', build: DB2_BUILD, id, csvLine, columns };
    }),
    uiMaps: uiMaps.map((entry: unknown, i) => {
      const path = `uiMaps[${String(i)}]`;
      const { id, csvLine, raw } = row(entry, 'UiMap', path);
      return { table: 'UiMap', build: DB2_BUILD, id, csvLine, columns: readColumns(raw['columns'], UIMAP_COLUMNS, `${path}.columns`) };
    }),
  };
  return file;
}

/** The JSON object written to disk: a `$comment` first, then the file's fields in a fixed order. */
export function rowsFileJson(file: Db2RowsFile): Readonly<Record<string, unknown>> {
  return { $comment: ROWS_FILE_COMMENT, ...file };
}

// =============================================================================================
// Rows → geometry

/**
 * The 11 UiMaps as geometry (`source: 'db2-csv'`, build 1.60.1.70009). Fails closed on any row
 * the placeholder format cannot represent faithfully: a Z restriction (`Region_2`/`Region_5` not
 * ∓1,000,000), a WMO restriction or a non-zero unnamed field.
 */
export function geometryMapsFromRows(file: Db2RowsFile): readonly UiMapGeometry[] {
  return file.uiMaps.map((uiMap): UiMapGeometry => {
    const rows = file.assignments.filter((row) => decimal(row.columns.UiMapID, 'UiMapID') === uiMap.id);
    const assignments = rows.map((row): GeometryAssignment => {
      const c = row.columns;
      const what = `UiMapAssignment ${String(row.id)}`;
      const restricted =
        decimal(c.Region_2, what) !== -1000000 ||
        decimal(c.Region_5, what) !== 1000000 ||
        decimal(c.WMODoodadPlacementID, what) !== 0 ||
        decimal(c.WMOGroupID, what) !== 0 ||
        decimal(c.Field_11_2_5_62687_010, what) !== 0;
      if (restricted) throw new Error(`${what}: Z, WMO or unnamed-field restriction the placeholder format cannot carry`);
      return {
        id: row.id,
        mapId: worldMapId(decimal(c.MapID, what)),
        areaId: areaId(decimal(c.AreaID, what)),
        orderIndex: decimal(c.OrderIndex, what),
        xMin: decimal(c.Region_0, what),
        xMax: decimal(c.Region_3, what),
        yMin: decimal(c.Region_1, what),
        yMax: decimal(c.Region_4, what),
        uiMin: [decimal(c.UiMin_0, what), decimal(c.UiMin_1, what)],
        uiMax: [decimal(c.UiMax_0, what), decimal(c.UiMax_1, what)],
        source: 'db2-csv',
        build: row.build,
      };
    });
    if (assignments.length === 0) throw new Error(`UiMap ${String(uiMap.id)} has no UiMapAssignment row in the rows file`);
    const name = uiMap.columns.Name_lang;
    if (name === '') throw new Error(`UiMap ${String(uiMap.id)} has no Name_lang`);
    return {
      uiMapId: uiMapId(uiMap.id),
      name,
      nameSource: 'db2-csv',
      type: decimal(uiMap.columns.Type, `UiMap ${String(uiMap.id)} Type`),
      parent: uiMapId(decimal(uiMap.columns.ParentUiMapID, `UiMap ${String(uiMap.id)} ParentUiMapID`)),
      assignments,
    };
  });
}
