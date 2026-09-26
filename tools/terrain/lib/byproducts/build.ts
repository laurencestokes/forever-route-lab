import { createHash } from 'node:crypto';
import { inputHash, type ClientInput } from '../../../casc/input-hash';
import { parseAdtRoot } from '../formats/adt';
import { parseWdt } from '../formats/wdt';
import { boundaryArcs, encodePoints, type Arc } from './arcs';
import { addTile, boundsRect, COAST_CELL_YD, createGrids, HEIGHT_SAMPLE_YD, MIN_WATER_DEPTH_YD, tileBounds, ZONE_CELL_YD, type MapGrids } from './grids';
import { palettePng } from './png';
import { indicesSha256, RELIEF_EXAGGERATION, RELIEF_FACTOR, RELIEF_LEVELS, RELIEF_LIGHT, RELIEF_PALETTE, shadedRelief } from './relief';
import { terrainNoticeText } from './notice';

/**
 * The terrain byproducts in memory (terrain-navigation.md §13; D-032; step 3b.7): per world map,
 * zone outline arcs (`zones.json`), coastline arcs (`coast.json`) and a 4-bit shaded relief
 * (`relief.png`), plus `manifest.json` and `NOTICE.md`. `byproducts.ts` feeds it from the client
 * through tools/casc; tests feed it synthetic WDTs and ADTs. It never touches the file system.
 */

export const TERRAIN_DIR = 'public/maps/terrain';
export const TERRAIN_MANIFEST_FILE = 'manifest.json';
export const TERRAIN_NOTICE_FILE = 'NOTICE.md';
export const TERRAIN_BUDGET_GZIP_BYTES = 600_000;
export const TERRAIN_TOOL_DIRS: readonly string[] = ['tools/casc', 'tools/terrain'];

export const ZONE_SIMPLIFY_YD = 8;
export const COAST_SIMPLIFY_YD = 4;
export const ARC_QUANTUM_YD = 1;
const LAND = 1;
const WATER = 2;

export const ORIENTATION =
  'On a map drawn with east to the right and north up (east = -Y, north = +X), label `left` lies left of the arc direction; arcs are stored with left < right. Coast arcs have land on the left.';

export interface TableInput {
  readonly table: string;
  readonly fileDataId: number;
  readonly ckey: string;
  readonly rows: number;
}

export interface WorldMap {
  readonly mapId: number;
  readonly name: string;
  readonly wdtFileDataId: number;
}

export interface ByproductSource {
  /** AreaTable ID → ParentAreaID. */
  readonly parents: ReadonlyMap<number, number>;
  /** Hazard LiquidType IDs (magma, slime). */
  readonly hazard: ReadonlySet<number>;
  /** The DB2 tables read (AreaTable, LiquidType, Map). */
  readonly tables: readonly TableInput[];
  /** A client file's bytes and CKey; must throw when it is missing or encrypted. */
  readonly read: (fileDataId: number) => { readonly data: Buffer; readonly ckey: string };
}

export interface ByproductOptions {
  readonly client: { readonly product: string; readonly version: string; readonly buildKey: string };
  readonly toolTrees: { readonly trees: Readonly<Record<string, string>>; readonly method: string };
  readonly zlib: string;
}

export interface ByproductFile {
  readonly path: string;
  readonly bytes: Buffer;
  readonly meta: Readonly<Record<string, unknown>>;
}

