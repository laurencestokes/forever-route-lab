import { TILE_YD, type NavParams } from './grid';

/**
 * The runtime view of `public/nav/manifest.json` (terrain-navigation.md §5 "Manifest", §14):
 * only what queries need: the navRevision, the grid and snap settings, and per map the block list
 * in canonical order (which defines global polygon ids, never the load order), the `map.bin`
 * entry, the connector and passage id lists that `map.bin` indexes, and the hint roll-up. File
 * hashes and sizes are carried for the worker's fetch verification (step 3b.6). Hand-validated
 * (no zod outside `src/project`); a malformed manifest throws `NavManifestError`.
 */

export class NavManifestError extends Error {
  constructor(message: string) {
    super(`nav manifest: ${message}`);
    this.name = 'NavManifestError';
  }
}

export interface NavFileEntry {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface NavBlockEntry extends NavFileEntry {
  readonly row0: number;
  readonly col0: number;
  readonly polygons: number;
}

export interface NavMapEntry {
  readonly mapId: number;
  readonly name: string;
  /** Total polygons: the sum of the block polygon counts. */
  readonly polygons: number;
  readonly components: number;
  readonly mapFile: NavFileEntry;
  /** Canonical order: global polygon ids follow it. */
  readonly blocks: readonly NavBlockEntry[];
  /** Spawn area keys whose top-level zone differs from the key (AreaTable ParentAreaID roll-up). */
  readonly hintRollup: ReadonlyMap<number, number>;
}

export interface NavManifest {
  readonly navRevision: string;
  readonly params: NavParams;
  /** Connector ids; `map.bin` connector links index this list. */
  readonly connectors: readonly string[];
  /** Passage ids; `map.bin` passage tags index this list. */
  readonly passages: readonly string[];
  readonly maps: readonly NavMapEntry[];
}

type Json = Readonly<Record<string, unknown>>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function obj(v: unknown, where: string): Json {
  if (!isObject(v)) throw new NavManifestError(`${where} is not an object`);
  return v;
}

function num(o: Json, key: string, where: string, check: (n: number) => boolean = Number.isFinite): number {
  const v = o[key];
  if (typeof v !== 'number' || !check(v)) throw new NavManifestError(`${where}.${key} is not a valid number`);
  return v;
}

const nonNegativeInt = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;
const positive = (n: number): boolean => Number.isFinite(n) && n > 0;

function str(o: Json, key: string, where: string, pattern?: RegExp): string {
  const v = o[key];
  if (typeof v !== 'string' || (pattern !== undefined && !pattern.test(v))) throw new NavManifestError(`${where}.${key} is not a valid string`);
  return v;
}

function arr(o: Json, key: string, where: string): readonly unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) throw new NavManifestError(`${where}.${key} is not an array`);
  return v as readonly unknown[];
}

const SHA256 = /^[0-9a-f]{64}$/;
const FILE_PATH = /^[0-9]+\/(?:[0-9]+_[0-9]+|map)\.bin$/;

function fileEntry(v: unknown, where: string): NavFileEntry {
  const o = obj(v, where);
  return { path: str(o, 'path', where, FILE_PATH), bytes: num(o, 'bytes', where, nonNegativeInt), sha256: str(o, 'sha256', where, SHA256) };
}

