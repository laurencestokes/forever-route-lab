import { worldMapId, type WorldMapId } from '../../domain/ids';
import type { WorldPoint } from '../../domain/points';
import { joinUrl } from '../http';

/**
 * The committed terrain byproducts (`public/maps/terrain/`; terrain-navigation.md §13.1-§13.3;
 * D-032), checked by hand-written guards: the manifest (per world map, its relief image and its
 * zone-outline and coastline arc files, each with its SHA-256 and world rectangle), and the arc
 * files themselves, decoded to world points.
 *
 * Arc files (`<mapId>/zones.json`, `<mapId>/coast.json`) hold 1-yd integers, delta-coded: a zone
 * arc is `[left, right, x0, y0, dx1, dy1, …]` (the AreaTable ids on either side, then its points),
 * a coast arc `[x0, y0, dx1, dy1, …]` (land on the left). World x runs north and y west. The loader
 * verifies each file's bytes against the manifest's SHA-256 before parsing (`map-resources.ts`).
 */

export { TERRAIN_MANIFEST_PATH, TERRAIN_NOTICE_PATH } from './terrain-paths';
const TERRAIN_DIR = 'maps/terrain/';

export type TerrainArcKind = 'zones' | 'coast';

/** A world rectangle in yards on one world map. */
export interface TerrainRect {
  readonly mapId: WorldMapId;
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

/** A JSON arc file the manifest lists: where it is, and the hash its bytes must have. */
export interface TerrainArcFile {
  readonly kind: TerrainArcKind;
  readonly mapId: WorldMapId;
  /** Relative to the app's base (`maps/terrain/1/zones.json`). */
  readonly path: string;
  readonly url: string;
  readonly sha256: string;
  /** The manifest's arc count, checked against the file. */
  readonly arcs: number;
}

export interface TerrainRelief {
  readonly mapId: WorldMapId;
  readonly url: string;
  /** The world rectangle the whole image covers (the ADT grid of the map's present tiles). */
  readonly bounds: TerrainRect;
  readonly width: number;
  readonly height: number;
  /** Yards per pixel. */
  readonly pixelYd: number;
}

/** One world map's byproducts. */
export interface TerrainMap {
  readonly mapId: WorldMapId;
  readonly name: string;
  readonly relief: TerrainRelief | null;
  readonly zones: TerrainArcFile | null;
  readonly coast: TerrainArcFile | null;
}

export interface TerrainManifest {
  /** The client build the byproducts were derived from. */
  readonly build: string;
  /** Ascending by world map. */
  readonly maps: readonly TerrainMap[];
}

/** A decoded arc file. */
export interface TerrainArcs {
  readonly kind: TerrainArcKind;
  readonly mapId: WorldMapId;
  /** Every arc as world points, in file order; each has at least two points. */
  readonly lines: readonly (readonly WorldPoint[])[];
  /** Zone arcs only: the AreaTable ids left and right of each line (0 for unassigned chunks); empty for the coast. */
  readonly sides: readonly (readonly [number, number])[];
}

type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isPositiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const isMapId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const HEX64 = /^[0-9a-f]{64}$/;
/** `<mapId>/zones.json`, `<mapId>/coast.json`, `<mapId>/relief.png`: the only files `tools/terrain/byproducts.ts` writes. */
const TERRAIN_FILE = /^(0|[1-9][0-9]*)\/(zones\.json|coast\.json|relief\.png)$/;

function readRect(value: unknown, mapId: WorldMapId, where: string): TerrainRect | string {
  if (!isRecord(value)) return `${where} must be an object`;
  const { xMin, xMax, yMin, yMax } = value;
  if (![xMin, xMax, yMin, yMax].every(isFiniteNumber)) return `${where} needs four finite edges`;
  const rect = { mapId, xMin: xMin as number, xMax: xMax as number, yMin: yMin as number, yMax: yMax as number };
  if (rect.xMax <= rect.xMin || rect.yMax <= rect.yMin) return `${where} is empty`;
  return rect;
}

interface MutableMap {
  readonly mapId: WorldMapId;
  readonly name: string;
  relief: TerrainRelief | null;
  zones: TerrainArcFile | null;
  coast: TerrainArcFile | null;
}

/** The manifest's world maps and files, or why it cannot be used (one malformed entry refuses it all). */
export function parseTerrainManifest(json: unknown, baseUrl: string): TerrainManifest | string {
  if (!isRecord(json)) return 'not an object';
  if (json['schema'] !== 1) return 'schema is not 1';
  if (json['kind'] !== 'terrain-byproducts') return 'kind is not terrain-byproducts';
  const client = json['client'];
  const build = isRecord(client) ? client['version'] : undefined;
  if (typeof build !== 'string') return 'client.version is missing';
  const maps = json['maps'];
  const files = json['files'];
  if (!Array.isArray(maps)) return 'maps must be an array';
  if (!Array.isArray(files)) return 'files must be an array';
  const byMap = new Map<number, MutableMap>();
  for (const [index, value] of maps.entries()) {
    const where = `maps[${String(index)}]`;
    if (!isRecord(value) || !isMapId(value['mapId']) || typeof value['name'] !== 'string') return `${where} needs a mapId and a name`;
    if (byMap.has(value['mapId'])) return `${where} repeats map ${String(value['mapId'])}`;
    byMap.set(value['mapId'], { mapId: worldMapId(value['mapId']), name: value['name'], relief: null, zones: null, coast: null });
  }
  for (const [index, value] of files.entries()) {
    const where = `files[${String(index)}]`;
    if (!isRecord(value)) return `${where} must be an object`;
    const { path, mapId, sha256, kind } = value;
    const match = typeof path === 'string' ? TERRAIN_FILE.exec(path) : null;
    if (typeof path !== 'string' || match === null) return `${where}.path must be <mapId>/zones.json, coast.json or relief.png`;
    if (!isMapId(mapId) || String(mapId) !== match[1]) return `${where}.mapId must be the map its path names`;
    const map = byMap.get(mapId);
    if (map === undefined) return `${where}: map ${String(mapId)} is not in maps`;
    if (typeof sha256 !== 'string' || !HEX64.test(sha256)) return `${where}.sha256 must be a SHA-256 hex digest`;
    const rect = readRect(value['rect'], map.mapId, `${where}.rect`);
    if (typeof rect === 'string') return rect;
    const relative = `${TERRAIN_DIR}${path}`;
    const url = joinUrl(baseUrl, relative);
    const fileName = match[2];
    if (fileName === 'relief.png') {
      const { width, height, pixelYd, contentType } = value;
      if (kind !== 'relief' || contentType !== 'image/png') return `${where} must be kind relief, image/png`;
      if (!isPositiveInteger(width) || !isPositiveInteger(height) || !isFiniteNumber(pixelYd) || pixelYd <= 0) {
        return `${where} needs a positive pixel size and pixelYd`;
      }
      if (map.relief !== null) return `${where} repeats map ${String(mapId)}'s relief`;
      map.relief = { mapId: map.mapId, url, bounds: rect, width, height, pixelYd };
      continue;
    }
    const arcKind: TerrainArcKind = fileName === 'zones.json' ? 'zones' : 'coast';
    if (kind !== arcKind) return `${where}.kind must be ${arcKind}`;
    const arcs = value['arcs'];
    if (!Number.isSafeInteger(arcs) || (arcs as number) < 0) return `${where}.arcs must be a count`;
    if (map[arcKind] !== null) return `${where} repeats map ${String(mapId)}'s ${arcKind}`;
    map[arcKind] = { kind: arcKind, mapId: map.mapId, path: relative, url, sha256, arcs: arcs as number };
  }
  return { build, maps: [...byMap.values()].sort((a, b) => a.mapId - b.mapId) };
}

/**
 * Decodes an arc file (already hash-checked) for `expected`, or says why it cannot be used: the
 * wrong kind or world map, a malformed arc, or a count other than the manifest's.
 */
export function parseTerrainArcs(json: unknown, expected: TerrainArcFile): TerrainArcs | string {
  if (!isRecord(json)) return 'not an object';
  const kindName = expected.kind === 'zones' ? 'terrain-zones' : 'terrain-coast';
  if (json['schema'] !== 1 || json['kind'] !== kindName) return `not a schema 1 ${kindName} file`;
  if (json['mapId'] !== expected.mapId) return `its mapId is not ${String(expected.mapId)}`;
  if (json['units'] !== 'yd') return 'units are not yd';
  const arcs = json['arcs'];
  if (!Array.isArray(arcs)) return 'arcs must be an array';
  if (arcs.length !== expected.arcs) return `${String(arcs.length)} arcs, the manifest records ${String(expected.arcs)}`;
  const zones = expected.kind === 'zones' ? json['zones'] : [];
  if (!Array.isArray(zones) || !zones.every((id) => isPositiveInteger(id))) return 'zones must be AreaTable ids';
  const known = new Set<number>([0, ...zones]);
  const head = expected.kind === 'zones' ? 2 : 0;
  const mapId = expected.mapId;
  const lines: (readonly WorldPoint[])[] = [];
  const sides: (readonly [number, number])[] = [];
  for (const [index, arc] of arcs.entries()) {
    const where = `arcs[${String(index)}]`;
    if (!Array.isArray(arc) || arc.length < head + 4 || (arc.length - head) % 2 !== 0) return `${where} must hold at least two points`;
    if (!arc.every((value) => Number.isSafeInteger(value))) return `${where} must hold integers`;
    const values = arc as readonly number[];
    if (head === 2) {
      const left = values[0] ?? -1;
      const right = values[1] ?? -1;
      if (!known.has(left) || !known.has(right)) return `${where} names a zone the file does not list`;
      sides.push([left, right]);
    }
    const points: WorldPoint[] = [];
    let x = 0;
    let y = 0;
    for (let i = head; i < values.length; i += 2) {
      x += values[i] ?? 0;
      y += values[i + 1] ?? 0;
      points.push({ mapId, x, y });
    }
    lines.push(points);
  }
  return { kind: expected.kind, mapId, lines, sides };
}