export interface MapByproducts {
  readonly files: readonly ByproductFile[];
  readonly entry: Readonly<Record<string, unknown>>;
  /** The (FileDataID, CKey) list of the map's input hash. */
  readonly inputs: readonly ClientInput[];
  readonly grids: MapGrids;
  readonly zoneArcs: readonly Arc[];
  readonly coastArcs: readonly Arc[];
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const compact = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value)}\n`);

export function mapByproducts(map: WorldMap, source: ByproductSource): MapByproducts {
  const wdtFile = source.read(map.wdtFileDataId);
  const inputs: ClientInput[] = [{ fileDataId: map.wdtFileDataId, ckey: wdtFile.ckey }, ...source.tables.map((t) => ({ fileDataId: t.fileDataId, ckey: t.ckey }))];
  const tiles = parseWdt(wdtFile.data).tiles.filter((t) => t.rootAdt !== 0);
  const bounds = tileBounds(tiles);
  const grids = createGrids(bounds);
  for (const tile of tiles) {
    const file = source.read(tile.rootAdt);
    inputs.push({ fileDataId: tile.rootAdt, ckey: file.ckey });
    addTile(grids, tile, parseAdtRoot(file.data), source.parents, source.hazard);
  }
  const rect = boundsRect(bounds);
  const zoneGrid = { rows: grids.chunkRows, cols: grids.chunkCols, x0: grids.x0, y0: grids.y0, cell: ZONE_CELL_YD };
  const zoneArcs = boundaryArcs((r, c) => grids.zone[r * grids.chunkCols + c] ?? 0, zoneGrid, ZONE_SIMPLIFY_YD);
  const coastGrid = { rows: grids.quadRows, cols: grids.quadCols, x0: grids.x0, y0: grids.y0, cell: COAST_CELL_YD };
  const coastArcs = boundaryArcs((r, c) => grids.water[r * grids.quadCols + c] ?? 0, coastGrid, COAST_SIMPLIFY_YD, (a, b) => a === LAND && b === WATER);
  const zones = [...new Set(grids.zone)].filter((z) => z !== 0).sort((a, b) => a - b);
  const prefix = String(map.mapId);
  const generated = { by: 'tools/terrain byproducts', notice: `../${TERRAIN_NOTICE_FILE}` };
  const zonesBytes = compact({
    _generated: generated,
    schema: 1,
    kind: 'terrain-zones',
    mapId: map.mapId,
    units: 'yd',
    zones,
    arcs: zoneArcs.map((a) => [a.left, a.right, ...encodePoints(a.points, ARC_QUANTUM_YD)]),
  });
  const coastBytes = compact({
    _generated: generated,
    schema: 1,
    kind: 'terrain-coast',
    mapId: map.mapId,
    units: 'yd',
    arcs: coastArcs.map((a) => encodePoints(a.points, ARC_QUANTUM_YD)),
  });
  const relief = shadedRelief(grids);
  const png = palettePng(relief.width, relief.height, relief.indices, 4, RELIEF_PALETTE, 0);
  const vertices = (arcs: readonly Arc[]): number => arcs.reduce((n, a) => n + a.points.length / 2, 0);
  const files: ByproductFile[] = [
    { path: `${prefix}/zones.json`, bytes: zonesBytes, meta: { kind: 'zones', arcs: zoneArcs.length, vertices: vertices(zoneArcs), zones: zones.length } },
    { path: `${prefix}/coast.json`, bytes: coastBytes, meta: { kind: 'coast', arcs: coastArcs.length, vertices: vertices(coastArcs) } },
    {
      path: `${prefix}/relief.png`,
      bytes: png,
      meta: { kind: 'relief', contentType: 'image/png', width: relief.width, height: relief.height, pixelYd: relief.pixelYd, indicesSha256: indicesSha256(relief) },
    },
  ];
  const entry = {
    mapId: map.mapId,
    name: map.name,
    wdt: map.wdtFileDataId,
    tiles: tiles.length,
    tileRows: [bounds.row0, bounds.row1],
    tileCols: [bounds.col0, bounds.col1],
    rect,
    inputFiles: new Set(inputs.map((i) => i.fileDataId)).size,
    inputHash: inputHash(inputs),
  };
  return { files, entry, inputs, grids, zoneArcs, coastArcs };
}

export interface TerrainBuild {
  readonly maps: readonly MapByproducts[];
  readonly manifestText: string;
  readonly noticeText: string;
}

export function terrainManifest(maps: readonly MapByproducts[], source: ByproductSource, options: ByproductOptions): Readonly<Record<string, unknown>> {
  return {
    _generated: {
      by: 'tools/terrain byproducts',
      notice: TERRAIN_NOTICE_FILE,
      edit: 'do not edit; regenerate with pnpm tsx tools/terrain/byproducts.ts (needs the pinned client at WOW_INSTALL)',
    },
    schema: 1,
    kind: 'terrain-byproducts',
    derivedFrom: 'World of Warcraft: Forever client terrain data (MCNK heights, liquids, per-chunk AreaTable ids); not game files and not the painted map art',
    decision: 'D-032',
    client: options.client,
    tool: { toolTreeHash: options.toolTrees.trees, treeMethod: options.toolTrees.method, zlib: options.zlib },
    parameters: {
      zones: { cellYd: ZONE_CELL_YD, simplifyYd: ZONE_SIMPLIFY_YD, quantumYd: ARC_QUANTUM_YD, rollUp: 'AreaTable.ParentAreaID to a row whose parent is 0' },
      coast: { cellYd: COAST_CELL_YD, simplifyYd: COAST_SIMPLIFY_YD, quantumYd: ARC_QUANTUM_YD, minWaterDepthYd: MIN_WATER_DEPTH_YD, hazards: 'LiquidType SoundBank 2 or 3 are not water' },
      relief: {
        pixelYd: HEIGHT_SAMPLE_YD * RELIEF_FACTOR,
        light: RELIEF_LIGHT,
        exaggeration: RELIEF_EXAGGERATION,
        palette: `0 transparent, 1 water, 2-${String(1 + RELIEF_LEVELS)} grey`,
        encoding: 'PNG colour type 3, 4 bits, deflate level 9 (node:zlib)',
      },
      orientation: ORIENTATION,
      inputHash: 'SHA-256 over "<FileDataID> <CKey>\\n" lines, ascending: the WDT, every root ADT, and the AreaTable, LiquidType and Map DB2 files',
    },
    tables: source.tables,
    maps: maps.map((m) => m.entry),
    files: maps.flatMap((m) =>
      m.files.map((f) => ({ path: f.path, mapId: (m.entry as { mapId: number }).mapId, bytes: f.bytes.length, sha256: sha256(f.bytes), rect: (m.entry as { rect: unknown }).rect, ...f.meta })),
    ),
  };
}

export function buildTerrain(worldMaps: readonly WorldMap[], source: ByproductSource, options: ByproductOptions): TerrainBuild {
  const maps = [...worldMaps].sort((a, b) => a.mapId - b.mapId).map((m) => mapByproducts(m, source));
  const manifest = terrainManifest(maps, source, options);
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  return { maps, manifestText, noticeText: terrainNoticeText(manifest) };
}
