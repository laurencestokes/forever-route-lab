import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { ATLAS_LAYOUT, type AtlasLayout } from '../../../src/geo/atlas-layout';
import { parseGeometryFile } from '../../../src/geo/geometry';
import type { MapGeometry } from '../../../src/geo/types';
import type { LocalCasc } from '../../casc/casc';
import { readDb2 } from '../../casc/db2';
import { DB2 } from '../../casc/layouts';
import { hazardLiquidTypes } from '../../terrain/lib/formats/liquid';
import { parseWdt } from '../../terrain/lib/formats/wdt';
import { GEOMETRY_FILE, PLACEHOLDER_DIR } from './shared';
import { lfBytes, sha256Hex } from './hash';
import { MinimapInputError } from './minimap-decode';
import { reliefClasses, type ReliefClasses } from './minimap-liquid';
import type { TilePosition } from './minimap-texels';

/**
 * The minimap tool's inputs (docs/research/map-atlas.md §18.2 steps 1-2): the maps of
 * `ATLAS_LAYOUT` (placed and inset: 1, 0 and 2991; the phase maps are never read), their WDTs by
 * `Map.WdtFileDataID`, the MAID entries with a minimap FileDataID (the only way to find the tiles:
 * the legacy `world/minimaps/…` names are not in the root), the root ADTs for the liquid grid, and
 * the `LiquidType` table's hazard ids; from the repository, the committed geometry and the terrain
 * reliefs, checked against the terrain manifest's SHA-256.
 *
 * The client is read-only through `tools/casc` (`.build.info` and `Data/` only). Every file is read
 * with `file()`, which fails on a missing or encrypted file and checks MD5 against the CKey; the
 * build stops then (§18.2 step 2).
 */

export interface FileRef {
  readonly fileDataId: number;
  readonly ckey: string;
}

export interface MinimapTileSource extends TilePosition {
  readonly minimap: FileRef;
  readonly rootAdt: FileRef;
}

export interface MinimapMapSource {
  readonly mapId: number;
  /** `Map.Directory`, the client's folder name. */
  readonly directory: string;
  readonly wdt: FileRef;
  /** Row-major, as the WDT lists them. */
  readonly tiles: readonly MinimapTileSource[];
}

/** What the tool needs of the client (LocalCasc satisfies it; tests pass a synthetic one). */
export interface ClientFileSource {
  /** The decoded file; throws when it is missing, encrypted or corrupt. */
  file(fileDataId: number): { readonly data: Buffer; readonly ckey: string };
  ckeyOf(fileDataId: number): string | null;
}

/** The maps an atlas layout draws: its placed maps (west first), then its insets. */
export function layoutMapIds(layout: AtlasLayout): number[] {
  return [...layout.placed.map((p) => Number(p.mapId)), ...layout.insets.map((i) => Number(i.mapId))];
}

/** MAID discovery for one map: every WDT entry with a minimap FileDataID, with its root ADT. */
export function discoverMinimaps(files: ClientFileSource, mapId: number, directory: string, wdtFileDataId: number): MinimapMapSource {
  const wdtFile = files.file(wdtFileDataId);
  const wdt = parseWdt(wdtFile.data);
  if (!wdt.hasMaid) throw new MinimapInputError(`map ${String(mapId)}: WDT ${String(wdtFileDataId)} has no MAID chunk, so its minimap tiles cannot be found`);
  const tiles: MinimapTileSource[] = [];
  for (const t of wdt.tiles) {
    if (t.minimap === 0) continue;
    if (t.rootAdt === 0) throw new MinimapInputError(`map ${String(mapId)}: minimap tile ${String(t.row)}_${String(t.col)} has no root ADT for the liquid grid`);
    const minimap = files.ckeyOf(t.minimap);
    const root = files.ckeyOf(t.rootAdt);
    if (minimap === null) throw new MinimapInputError(`map ${String(mapId)}: minimap FileDataID ${String(t.minimap)} (tile ${String(t.row)}_${String(t.col)}) is not in the client's root manifest`);
    if (root === null) throw new MinimapInputError(`map ${String(mapId)}: root ADT FileDataID ${String(t.rootAdt)} (tile ${String(t.row)}_${String(t.col)}) is not in the client's root manifest`);
    tiles.push({ row: t.row, col: t.col, minimap: { fileDataId: t.minimap, ckey: minimap }, rootAdt: { fileDataId: t.rootAdt, ckey: root } });
  }
  if (tiles.length === 0) throw new MinimapInputError(`map ${String(mapId)}: the WDT lists no minimap tiles`);
  tiles.sort((a, b) => a.row - b.row || a.col - b.col);
  return { mapId, directory, wdt: { fileDataId: wdtFileDataId, ckey: wdtFile.ckey }, tiles };
}

