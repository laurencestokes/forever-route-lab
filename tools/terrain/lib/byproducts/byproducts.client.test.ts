/**
 * Step 3b.7 checks against the local Forever client (terrain-navigation.md §13, §17): the committed
 * `public/maps/terrain/` byproducts are rebuilt from the pinned client and compared. They need the
 * pinned build at WOW_INSTALL and skip with a banner otherwise. Read-only; nothing is written.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalCasc } from '../../../casc/casc';
import { readDb2 } from '../../../casc/db2';
import { DB2 } from '../../../casc/layouts';
import { announceSkip, FOREVER_TEST_PIN, pinnedClientStatus } from '../../../casc/test-support';
import { hazardLiquidTypes } from '../formats/liquid';
import { areaParents } from '../zones';
import { mapByproducts, TERRAIN_DIR, type ByproductSource, type MapByproducts } from './build';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const status = pinnedClientStatus();

interface CommittedFile {
  readonly path: string;
  readonly sha256: string;
  readonly indicesSha256?: string;
}

it('finds the pinned client, or says loudly why the 3b.7 client tests are skipped', () => {
  if (!status.available) announceSkip('tools/terrain byproducts on the client (byproducts.client.test.ts)', status.reason);
  expect(status.available || status.reason.length > 0).toBe(true);
});

describe.skipIf(!status.available)('terrain byproducts on the pinned Forever client', () => {
  let casc: LocalCasc;
  let built: MapByproducts[];
  let manifest: { readonly files: readonly CommittedFile[]; readonly maps: readonly Readonly<Record<string, unknown>>[]; readonly tool: { readonly zlib: string } };

  beforeAll(() => {
    if (!status.available) return;
    casc = LocalCasc.open({ install: status.install, product: FOREVER_TEST_PIN.product, pin: FOREVER_TEST_PIN });
    const areas = readDb2(casc, DB2.AreaTable);
    const liquids = readDb2(casc, DB2.LiquidType, { requireComplete: true });
    const maps = readDb2(casc, DB2.Map);
    const tables = [
      { table: 'AreaTable', fileDataId: DB2.AreaTable.fileDataId, ckey: casc.ckeyOf(DB2.AreaTable.fileDataId) ?? '', rows: areas.rows.length },
      { table: 'LiquidType', fileDataId: DB2.LiquidType.fileDataId, ckey: casc.ckeyOf(DB2.LiquidType.fileDataId) ?? '', rows: liquids.rows.length },
      { table: 'Map', fileDataId: DB2.Map.fileDataId, ckey: casc.ckeyOf(DB2.Map.fileDataId) ?? '', rows: maps.rows.length },
    ].sort((a, b) => a.fileDataId - b.fileDataId);
    const source: ByproductSource = {
      parents: areaParents(areas.rows.map((r) => ({ id: r.id, parent: r.num('ParentAreaID') }))),
      hazard: hazardLiquidTypes(liquids.rows.map((r) => ({ id: r.id, soundBank: r.num('SoundBank') }))),
      tables,
      read: (id) => {
        const file = casc.file(id);
        return { data: file.data, ckey: file.ckey };
      },
    };
    built = [
      { mapId: 0, name: 'Eastern Kingdoms', wdtFileDataId: maps.byId.get(0)?.num('WdtFileDataID') ?? 0 },
      { mapId: 1, name: 'Kalimdor', wdtFileDataId: maps.byId.get(1)?.num('WdtFileDataID') ?? 0 },
    ].map((m) => mapByproducts(m, source));
    manifest = JSON.parse(readFileSync(join(REPO_ROOT, TERRAIN_DIR, 'manifest.json'), 'utf8')) as typeof manifest;
  }, 180_000);

  afterAll(() => {
    casc.close();
  });

  it('reads the two continents with the WDTs and tile counts of the design (§13.1)', () => {
    expect(built.map((m) => [m.entry['mapId'], m.entry['wdt'], m.entry['tiles']])).toEqual([
      [0, 775971, 736],
      [1, 782779, 988],
    ]);
    expect(built.map((m) => [m.grids.chunkRows, m.grids.chunkCols])).toEqual([
      [672, 368],
      [896, 784],
    ]);
    // Zone outlines as the prototype measured them (§13.1): 28 and 26 zones, 109 and 127 arcs.
    expect(built.map((m) => [(m.files[0]?.meta as { zones: number }).zones, m.zoneArcs.length])).toEqual([
      [28, 109],
      [26, 127],
    ]);
  });

  it('reproduces the committed files and per-map input hashes', () => {
    for (const m of built) {
      const committedMap = manifest.maps.find((x) => x['mapId'] === m.entry['mapId']);
      expect(committedMap?.['inputHash']).toBe(m.entry['inputHash']);
      for (const f of m.files) {
        const committed = manifest.files.find((x) => x.path === f.path);
        const sha = createHash('sha256').update(f.bytes).digest('hex');
        if (f.path.endsWith('.png')) {
          // The indices do not depend on the compressor; the bytes do (node:zlib, recorded in the manifest).
          expect(committed?.indicesSha256, f.path).toBe((f.meta as { indicesSha256: string }).indicesSha256);
          if (manifest.tool.zlib === process.versions.zlib) expect(committed?.sha256, f.path).toBe(sha);
        } else expect(committed?.sha256, f.path).toBe(sha);
        expect(readFileSync(join(REPO_ROOT, TERRAIN_DIR, f.path)).equals(f.bytes) || f.path.endsWith('.png')).toBe(true);
      }
    }
  });
});
