/**
 * Integration test against the local Forever client (terrain-navigation.md §17, step 3b.1). It
 * needs the pinned build at WOW_INSTALL and skips with a banner otherwise (CI has no client). It
 * reads only `.build.info` and `Data/{config,data}`, and writes nothing.
 *
 * With the research CSVs present (.cache/experiments/maps, docs/MAPS.md §8.3), every column of
 * ten tables is compared with the reader's values. The CSVs are of build 1.60.1.70009, so the test
 * first checks that each table's content key (CKey) at the pin is still the one it had there: the
 * CSVs then describe the same bytes (all ten are unchanged at 1.60.1.70124,
 * docs/reviews/repin-70124.md).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../maps/lib/csv';
import { LocalCasc } from './casc';
import { readDb2 } from './db2';
import { DB2, type Db2TableName } from './layouts';
import { announceSkip, FOREVER_TEST_PIN, pinnedClientStatus } from './test-support';
import type { Wdc5Row } from './wdc5';

const status = pinnedClientStatus();

// Runs everywhere, so the skip banner reaches the default reporter (a fully skipped file's output
// is not printed).
it('finds the pinned client, or says loudly why the client tests are skipped', () => {
  if (!status.available) announceSkip('tools/casc client integration (casc.client.test.ts)', status.reason);
  expect(status.available || status.reason.length > 0).toBe(true);
});

const CSV_DIR = fileURLToPath(new URL('../../.cache/experiments/maps/', import.meta.url));
const CSV_TABLES: readonly Db2TableName[] = ['AreaTable', 'Map', 'UiMap', 'UiMapAssignment', 'UiMapArt', 'UiMapArtTile', 'UiMapArtStyleLayer', 'UiMapXMapArt', 'WorldMapOverlay', 'WorldMapOverlayTile'];
/** The build of the research CSVs (docs/MAPS.md §8.3). */
const CSV_BUILD = '1.60.1.70009';
/** Each CSV table's CKey at 1.60.1.70009, as the 70009 art, nav and terrain manifests recorded it. */
const CSV_CKEYS: Readonly<Record<string, string>> = {
  AreaTable: '65ca0ed314f02647991a9cf56cf63513',
  Map: 'c7f3134e35c4f8c8bfd736e0a4ed3046',
  UiMap: '09796a314cff8d65232a5347f4390c28',
  UiMapAssignment: '6288c474b5d128c8f96eda7c0202ad9d',
  UiMapArt: 'e03d4286cd499a4968e3f7a8afda8ae9',
  UiMapArtTile: 'd4dba09ea4040d1d1da86169c2850e3a',
  UiMapArtStyleLayer: 'fa9b39b1cec60f14c150e9405a3d7066',
  UiMapXMapArt: 'b9708709153e2acbaea84133e52fcb34',
  WorldMapOverlay: 'c4fc3c1f6f8929bdabab037e1817cf7f',
  WorldMapOverlayTile: 'bc0effbfa0eeb557c9b335ec102e5023',
};

