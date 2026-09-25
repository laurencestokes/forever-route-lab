import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../build/lib/fs';
import { DB2_ONLY_ASSIGNMENT_IDS, DB2_ONLY_UIMAP_IDS, DEFAULT_RESEARCH_CSV_DIR, RESEARCH_CSVS, ROWS_FILE, type ResearchCsv } from './constants';
import {
  ASSIGNMENT_COLUMNS,
  buildDb2RowsFile,
  compareWithReference,
  geometryMapsFromRows,
  parseDb2RowsFile,
  rowsFileJson,
  type Db2RowsFile,
  type RowsExpectations,
} from './db2-rows';
import { sha256Hex } from './hash';
import { formatJson } from './json';
import { committedRowsBytes } from './test-support';

// ---------------------------------------------------------------------------------------------
// Synthetic CSVs: two UiMapAssignment rows (Durotar, a QuestieDB frame; Kalimdor, a DB2-only row)

const HEADER = ASSIGNMENT_COLUMNS.join(',');
const DUROTAR_LINE = '0,0,1,1,-1716.6666259766,-7249.9995117188,-1000000,1808.3332519531,-1962.4998779297,1000000,46721,1411,0,1,14,0,0,0';
const KALIMDOR_LINE = '0,0,1,1,-11733.299804688,-19733.2109375,-1000000,12799.900390625,17066.599609375,1000000,46724,1414,0,1,0,0,0,0';
const ASSIGNMENT_CSV = `${HEADER}\n${DUROTAR_LINE}\n${KALIMDOR_LINE}\n`;
const UIMAP_CSV = 'Name_lang,ID,ParentUiMapID,Type\nKalimdor,1414,947,2\nDurotar,1411,1414,3\n';

const csvEntry = (base: ResearchCsv, text: string, rows: number): ResearchCsv => ({ ...base, bytes: Buffer.byteLength(text), rows, sha256: sha256Hex(text) });

const EXPECT: RowsExpectations = {
  csvs: { UiMapAssignment: csvEntry(RESEARCH_CSVS.UiMapAssignment, ASSIGNMENT_CSV, 2), UiMap: csvEntry(RESEARCH_CSVS.UiMap, UIMAP_CSV, 2) },
  uiMapIds: [1414],
  assignmentIds: [46724],
  rawLinesSha256: sha256Hex(`${KALIMDOR_LINE}\n`),
  reference: [[1414, 'Kalimdor', 2, 947, 46724, 0, 1, 0, 0, 0, 1, 1, -11733.299804688, 12799.900390625, -19733.2109375, 17066.599609375]],
};

const build = (assignment = ASSIGNMENT_CSV, uiMap = UIMAP_CSV, frame: readonly number[] | null = [1411], expect = EXPECT): Db2RowsFile =>
  buildDb2RowsFile({ UiMapAssignment: Buffer.from(assignment), UiMap: Buffer.from(uiMap) }, frame, expect);

describe('buildDb2RowsFile (synthetic CSVs)', () => {
  it('selects the DB2-only rows by column name and keeps every value as the CSV string, with citations', () => {
    const file = build();
    expect(file.assignments).toHaveLength(1);
    const [row] = file.assignments;
    expect(row).toMatchObject({ table: 'UiMapAssignment', build: '1.60.1.70009', id: 46724, csvLine: 3 });
    expect(row?.columns.Region_0).toBe('-11733.299804688');
    expect(Object.keys(row?.columns ?? {})).toEqual([...ASSIGNMENT_COLUMNS]);
    expect(file.uiMaps).toEqual([{ table: 'UiMap', build: '1.60.1.70009', id: 1414, csvLine: 2, columns: { Name_lang: 'Kalimdor', Type: '2', ParentUiMapID: '947' } }]);
    expect(file.sources.UiMap.header).toEqual(['Name_lang', 'ID', 'ParentUiMapID', 'Type']);
    expect(file.rawLinesSha256).toBe(EXPECT.rawLinesSha256);
  });

  it('refuses CSVs whose SHA-256 differs from the inventory, pointing at MAPS.md §8.3 step 4', () => {
    expect(() => build(ASSIGNMENT_CSV.replace('-11733.299804688', '-11733.2998'))).toThrow(/differs from the recorded .*MAPS.md §8.3/);
  });

  it('checks the assignment IDs, the raw lines, the conversion.json complement and the reference table', () => {
    expect(() => build(ASSIGNMENT_CSV, UIMAP_CSV, [1412])).toThrow(/not exactly the conversion.json UiMaps/);
    expect(() => build(ASSIGNMENT_CSV, UIMAP_CSV, [1411], { ...EXPECT, assignmentIds: [46725] })).toThrow(/assignment IDs are 46724, expected 46725/);
    expect(() => build(ASSIGNMENT_CSV, UIMAP_CSV, [1411], { ...EXPECT, rawLinesSha256: '0'.repeat(64) })).toThrow(/raw CSV lines hash/);
    const [reference] = EXPECT.reference;
    if (reference === undefined) throw new Error('fixture');
    const wrong = [[...reference.slice(0, 12), 0, ...reference.slice(13)] as unknown as (typeof EXPECT.reference)[number]];
    expect(() => build(ASSIGNMENT_CSV, UIMAP_CSV, [1411], { ...EXPECT, reference: wrong })).toThrow(/reference table: row 46724 \(UiMap 1414\) differs/);
  });

  it('round-trips through the committed text form', () => {
    const file = build();
    const text = formatJson(rowsFileJson(file));
    expect(parseDb2RowsFile(JSON.parse(text) as unknown, EXPECT.csvs)).toEqual(file);
    expect(text.startsWith('{\n  "$comment": [')).toBe(true);
  });
});

