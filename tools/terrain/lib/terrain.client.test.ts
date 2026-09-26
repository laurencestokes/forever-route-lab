/**
 * Step 3b.2 checks against the local Forever client (terrain-navigation.md §17). They need the
 * pinned build at WOW_INSTALL and skip with a banner otherwise. Read-only; nothing is written.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalCasc } from '../../casc/casc';
import { readDb2 } from '../../casc/db2';
import { DB2 } from '../../casc/layouts';
import { announceSkip, FOREVER_TEST_PIN, pinnedClientStatus } from '../../casc/test-support';
import { parseAdtRoot } from './formats/adt';
import { blockRect, blockTiles, CHUNK_YD, expandRect, MAP_ORIGIN_YD, TILE_YD } from './formats/grid';
import { hazardLiquidTypes } from './formats/liquid';
import { parseObj0 } from './formats/obj0';
import { apply, placementTransform } from './formats/transform';
import { parseWdt, wdtTile, type Wdt } from './formats/wdt';
import { parseWmoGroup, parseWmoRoot } from './formats/wmo';
import { blockGeometry } from './geometry';
import { areaParents, topZone, wmoAreaIndex, wmoGroupArea, wmoRootArea, type WmoAreaIndex } from './zones';

const status = pinnedClientStatus();
const KALIMDOR_WDT = 782779;
const EASTERN_KINGDOMS_WDT = 775971;

it('finds the pinned client, or says loudly why the 3b.2 client tests are skipped', () => {
  if (!status.available) announceSkip('tools/terrain formats, geometry and zones on the client (terrain.client.test.ts)', status.reason);
  expect(status.available || status.reason.length > 0).toBe(true);
});

describe.skipIf(!status.available)('terrain formats on the pinned Forever client', () => {
  let casc: LocalCasc;
  let kalimdor: Wdt;
  let easternKingdoms: Wdt;
  let wmoAreas: WmoAreaIndex;

  beforeAll(() => {
    if (!status.available) return;
    casc = LocalCasc.open({ install: status.install, product: FOREVER_TEST_PIN.product, pin: FOREVER_TEST_PIN });
    kalimdor = parseWdt(casc.file(KALIMDOR_WDT).data);
    easternKingdoms = parseWdt(casc.file(EASTERN_KINGDOMS_WDT).data);
    const rows = readDb2(casc, DB2.WMOAreaTable, { requireComplete: true }).rows;
    wmoAreas = wmoAreaIndex(rows.map((r) => ({ wmoId: r.num('WMOID'), nameSet: r.num('NameSetID'), groupId: r.num('WMOGroupID'), areaId: r.num('AreaTableID') })));
  });

  afterAll(() => {
    casc.close();
  });

  it('reproduces the stored MODF extents of 65 of 65 WMO placements within 0.05 yd', () => {
    const sets: readonly (readonly [Wdt, readonly (readonly [number, number])[]])[] = [
      [kalimdor, [[31, 40], [29, 40], [30, 40], [32, 40], [31, 41], [30, 41], [28, 39], [33, 40]]],
      [easternKingdoms, [[40, 33], [41, 33], [40, 34], [41, 34], [39, 33], [30, 31], [31, 31], [28, 31], [29, 31]]],
    ];
    let placements = 0;
    let worst = 0;
    for (const [wdt, tiles] of sets) {
      for (const [row, col] of tiles) {
        const tile = wdtTile(wdt, row, col);
        if (tile === undefined) continue;
        for (const p of parseObj0(casc.file(tile.obj0).data)) {
          if (p.kind !== 'wmo' || p.extents === null) continue;
          const root = parseWmoRoot(casc.file(p.name).data);
          const t = placementTransform(p.position, p.rotation, p.scale);
          const lo = [Infinity, Infinity, Infinity];
          const hi = [-Infinity, -Infinity, -Infinity];
          for (const x of [root.boundsMin[0], root.boundsMax[0]]) {
            for (const y of [root.boundsMin[1], root.boundsMax[1]]) {
              for (const z of [root.boundsMin[2], root.boundsMax[2]]) {
                apply(t, x, y, z).forEach((v, k) => {
                  lo[k] = Math.min(lo[k] ?? Infinity, v);
                  hi[k] = Math.max(hi[k] ?? -Infinity, v);
                });
              }
            }
          }
          for (let k = 0; k < 3; k += 1) worst = Math.max(worst, Math.abs((lo[k] ?? 0) - (p.extents[k] ?? 0)), Math.abs((hi[k] ?? 0) - (p.extents[k + 3] ?? 0)));
          placements += 1;
        }
      }
    }
    expect(placements).toBe(65);
    expect(worst).toBeLessThan(0.05);
  });

  it('finds every MCNK of a spread of tiles on the world grid', () => {
    let tiles = 0;
    for (const wdt of [kalimdor, easternKingdoms]) {
      wdt.tiles.forEach((t, i) => {
        if (t.rootAdt === 0 || i % 8 !== 0) return;
        tiles += 1;
        const adt = parseAdtRoot(casc.file(t.rootAdt).data);
        for (const m of adt.chunks) {
          expect(Math.abs(m.position[0] - (MAP_ORIGIN_YD - t.row * TILE_YD - m.iy * CHUNK_YD))).toBeLessThan(0.01);
          expect(Math.abs(m.position[1] - (MAP_ORIGIN_YD - t.col * TILE_YD - m.ix * CHUNK_YD))).toBeLessThan(0.01);
        }
      });
    }
    expect(tiles).toBeGreaterThan(200);
  });

  it('resolves the placed Undercity WMO (WMO ID 20736, name set 1) and all 216 of its groups to zone 1497', () => {
    const tile = wdtTile(easternKingdoms, 29, 31);
    const placement = parseObj0(casc.file(tile?.obj0 ?? 0).data).find((p) => p.kind === 'wmo' && p.name === 7675285);
    expect(placement?.nameSet).toBe(1);
    const root = parseWmoRoot(casc.file(7675285).data);
    expect(root.wmoId).toBe(20736);
    expect(root.groupCount).toBe(216);
    const parents = areaParents(readDb2(casc, DB2.AreaTable).rows.map((r) => ({ id: r.id, parent: r.num('ParentAreaID') })));
    expect(wmoRootArea(wmoAreas, 20736, 1)).toBe(1497);
    const zones = new Set(root.groupFileDataIds.filter((g) => g !== 0).map((g) => topZone(parents, wmoGroupArea(wmoAreas, 20736, 1, parseWmoGroup(casc.file(g).data).wmoGroupId))));
    expect([...zones]).toEqual([1497]);
    // the classic Undercity WMO ID keeps its rows (the design's first example), though not placed on map 0
    expect(wmoRootArea(wmoAreas, 1150, 0)).toBe(1497);
  });

  it('builds block 28_36 of Kalimdor with the triangle soup the m3b prototype built (golden hash)', () => {
    const hazards = hazardLiquidTypes(readDb2(casc, DB2.LiquidType).rows.map((r) => ({ id: r.id, soundBank: r.num('SoundBank') })));
    const present = new Set(kalimdor.tiles.filter((t) => t.rootAdt !== 0).map((t) => t.row * 64 + t.col));
    const g = blockGeometry(
      { read: (id) => casc.file(id).data },
      kalimdor,
      blockTiles(28, 36).filter((t) => present.has(t.row * 64 + t.col)),
      { clip: expandRect(blockRect(28, 36), 8), swimDepth: 1.6, m2MinFootprint: 4, hazardLiquids: hazards, wmoAreas },
    );
    const hash = createHash('sha256');
    for (const a of [g.positions, g.triangles, g.classes, g.tags]) hash.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    expect(g.triangleCount).toBe(1_327_993);
    expect(g.inputs).toHaveLength(1_422);
    expect(hash.digest('hex')).toBe('9510a194243dc93458723cc55c329339225f11b053b56a9fcfd6b72ce05c4d81');
  });
});