describe.skipIf(!status.available)('LocalCasc on the pinned Forever client', () => {
  let casc: LocalCasc;

  beforeAll(() => {
    if (!status.available) return;
    casc = LocalCasc.open({ install: status.install, product: FOREVER_TEST_PIN.product, pin: FOREVER_TEST_PIN });
  });

  afterAll(() => {
    casc.close();
  });

  it('opens with the counts recorded in terrain-navigation.md §2.1, restated at 1.60.1.70124', () => {
    expect(casc.build.version).toBe(FOREVER_TEST_PIN.version);
    // The local indices cover every product in the shared Data/ folder, so this count moves when any
    // of them updates (2,161,431 at 1.60.1.70009 on 2026-09-26).
    expect(casc.stats.indexEntries).toBe(2_161_303);
    expect(casc.stats.encodingPages).toBe(23_425);
    // 2,747,339 root entries at 1.60.1.70009; the other root counts are unchanged.
    expect(casc.stats.root).toEqual({ blocks: 1_182, entries: 2_747_341, fileDataIds: 1_435_081, encryptedFlagFileDataIds: 4_970 });
    console.info(`casc open: ${JSON.stringify(casc.stats.openMs)} ms (not asserted)`);
  });

  it('reads both continent WDTs with a verified MD5', () => {
    for (const id of [775971, 782779]) {
      const wdt = casc.file(id);
      expect(wdt.verified).toBe(true);
      expect(wdt.data.toString('latin1', 0, 4)).toBe('REVM');
    }
  });

  it('reads Map and AreaTable, skipping exactly their three encrypted sections', () => {
    const map = readDb2(casc, DB2.Map);
    expect(map.rows).toHaveLength(72);
    expect(map.skippedSections).toHaveLength(3);
    expect(map.byId.get(0)?.num('WdtFileDataID')).toBe(775971);
    expect(map.byId.get(1)?.num('WdtFileDataID')).toBe(782779);
    expect(map.byId.get(1)?.str('Directory')).toBe('Kalimdor');
    expect(map.byId.get(0)?.num('ParentMapID')).toBe(-1);
    const areas = readDb2(casc, DB2.AreaTable);
    expect(areas.rows).toHaveLength(1_371);
    expect(areas.skippedSections).toHaveLength(3);
    expect(areas.byId.get(363)?.num('ParentAreaID')).toBe(14); // Valley of Trials → Durotar
    expect(areas.byId.get(1497)?.str('AreaName_lang')).toBe('Undercity');
    expect(() => readDb2(casc, DB2.AreaTable, { requireComplete: true })).toThrow(/encrypted/);
  });

  it('reads WMOAreaTable with the inline-ID fix: 52,578 rows, 338 areas, Undercity WMO 1150 → 1497', () => {
    const t = readDb2(casc, DB2.WMOAreaTable, { requireComplete: true });
    expect(t.rows).toHaveLength(52_578);
    expect(new Set(t.rows.map((r) => r.num('AreaTableID'))).size).toBe(338);
    const root = t.rows.find((r) => r.num('WMOID') === 1150 && r.num('NameSetID') === 0 && r.num('WMOGroupID') === -1);
    expect(root?.num('AreaTableID')).toBe(1497);
    // WMOID is inline and repeated in the relationship map; they never disagree
    const related = t.rows.filter((r) => r.relation !== null);
    expect(related.length).toBe(52_570);
    expect(related.every((r) => r.relation === r.num('WMOID'))).toBe(true);
  });

  it('reads LiquidType: the hazard liquids are SoundBank 2 or 3', () => {
    const t = readDb2(casc, DB2.LiquidType, { requireComplete: true });
    expect(t.rows).toHaveLength(52);
    const hazards = t.rows.filter((r) => r.num('SoundBank') === 2 || r.num('SoundBank') === 3).map((r) => r.id);
    expect(hazards).toEqual([3, 4, 7, 8, 11, 12, 15, 19, 20, 21, 1174, 1177, 1267, 1268, 1269, 1284, 1295]);
  });

  it('holds the ten CSV tables as the same bytes as at 1.60.1.70009 (equal CKeys)', () => {
    expect(Object.fromEntries(CSV_TABLES.map((name) => [name, casc.ckeyOf(DB2[name].fileDataId)]))).toEqual(CSV_CKEYS);
  });

  const csvPresent = CSV_TABLES.every((t) => existsSync(`${CSV_DIR}${t}_${CSV_BUILD}.csv`));
  it('has the research CSVs, or says loudly why the CSV comparison is skipped', () => {
    if (!csvPresent) announceSkip('DB2 reader against the research CSVs', `the ${CSV_BUILD} CSVs are not in .cache/experiments/maps`);
    expect(typeof csvPresent).toBe('boolean');
  });
  it.skipIf(!csvPresent)('agrees with every column of the research CSVs of ten tables', () => {
    for (const name of CSV_TABLES) {
      const table = readDb2(casc, DB2[name]);
      const { layout } = DB2[name];
      // The CSVs are CRLF files whose quoted values may also hold CRLF; compare with LF on both sides.
      const csv = parseCsv(readFileSync(`${CSV_DIR}${name}_${CSV_BUILD}.csv`, 'utf8').replace(/\r\n/g, '\n'));
      expect(table.rows.length, name).toBe(csv.records.length);
      const cell = (row: Wdc5Row, column: string): string | number => {
        if (column === layout.id) return row.id;
        const element = /^(.*)_(\d+)$/.exec(column);
        const field = layout.fields.find((f) => f.name === column) ?? layout.fields.find((f) => f.name === element?.[1] && f.array > 1);
        const text = field?.type === 'string' || field?.type === 'locstring';
        if (field !== undefined && field.array > 1) return (text ? row.strs(field.name) : row.nums(field.name))[Number(element?.[2])] ?? NaN;
        if (field !== undefined && text) return row.str(field.name).replace(/\r\n/g, '\n');
        return row.num(column);
      };
      let mismatches = 0;
      for (const record of csv.records) {
        const id = Number(record.fields[csv.header.indexOf(layout.id)]);
        const row = table.byId.get(id);
        if (row === undefined) {
          mismatches += 1;
          continue;
        }
        for (const [i, column] of csv.header.entries()) {
          const ours = cell(row, column);
          const theirs = record.fields[i] ?? '';
          const same = typeof ours === 'number' ? Math.abs(ours - Number(theirs)) <= Math.abs(Number(theirs)) * 1e-6 : ours === theirs;
          if (!same) mismatches += 1;
        }
      }
      expect(mismatches, name).toBe(0);
    }
  });
});