describe('geometryMapsFromRows', () => {
  it('maps Region_0/3/1/4 to xMin/xMax/yMin/yMax and keeps the DB2 ids, type and parent', () => {
    const [kalimdor] = geometryMapsFromRows(build());
    expect(kalimdor).toEqual({
      uiMapId: 1414,
      name: 'Kalimdor',
      nameSource: 'db2-csv',
      type: 2,
      parent: 947,
      assignments: [
        {
          id: 46724, mapId: 1, areaId: 0, orderIndex: 0, xMin: -11733.299804688, xMax: 12799.900390625, yMin: -19733.2109375, yMax: 17066.599609375,
          uiMin: [0, 0], uiMax: [1, 1], source: 'db2-csv', build: '1.60.1.70009',
        },
      ],
    });
  });

  it('refuses rows the placeholder format cannot carry faithfully (Z or WMO restrictions)', () => {
    const file = build();
    const [row] = file.assignments;
    if (row === undefined) throw new Error('fixture');
    const restricted: Db2RowsFile = { ...file, assignments: [{ ...row, columns: { ...row.columns, Region_2: '-50' } }] };
    expect(() => geometryMapsFromRows(restricted)).toThrow(/Z, WMO or unnamed-field restriction/);
    const wmo: Db2RowsFile = { ...file, assignments: [{ ...row, columns: { ...row.columns, WMOGroupID: '7' } }] };
    expect(() => geometryMapsFromRows(wmo)).toThrow(/restriction/);
    const exponent: Db2RowsFile = { ...file, assignments: [{ ...row, columns: { ...row.columns, Region_0: '1e3' } }] };
    expect(() => geometryMapsFromRows(exponent)).toThrow(/is not a decimal number/);
  });
});

describe('the committed rows file', () => {
  const committed = committedRowsBytes().toString('utf8');
  const file = parseDb2RowsFile(JSON.parse(committed) as unknown);

  it('holds exactly the 12 rows for the 11 DB2-only UiMaps, matching the MAPS.md §8.3 reference table', () => {
    expect(file.assignments.map((row) => row.id).sort((a, b) => a - b)).toEqual(DB2_ONLY_ASSIGNMENT_IDS);
    expect(file.uiMaps.map((row) => row.id)).toEqual(DB2_ONLY_UIMAP_IDS);
    expect(compareWithReference(file)).toEqual([]);
    expect(file.sources.UiMapAssignment.sha256).toBe('79267e8be8034e47daab14350411b3acc0b1f64e86efc9d821a217497254ca0a');
    expect(file.sources.UiMap.sha256).toBe('1f4aac70eaac015b1d2d0ea0faf6e3d7fb2cf7afdf45e5bb6772d9b80a72346b');
    expect(file.rawLinesSha256).toBe('0aff6391a197d4ff33a2f56bd3388ca72f305a5543fc646682580437646870bb');
  });

  it('is in canonical form (written by make-db2-rows, not edited by hand) with LF line endings', () => {
    expect(committed).not.toContain('\r');
    expect(formatJson(rowsFileJson(file))).toBe(committed);
  });

  const csvDir = join(REPO_ROOT, DEFAULT_RESEARCH_CSV_DIR);
  const haveCsvs = existsSync(join(csvDir, RESEARCH_CSVS.UiMapAssignment.file)) && existsSync(join(csvDir, RESEARCH_CSVS.UiMap.file));
  it.skipIf(!haveCsvs)('is exactly what the research CSVs produce (runs only where the local research CSVs exist)', () => {
    const rebuilt = buildDb2RowsFile(
      { UiMapAssignment: readFileSync(join(csvDir, RESEARCH_CSVS.UiMapAssignment.file)), UiMap: readFileSync(join(csvDir, RESEARCH_CSVS.UiMap.file)) },
      null,
    );
    expect(formatJson(rowsFileJson(rebuilt))).toBe(readFileSync(join(REPO_ROOT, ROWS_FILE), 'utf8'));
  });
});
