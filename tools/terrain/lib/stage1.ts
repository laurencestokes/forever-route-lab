import { createHash } from 'node:crypto';
import type { LocalCasc } from '../../casc/casc';
import { ckeyOf, type ClientTables, type InputFile } from './client';
import { encodeBlock, keepTile, type BlockGrid, type NavBlock, type NavTile } from './encode';
import { blockRect, blockTiles, expandRect } from './formats/grid';
import type { Wdt } from './formats/wdt';
import { blockGeometry, type FileSource, type GeometryStats } from './geometry';
import { buildBlockTiles, type BlockBuildStats, type PolyMeshHook, type RecastTile } from './recast';
import { worldX, worldY, worldZ, type Derived } from './settings';
import { areaAt, topZone, zoneIndex } from './zones';

/**
 * Stage 1 of one block (terrain-navigation.md §3.1): geometry → Recast → export (deep and hazard
 * polygons dropped) → per-polygon zones → a v3 block. Deterministic: the bytes depend only on the
 * client files read, the tables and the settings.
 *
 * Zones (§3.1 step 4): a polygon's centroid is matched to the source triangle containing it in
 * 2D and nearest in height (strictly within 8 yd); its tag, or the chunk's MCNK area when the tag
 * is 0 or nothing matches, is rolled up through `ParentAreaID` to the top-level zone.
 */

export interface Stage1Inputs {
  readonly mapId: number;
  readonly wdt: Wdt;
  readonly present: ReadonlySet<number>;
  readonly derived: Derived;
  readonly tables: Pick<ClientTables, 'hazardLiquids' | 'wmoAreas' | 'parents'>;
  readonly source: FileSource;
  /** CKey of a FileDataID (LocalCasc.ckeyOf), for the per-block input hash. */
  readonly ckey: (fileDataId: number) => string;
  /** Inputs every block depends on: the WDT and the DB2 tables. */
  readonly sharedInputs: readonly InputFile[];
}

export interface Stage1Stats {
  readonly triangles: number;
  readonly geometry: Readonly<GeometryStats>;
  readonly recast: BlockBuildStats;
  readonly polygonsKept: number;
  readonly verticesKept: number;
  readonly tilesKept: number;
  readonly zoneFromTriangle: number;
  readonly geometryMs: number;
  readonly recastMs: number;
  readonly exportMs: number;
}

export interface Stage1Block {
  readonly row0: number;
  readonly col0: number;
  /** Null when the block has no walkable polygon. */
  readonly block: NavBlock | null;
  readonly bytes: Buffer | null;
  /** Every file the block depends on, ascending FileDataID (the ring included, TN-16). */
  readonly inputs: readonly InputFile[];
  /** SHA-256 over the `fileDataId ckey` lines of `inputs` (§5: stage 1 only). */
  readonly inputHash: string;
  readonly stats: Stage1Stats;
}

export const gridOf = (d: Derived): BlockGrid => ({ perAdt: d.perAdt, blockAdts: d.settings.blockAdts, tileVoxels: d.settings.tileVoxels });

/** SHA-256 over sorted `fileDataId ckey` lines. */
export function inputHash(inputs: readonly InputFile[]): string {
  const sorted = [...inputs].sort((a, b) => a.fileDataId - b.fileDataId);
  const h = createHash('sha256');
  for (const f of sorted) h.update(`${String(f.fileDataId)} ${f.ckey}\n`);
  return h.digest('hex');
}

export function stage1Inputs(casc: LocalCasc, tables: ClientTables, mapId: number, wdt: Wdt, present: ReadonlySet<number>, derived: Derived, wdtInput: InputFile, source: FileSource): Stage1Inputs {
  return { mapId, wdt, present, derived, tables, source, ckey: (id) => ckeyOf(casc, id), sharedInputs: [wdtInput, ...tables.tableInputs] };
}

/** Builds one block; `blockAdts` other than the setting's is for the partition-invariance check (G4). */
export function buildStage1Block(
  inp: Stage1Inputs,
  row0: number,
  col0: number,
  options: { readonly blockAdts?: number; readonly hook?: PolyMeshHook; /** Receives the raw Recast tiles (the adjacency check). */ readonly keepRecastTiles?: RecastTile[] } = {},
): Stage1Block {
  const d = inp.derived;
  const s = d.settings;
  const size = options.blockAdts ?? s.blockAdts;
  const t0 = performance.now();
  const tiles = blockTiles(row0, col0, size).filter((t) => inp.present.has(t.row * 64 + t.col));
  const g = blockGeometry(inp.source, inp.wdt, tiles, {
    clip: expandRect(blockRect(row0, col0, size), s.clipMarginYd),
    swimDepth: s.swimDepthYd,
    m2MinFootprint: s.m2MinFootprintYd,
    hazardLiquids: inp.tables.hazardLiquids,
    wmoAreas: inp.tables.wmoAreas,
  });
  const t1 = performance.now();
  const built = buildBlockTiles(g, d, row0, col0, size, options.hook);
  const t2 = performance.now();
  options.keepRecastTiles?.push(...built.tiles);
  const kept: NavTile[] = [];
  for (const t of built.tiles) {
    const k = keepTile(t);
    if (k !== null) kept.push(k);
  }
  const zi = zoneIndex(g);
  const zoneList: number[] = [];
  let fromTriangle = 0;
  let vertices = 0;
  for (const t of kept) {
    vertices += t.verts.length / 3;
    for (const vs of t.polys) {
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const v of vs) {
        sx += worldX(d, t.tx, t.verts[v * 3] ?? 0);
        sy += worldY(d, t.tz, t.verts[v * 3 + 2] ?? 0);
        sz += worldZ(d, t.originStep, t.verts[v * 3 + 1] ?? 0);
      }
      const hit = areaAt(zi, sx / vs.length, sy / vs.length, sz / vs.length);
      if (hit.fromTriangle) fromTriangle += 1;
      zoneList.push(topZone(inp.tables.parents, hit.area));
    }
  }
  const block: NavBlock | null = kept.length === 0 ? null : { mapId: inp.mapId, row0, col0, blockStep: 0, tiles: kept, zones: Int32Array.from(zoneList) };
  const bytes = block === null ? null : encodeBlock(block, { ...gridOf(d), blockAdts: size });
  const inputs = [...inp.sharedInputs, ...g.inputs.map((id) => ({ fileDataId: id, ckey: inp.ckey(id) }))].sort((a, b) => a.fileDataId - b.fileDataId);
  const t3 = performance.now();
  return {
    row0,
    col0,
    block,
    bytes,
    inputs,
    inputHash: inputHash(inputs),
    stats: {
      triangles: g.triangleCount,
      geometry: g.stats,
      recast: built.stats,
      polygonsKept: zoneList.length,
      verticesKept: vertices,
      tilesKept: kept.length,
      zoneFromTriangle: fromTriangle,
      geometryMs: t1 - t0,
      recastMs: t2 - t1,
      exportMs: t3 - t2,
    },
  };
}