/** A file's bytes, checked against the CKey the discovery recorded. */
export function readChecked(files: ClientFileSource, ref: FileRef, what: string): Buffer {
  const f = files.file(ref.fileDataId);
  if (f.ckey !== ref.ckey) throw new MinimapInputError(`${what}: FileDataID ${String(ref.fileDataId)} has CKey ${f.ckey}, discovery recorded ${ref.ckey}`);
  return f.data;
}

export interface ClientMinimapTables {
  readonly maps: readonly MinimapMapSource[];
  readonly mapTable: FileRef;
  readonly liquidType: FileRef & { readonly hazardIds: readonly number[] };
}

/** The Map and LiquidType tables and the MAID walk of every map of `layout`. */
export function readClientMinimapTables(casc: LocalCasc, layout: AtlasLayout = ATLAS_LAYOUT): ClientMinimapTables {
  const mapTable = readDb2(casc, DB2.Map);
  const liquids = readDb2(casc, DB2.LiquidType, { requireComplete: true });
  const hazard = hazardLiquidTypes(liquids.rows.map((r) => ({ id: r.id, soundBank: r.num('SoundBank') })));
  const maps = layoutMapIds(layout).map((mapId) => {
    const row = mapTable.byId.get(mapId);
    if (row === undefined) throw new MinimapInputError(`map ${String(mapId)}: no readable Map row`);
    return discoverMinimaps(casc, mapId, row.str('Directory'), row.num('WdtFileDataID'));
  });
  const ckey = (id: number): string => {
    const c = casc.ckeyOf(id);
    if (c === null) throw new MinimapInputError(`FileDataID ${String(id)} is not in the client's root manifest`);
    return c;
  };
  return {
    maps,
    mapTable: { fileDataId: DB2.Map.fileDataId, ckey: ckey(DB2.Map.fileDataId) },
    liquidType: { fileDataId: DB2.LiquidType.fileDataId, ckey: ckey(DB2.LiquidType.fileDataId), hazardIds: [...hazard].sort((a, b) => a - b) },
  };
}

// ---------------------------------------------------------------------------------------------
// Committed inputs

export const TERRAIN_DIR = 'public/maps/terrain';

export interface ReliefInput extends ReliefClasses {
  readonly path: string;
  readonly sha256: string;
}

export interface CommittedMinimapInputs {
  readonly layout: AtlasLayout;
  readonly geometry: MapGeometry;
  readonly reliefs: ReadonlyMap<number, ReliefInput>;
  readonly terrainManifestSha256: string;
}

interface TerrainManifest {
  readonly maps: readonly { readonly mapId: number; readonly tileRows: readonly number[]; readonly tileCols: readonly number[] }[];
  readonly files: readonly { readonly path: string; readonly mapId: number; readonly kind: string; readonly sha256: string }[];
}

/** The committed geometry and the terrain reliefs (maps 0 and 1), each relief checked against the terrain manifest. */
export async function readCommittedMinimapInputs(repoRoot: string): Promise<CommittedMinimapInputs> {
  const geometry = parseGeometryFile(JSON.parse(lfBytes(readFileSync(join(repoRoot, PLACEHOLDER_DIR, GEOMETRY_FILE))).toString('utf8')) as unknown);
  if (!geometry.ok) throw new MinimapInputError(`the committed placeholder geometry does not parse: ${geometry.errors.join('; ')}`);
  const manifestBytes = lfBytes(readFileSync(join(repoRoot, TERRAIN_DIR, 'manifest.json')));
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as TerrainManifest;
  const reliefs = new Map<number, ReliefInput>();
  for (const m of manifest.maps) {
    const file = manifest.files.find((f) => f.mapId === m.mapId && f.kind === 'relief');
    if (file === undefined) continue;
    const png = readFileSync(join(repoRoot, TERRAIN_DIR, file.path));
    if (sha256Hex(png) !== file.sha256) throw new MinimapInputError(`${TERRAIN_DIR}/${file.path}: SHA-256 differs from the terrain manifest`);
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const cls = reliefClasses(m.mapId, new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.width, info.height, m.tileRows[0] ?? 0, m.tileCols[0] ?? 0);
    reliefs.set(m.mapId, { ...cls, path: `${TERRAIN_DIR}/${file.path}`, sha256: file.sha256 });
  }
  return { layout: ATLAS_LAYOUT, geometry: geometry.geometry, reliefs, terrainManifestSha256: sha256Hex(manifestBytes) };
}