/** Parses and checks the manifest JSON (already parsed from text). */
export function parseNavManifest(json: unknown): NavManifest {
  const m = obj(json, 'manifest');
  if (m['schema'] !== 1 || m['kind'] !== 'nav-manifest') throw new NavManifestError('not a schema-1 nav-manifest');
  const format = obj(m['format'], 'format');
  if (typeof format['block'] !== 'string' || !format['block'].startsWith('FRN3 v3') || typeof format['mapFile'] !== 'string' || !format['mapFile'].startsWith('FRNM v1')) {
    throw new NavManifestError('unsupported format (expected FRN3 v3 blocks and FRNM v1 map files)');
  }
  const navRevision = str(m, 'navRevision', 'manifest', SHA256);
  const s = obj(m['settings'], 'settings');
  const voxelsPerAdt = num(s, 'voxelsPerAdt', 'settings', (n) => Number.isSafeInteger(n) && n > 0);
  const tileVoxels = num(s, 'tileVoxels', 'settings', (n) => Number.isSafeInteger(n) && n > 0 && voxelsPerAdt % n === 0);
  const blockAdts = num(s, 'blockAdts', 'settings', (n) => Number.isSafeInteger(n) && n > 0 && 64 % n === 0);
  const cs = TILE_YD / voxelsPerAdt;
  const d = obj(m['derived'], 'derived');
  // the build writes the same doubles: JSON numbers round-trip exactly
  if (num(d, 'cellYd', 'derived') !== cs || num(d, 'tileYd', 'derived') !== cs * tileVoxels) throw new NavManifestError('derived cell or tile size does not match the settings');
  const stage2 = obj(obj(m['stage2'], 'stage2')['settings'], 'stage2.settings');
  const snap = obj(stage2['snap'], 'stage2.settings.snap');
  const params: NavParams = {
    cs,
    ch: num(s, 'cellHeightYd', 'settings', positive),
    tileVoxels,
    tileYd: cs * tileVoxels,
    perAdt: voxelsPerAdt / tileVoxels,
    blockAdts,
    mapOriginZ: num(s, 'mapOriginZ', 'settings'),
    climbYd: num(s, 'climbYd', 'settings', positive),
    snapRadiusYd: num(snap, 'radiusYd', 'stage2.settings.snap', positive),
    ruleBMinPolygons: num(snap, 'ruleBMinPolygons', 'stage2.settings.snap', nonNegativeInt),
    longSwimYd: num(stage2, 'longSwimWarningYd', 'stage2.settings', positive),
  };
  const ids = (key: string): readonly string[] =>
    arr(m, key, 'manifest').map((v, i) => {
      if (typeof v !== 'string' || v.length === 0) throw new NavManifestError(`${key}[${String(i)}] is not an id`);
      return v;
    });
  const maps = arr(m, 'maps', 'manifest').map((v, i): NavMapEntry => {
    const where = `maps[${String(i)}]`;
    const e = obj(v, where);
    const mapId = num(e, 'mapId', where, nonNegativeInt);
    const blocks = arr(e, 'blocks', where).map((b, k): NavBlockEntry => {
      const bw = `${where}.blocks[${String(k)}]`;
      const o = obj(b, bw);
      const row0 = num(o, 'row0', bw, (n) => nonNegativeInt(n) && n < 64 && n % blockAdts === 0);
      const col0 = num(o, 'col0', bw, (n) => nonNegativeInt(n) && n < 64 && n % blockAdts === 0);
      const file = fileEntry(o, bw);
      if (file.path !== `${String(mapId)}/${String(row0)}_${String(col0)}.bin`) throw new NavManifestError(`${bw}.path does not name block ${String(row0)}_${String(col0)} of map ${String(mapId)}`);
      return { ...file, row0, col0, polygons: num(o, 'polygons', bw, (n) => Number.isSafeInteger(n) && n > 0) };
    });
    const seen = new Set<string>();
    for (const b of blocks) {
      const key = `${String(b.row0)}_${String(b.col0)}`;
      if (seen.has(key)) throw new NavManifestError(`${where} lists block ${key} twice`);
      seen.add(key);
    }
    const polygons = num(e, 'polygons', where, nonNegativeInt);
    if (blocks.reduce((sum, b) => sum + b.polygons, 0) !== polygons) throw new NavManifestError(`${where}: block polygon counts do not sum to ${String(polygons)}`);
    const mapFile = fileEntry(e['mapFile'], `${where}.mapFile`);
    if (mapFile.path !== `${String(mapId)}/map.bin`) throw new NavManifestError(`${where}.mapFile.path is not ${String(mapId)}/map.bin`);
    const rollup = new Map<number, number>();
    for (const [key, zone] of Object.entries(obj(e['hintRollup'], `${where}.hintRollup`))) {
      const area = Number(key);
      if (!nonNegativeInt(area) || typeof zone !== 'number' || !nonNegativeInt(zone)) throw new NavManifestError(`${where}.hintRollup has a bad entry ${key}`);
      rollup.set(area, zone);
    }
    return { mapId, name: str(e, 'name', where), polygons, components: num(e, 'components', where, nonNegativeInt), mapFile, blocks, hintRollup: rollup };
  });
  if (new Set(maps.map((x) => x.mapId)).size !== maps.length) throw new NavManifestError('duplicate map id');
  return { navRevision, params, connectors: ids('connectors'), passages: ids('passages'), maps };
}

/**
 * The zone hint of a dataset spawn (§8.1): its area key rolled up through `ParentAreaID`, which
 * the manifest records for the keys where the roll-up changes anything.
 */
export const spawnHint = (entry: NavMapEntry, areaKey: number): number => entry.hintRollup.get(areaKey) ?? areaKey;
