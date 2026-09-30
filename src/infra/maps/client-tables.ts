import { type AreaId, areaId, worldMapId, type WorldMapId } from '../../domain/ids';
import type { WorldPoint } from '../../domain/points';
import { sha256Hex } from '../hash';
import { decodeUtf8, joinUrl } from '../http';
import type { MapResourceFailure, MapResourcesOptions } from './map-resources';

/**
 * The committed client tables (`public/maps/client/`; docs/research/map-presentation.md §9, §10,
 * §12.6, §8, §16; D-039 B, C and E), written by `tools/maps/client-tables.ts`:
 *
 * - `taxi.json` (B): the flight nodes on paid paths of maps 0 and 1, the directed flights with
 *   their 3D path lengths (TIME-6) and shapes simplified to 25 yd, and the transport paths' stops;
 * - `zones.json` (C): each world-map zone's `FactionGroupMask` and sanctuary flag (INFERRED
 *   decodes);
 * - `dungeons.json` (E): the dungeon-finder rows with their `ContentTuning` levels, and the
 *   dungeon and raid maps with their `InstanceType`.
 *
 * Loaded lazily and never fatally, like the terrain files (`map-resources.ts`): the manifest is
 * fetched revalidated (`no-cache`) and parsed by hand-written guards; each table file is fetched,
 * its bytes hashed with WebCrypto and compared with the manifest's SHA-256 before it is parsed. A
 * mismatch is fetched once more past the HTTP cache before it fails. Every call resolves to the
 * table or to a `failed` result that says why; the caller then uses its fallback (for flights,
 * TIME-5 and no network lines, §9). Results are memoised per file; a failed request is forgotten
 * so the next call tries again, while a malformed or mismatching file is not.
 *
 * Positions become world points (D-017: world x north, y west); nothing here is an atlas
 * coordinate. Every number keeps the client's value: the decodes the files label INFERRED (faction
 * bits, sanctuary) are passed on as such, and no level, range or position is invented.
 */

export const CLIENT_TABLES_MANIFEST_PATH = 'maps/client/manifest.json';
/** Where the deployed notice is, relative to the app's base. */
export const CLIENT_TABLES_NOTICE_PATH = 'maps/client/NOTICE.md';
const CLIENT_TABLES_DIR = 'maps/client/';

export type ClientTableKind = 'taxi' | 'zones' | 'dungeons';
const FILE_NAMES: Readonly<Record<ClientTableKind, string>> = { taxi: 'taxi.json', zones: 'zones.json', dungeons: 'dungeons.json' };
const KINDS: readonly ClientTableKind[] = ['taxi', 'zones', 'dungeons'];

/** A table file the manifest lists: where it is, the hash its bytes must have, and its recorded counts. */
export interface ClientTableFile {
  readonly kind: ClientTableKind;
  /** Relative to the app's base (`maps/client/taxi.json`). */
  readonly path: string;
  readonly url: string;
  readonly sha256: string;
  /** The manifest's counts for the file (row counts the parsers check). */
  readonly counts: Readonly<Record<string, number>>;
}

export interface ClientTablesManifest {
  /** The client build the tables were read from (`1.60.1.70009`). */
  readonly build: string;
  readonly files: Readonly<Record<ClientTableKind, ClientTableFile>>;
}

/** A flight node (`TaxiNodes` row). `alliance` and `horde` are `Flags` bits 0 and 1, an INFERRED decode. */
export interface ClientTaxiNode {
  readonly id: number;
  readonly name: string;
  readonly point: WorldPoint;
  readonly alliance: boolean;
  readonly horde: boolean;
}

/** A directed flight (`TaxiPath` row with `Cost` > 0). */
export interface ClientTaxiFlight {
  readonly pathId: number;
  readonly from: number;
  readonly to: number;
  /** 3D length along the path's `TaxiPathNode` points, yards (client data, rounded to 1 yd). */
  readonly l3dYards: number;
  /** The path simplified to 25 yd; at least two points, on the nodes' world map. */
  readonly shape: readonly WorldPoint[];
}

export interface ClientTransportStop {
  readonly point: WorldPoint;
  /** `TaxiPathNode.Delay`, seconds. */
  readonly delaySeconds: number;
}

/** A transport path (a `TaxiPath` with stops). Which named service it is stays to be inferred (§10). */
export interface ClientTransportPath {
  readonly pathId: number;
  /** The world maps the path runs through, in order. */
  readonly maps: readonly WorldMapId[];
  readonly stops: readonly ClientTransportStop[];
}

export interface ClientTaxi {
  readonly build: string;
  /** Ascending by id. */
  readonly nodes: readonly ClientTaxiNode[];
  /** Ascending by path id; every `from` and `to` is a node above. */
  readonly flights: readonly ClientTaxiFlight[];
  /** Ascending by path id. */
  readonly transports: readonly ClientTransportPath[];
}

/** A zone's `AreaTable` faction group mask (2 Alliance, 4 Horde, 6 both, 0 none) and sanctuary flag; both INFERRED decodes. */
export interface ClientZone {
  readonly areaId: AreaId;
  readonly mapId: WorldMapId;
  readonly name: string;
  readonly factionGroupMask: number;
  readonly sanctuary: boolean;
}

export interface ClientZones {
  readonly build: string;
  /** Ascending by area id. */
  readonly zones: readonly ClientZone[];
}

/** A dungeon-finder row (`LFGDungeons`, TypeID 0) and its `ContentTuning` row's columns. */
export interface ClientLfgRow {
  readonly id: number;
  readonly name: string;
  readonly contentTuningId: number;
  /** `ContentTuning.MinLevelSquish`: the "LFG tuning level (client), meaning unverified" (D-039 E). */
  readonly minLevelSquish: number;
  readonly maxLevelSquish: number;
  /** 0 means none set. */
  readonly lfgMinLevel: number;
  readonly lfgMaxLevel: number;
}

/** A dungeon (`InstanceType` 1) or raid (2) map and its top-level areas. */
export interface ClientInstanceMap {
  readonly id: WorldMapId;
  readonly name: string;
  readonly instanceType: 1 | 2;
  readonly areaIds: readonly AreaId[];
}

export interface ClientDungeons {
  readonly build: string;
  /** Ascending by row id. */
  readonly lfg: readonly ClientLfgRow[];
  /** Ascending by map id. */
  readonly instanceMaps: readonly ClientInstanceMap[];
  /** Rows of the source tables in encrypted sections, unknown, by table (`LFGDungeons`, `Map`, `AreaTable`). */
  readonly undecodedRows: Readonly<Record<string, number>>;
}

export type ClientTablesManifestLoad = { readonly kind: 'loaded'; readonly manifest: ClientTablesManifest } | MapResourceFailure;
export type ClientTableLoad<T> = { readonly kind: 'loaded'; readonly table: T } | MapResourceFailure;

export interface ClientTables {
  manifest(): Promise<ClientTablesManifestLoad>;
  taxi(): Promise<ClientTableLoad<ClientTaxi>>;
  zones(): Promise<ClientTableLoad<ClientZones>>;
  dungeons(): Promise<ClientTableLoad<ClientDungeons>>;
}

// ---------------------------------------------------------------------------------------------
// Guards

type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number => Number.isSafeInteger(value);
const isId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const isMapId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const HEX64 = /^[0-9a-f]{64}$/;

/** The manifest's three files, or why it cannot be used (one malformed entry refuses it all). */
export function parseClientTablesManifest(json: unknown, baseUrl: string): ClientTablesManifest | string {
  if (!isRecord(json)) return 'not an object';
  if (json['schema'] !== 1) return 'schema is not 1';
  if (json['kind'] !== 'client-tables') return 'kind is not client-tables';
  const client = json['client'];
  const build = isRecord(client) ? client['version'] : undefined;
  if (typeof build !== 'string' || build === '') return 'client.version is missing';
  const files = json['files'];
  if (!Array.isArray(files)) return 'files must be an array';
  const found = new Map<ClientTableKind, ClientTableFile>();
  for (const [index, value] of files.entries()) {
    const where = `files[${String(index)}]`;
    if (!isRecord(value)) return `${where} must be an object`;
    const { path, kind, sha256, counts } = value;
    const tableKind = KINDS.find((k) => k === kind);
    if (tableKind === undefined) return `${where}.kind must be taxi, zones or dungeons`;
    if (path !== FILE_NAMES[tableKind]) return `${where}.path must be ${FILE_NAMES[tableKind]}`;
    if (typeof sha256 !== 'string' || !HEX64.test(sha256)) return `${where}.sha256 must be a SHA-256 hex digest`;
    if (!isRecord(counts)) return `${where}.counts must be an object`;
    const numeric: Record<string, number> = {};
    for (const [key, count] of Object.entries(counts)) if (isInt(count) && count >= 0) numeric[key] = count;
    if (found.has(tableKind)) return `${where} repeats ${tableKind}`;
    const relative = `${CLIENT_TABLES_DIR}${path}`;
    found.set(tableKind, { kind: tableKind, path: relative, url: joinUrl(baseUrl, relative), sha256, counts: numeric });
  }
  const taxi = found.get('taxi');
  const zones = found.get('zones');
  const dungeons = found.get('dungeons');
  if (taxi === undefined || zones === undefined || dungeons === undefined) return 'files must list taxi.json, zones.json and dungeons.json';
  return { build, files: { taxi, zones, dungeons } };
}

function header(json: unknown, kind: string, build: string | null): Json | string {
  if (!isRecord(json)) return 'not an object';
  if (json['schema'] !== 1 || json['kind'] !== kind) return `not a schema 1 ${kind} file`;
  if (typeof json['build'] !== 'string') return 'build is missing';
  if (build !== null && json['build'] !== build) return `its build ${json['build']} is not the manifest's ${build}`;
  return json;
}

function countIs(expected: ClientTableFile, key: string, actual: number, what: string): string | null {
  const recorded = expected.counts[key];
  if (recorded === undefined) return `the manifest records no ${key} count`;
  return recorded === actual ? null : `${String(actual)} ${what}, the manifest records ${String(recorded)}`;
}

/** `[x0, y0, dx1, dy1, …]` to world points, or null when malformed (odd length, fewer than two points, non-integers). */
function decodeShape(value: unknown, mapId: WorldMapId): WorldPoint[] | null {
  if (!Array.isArray(value) || value.length < 4 || value.length % 2 !== 0 || !value.every(isInt)) return null;
  const values = value as readonly number[];
  const points: WorldPoint[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < values.length; i += 2) {
    x += values[i] ?? 0;
    y += values[i + 1] ?? 0;
    points.push({ mapId, x, y });
  }
  return points;
}

const ascending = (ids: readonly number[]): boolean => ids.every((id, i) => i === 0 || (ids[i - 1] ?? 0) < id);

/**
 * Decodes `taxi.json` (already hash-checked) against its manifest entry, or says why it cannot be
 * used: another kind or build, a malformed row, a flight naming a node the file does not list, or
 * counts other than the manifest's. `build` is the manifest's build (null skips that check).
 */
export function parseClientTaxi(json: unknown, expected: ClientTableFile, build: string | null = null): ClientTaxi | string {
  const file = header(json, 'client-taxi', build);
  if (typeof file === 'string') return file;
  if (file['units'] !== 'yd') return 'units are not yd';
  const { nodes, flights, transports } = file;
  if (!Array.isArray(nodes) || !Array.isArray(flights) || !Array.isArray(transports)) return 'nodes, flights and transports must be arrays';
  const nodesOut: ClientTaxiNode[] = [];
  for (const [index, value] of nodes.entries()) {
    const where = `nodes[${String(index)}]`;
    if (!isRecord(value)) return `${where} must be an object`;
    const { id, name, mapId, x, y, alliance, horde } = value;
    if (!isId(id) || typeof name !== 'string' || !isMapId(mapId) || !isInt(x) || !isInt(y) || typeof alliance !== 'boolean' || typeof horde !== 'boolean') {
      return `${where} needs an id, name, mapId, integer x and y, and alliance and horde flags`;
    }
    nodesOut.push({ id, name, point: { mapId: worldMapId(mapId), x, y }, alliance, horde });
  }
  if (!ascending(nodesOut.map((n) => n.id))) return 'nodes must be ascending by id, each once';
  const nodeMap = new Map(nodesOut.map((n) => [n.id, n.point.mapId]));
  const flightsOut: ClientTaxiFlight[] = [];
  for (const [index, value] of flights.entries()) {
    const where = `flights[${String(index)}]`;
    if (!isRecord(value)) return `${where} must be an object`;
    const { pathId, from, to, l3d, shape } = value;
    if (!isId(pathId) || !isId(from) || !isId(to) || !isInt(l3d) || l3d <= 0) return `${where} needs a pathId, from, to and a positive l3d`;
    const fromMap = nodeMap.get(from);
    const toMap = nodeMap.get(to);
    if (fromMap === undefined || toMap === undefined) return `${where} names a node the file does not list`;
    if (fromMap !== toMap) return `${where} joins two world maps`;
    const points = decodeShape(shape, fromMap);
    if (points === null) return `${where}.shape must hold at least two integer points`;
    flightsOut.push({ pathId, from, to, l3dYards: l3d, shape: points });
  }
  if (!ascending(flightsOut.map((f) => f.pathId))) return 'flights must be ascending by path id, each once';
  const transportsOut: ClientTransportPath[] = [];
  for (const [index, value] of transports.entries()) {
    const where = `transports[${String(index)}]`;
    if (!isRecord(value)) return `${where} must be an object`;
    const { pathId, maps, stops } = value;
    if (!isId(pathId) || !Array.isArray(maps) || maps.length === 0 || !maps.every(isMapId) || !Array.isArray(stops) || stops.length === 0) {
      return `${where} needs a pathId, its maps and at least one stop`;
    }
    const stopsOut: ClientTransportStop[] = [];
    for (const stop of stops) {
      if (!Array.isArray(stop) || stop.length !== 4 || !stop.every(isInt)) return `${where}.stops must be [mapId, x, y, delay] integer rows`;
      const [mapId, x, y, delay] = stop as readonly number[];
      if (mapId === undefined || x === undefined || y === undefined || delay === undefined || mapId < 0 || delay <= 0 || !maps.includes(mapId)) {
        return `${where}.stops must lie on the path's maps with a positive delay`;
      }
      stopsOut.push({ point: { mapId: worldMapId(mapId), x, y }, delaySeconds: delay });
    }
    transportsOut.push({ pathId, maps: maps.map((m) => worldMapId(m)), stops: stopsOut });
  }
  if (!ascending(transportsOut.map((t) => t.pathId))) return 'transports must be ascending by path id, each once';
  const problem =
    countIs(expected, 'nodes', nodesOut.length, 'nodes') ??
    countIs(expected, 'flights', flightsOut.length, 'flights') ??
    countIs(expected, 'transports', transportsOut.length, 'transport paths') ??
    countIs(expected, 'stops', transportsOut.reduce((n, t) => n + t.stops.length, 0), 'transport stops');
  if (problem !== null) return problem;
  return { build: file['build'] as string, nodes: nodesOut, flights: flightsOut, transports: transportsOut };
}

/** Decodes `zones.json` (already hash-checked), or says why it cannot be used. */
export function parseClientZones(json: unknown, expected: ClientTableFile, build: string | null = null): ClientZones | string {
  const file = header(json, 'client-zones', build);
  if (typeof file === 'string') return file;
  const zones = file['zones'];
  if (!Array.isArray(zones)) return 'zones must be an array';
  const out: ClientZone[] = [];
  for (const [index, value] of zones.entries()) {
    const where = `zones[${String(index)}]`;
    if (!isRecord(value)) return `${where} must be an object`;
    const { areaId: id, mapId, name, factionGroupMask, sanctuary } = value;
    if (!isId(id) || !isMapId(mapId) || typeof name !== 'string' || !isInt(factionGroupMask) || factionGroupMask < 0 || typeof sanctuary !== 'boolean') {
      return `${where} needs an areaId, mapId, name, factionGroupMask and sanctuary flag`;
    }
    out.push({ areaId: areaId(id), mapId: worldMapId(mapId), name, factionGroupMask, sanctuary });
  }
  if (!ascending(out.map((z) => z.areaId))) return 'zones must be ascending by areaId, each once';
  const problem = countIs(expected, 'zones', out.length, 'zones');
  if (problem !== null) return problem;
  return { build: file['build'] as string, zones: out };
}

/** Decodes `dungeons.json` (already hash-checked), or says why it cannot be used. */
export function parseClientDungeons(json: unknown, expected: ClientTableFile, build: string | null = null): ClientDungeons | string {
  const file = header(json, 'client-dungeons', build);
  if (typeof file === 'string') return file;
  const { lfg, instanceMaps, undecoded } = file;
  if (!Array.isArray(lfg) || !Array.isArray(instanceMaps)) return 'lfg and instanceMaps must be arrays';
  const tables = isRecord(undecoded) ? undecoded['tables'] : undefined;
  if (!isRecord(tables)) return 'undecoded.tables must be an object';
  const undecodedRows: Record<string, number> = {};
  for (const [table, entry] of Object.entries(tables)) {
    const rows = isRecord(entry) ? entry['rows'] : undefined;
    if (!isId(rows)) return `undecoded.tables.${table}.rows must be a positive count`;
    undecodedRows[table] = rows;
  }
  const lfgOut: ClientLfgRow[] = [];
  for (const [index, value] of lfg.entries()) {
    const where = `lfg[${String(index)}]`;
    if (!isRecord(value)) return `${where} must be an object`;
    const { id, name, contentTuningId, minLevelSquish, maxLevelSquish, lfgMinLevel, lfgMaxLevel } = value;
    if (!isId(id) || typeof name !== 'string' || !isId(contentTuningId) || ![minLevelSquish, maxLevelSquish, lfgMinLevel, lfgMaxLevel].every((v) => isInt(v) && v >= 0)) {
      return `${where} needs an id, name, contentTuningId and four non-negative levels`;
    }
    lfgOut.push({
      id,
      name,
      contentTuningId,
      minLevelSquish: minLevelSquish as number,
      maxLevelSquish: maxLevelSquish as number,
      lfgMinLevel: lfgMinLevel as number,
      lfgMaxLevel: lfgMaxLevel as number,
    });
  }
  if (!ascending(lfgOut.map((r) => r.id))) return 'lfg must be ascending by id, each once';
  const mapsOut: ClientInstanceMap[] = [];
  for (const [index, value] of instanceMaps.entries()) {
    const where = `instanceMaps[${String(index)}]`;
    if (!isRecord(value)) return `${where} must be an object`;
    const { id, name, instanceType, areaIds } = value;
    if (!isId(id) || typeof name !== 'string' || (instanceType !== 1 && instanceType !== 2) || !Array.isArray(areaIds) || !areaIds.every(isId) || !ascending(areaIds)) {
      return `${where} needs an id, name, instanceType 1 or 2 and ascending areaIds`;
    }
    mapsOut.push({ id: worldMapId(id), name, instanceType, areaIds: areaIds.map((a) => areaId(a)) });
  }
  if (!ascending(mapsOut.map((m) => m.id))) return 'instanceMaps must be ascending by id, each once';
  const problem = countIs(expected, 'lfgRows', lfgOut.length, 'LFG rows') ?? countIs(expected, 'instanceMaps', mapsOut.length, 'instance maps');
  if (problem !== null) return problem;
  return { build: file['build'] as string, lfg: lfgOut, instanceMaps: mapsOut, undecodedRows };
}

// ---------------------------------------------------------------------------------------------
// Loading

const short = (hash: string): string => `${hash.slice(0, 12)}…`;

function parseJson(bytes: ArrayBuffer): unknown {
  try {
    return JSON.parse(decodeUtf8(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

/** Loads the committed client tables lazily, verified against the manifest's SHA-256 (see the module comment). */
export function createClientTables(opts: MapResourcesOptions): ClientTables {
  const unavailable = (detail: string): MapResourceFailure => ({ kind: 'failed', reason: 'unavailable', detail });
  const invalid = (detail: string): MapResourceFailure => ({ kind: 'failed', reason: 'invalid', detail });

  async function get(path: string, cache: RequestCache): Promise<{ readonly kind: 'ok'; readonly bytes: ArrayBuffer } | MapResourceFailure> {
    try {
      const response = await opts.fetch(joinUrl(opts.baseUrl, path), { cache });
      if (!response.ok) return unavailable(`${path}: HTTP ${String(response.status)}`);
      return { kind: 'ok', bytes: await response.arrayBuffer() };
    } catch (error) {
      return unavailable(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const cache = new Map<string, Promise<{ readonly kind: string }>>();
  /** One promise per key; a result that may succeed later (`unavailable`) is forgotten. */
  function memo<T extends { readonly kind: string }>(key: string, load: () => Promise<T>): Promise<T> {
    const cached = cache.get(key);
    if (cached !== undefined) return cached as Promise<T>;
    const pending = load().then((result) => {
      if ('reason' in result && result.reason === 'unavailable') cache.delete(key);
      return result;
    });
    cache.set(key, pending);
    return pending;
  }

  const manifest = (): Promise<ClientTablesManifestLoad> =>
    memo('manifest', async (): Promise<ClientTablesManifestLoad> => {
      const fetched = await get(CLIENT_TABLES_MANIFEST_PATH, 'no-cache');
      if (fetched.kind === 'failed') return fetched;
      const json = parseJson(fetched.bytes);
      // A deployed site without the file may answer with its fallback page.
      if (json === undefined) return invalid(`${CLIENT_TABLES_MANIFEST_PATH} is not JSON`);
      const parsed = parseClientTablesManifest(json, opts.baseUrl);
      return typeof parsed === 'string' ? invalid(`${CLIENT_TABLES_MANIFEST_PATH}: ${parsed}`) : { kind: 'loaded', manifest: parsed };
    });

  function table<T>(kind: ClientTableKind, parse: (json: unknown, expected: ClientTableFile, build: string) => T | string): Promise<ClientTableLoad<T>> {
    return memo(kind, async (): Promise<ClientTableLoad<T>> => {
      const index = await manifest();
      if (index.kind === 'failed') return index;
      const file = index.manifest.files[kind];
      const sha256 = opts.sha256;
      if (sha256 === null) return invalid('this page cannot verify the client tables: WebCrypto needs a secure page (https, or http on localhost)');
      const attempt = async (mode: RequestCache): Promise<{ readonly bytes: ArrayBuffer; readonly problem: string | null } | MapResourceFailure> => {
        const fetched = await get(file.path, mode);
        if (fetched.kind === 'failed') return fetched;
        const hash = await sha256Hex(sha256, fetched.bytes);
        return { bytes: fetched.bytes, problem: hash === file.sha256 ? null : `its SHA-256 is ${short(hash)}, the manifest records ${short(file.sha256)}` };
      };
      let result = await attempt('default');
      if ('problem' in result && result.problem !== null) result = await attempt('reload');
      if (!('problem' in result)) return result;
      if (result.problem !== null) return invalid(`${file.path} failed its integrity check: ${result.problem}`);
      const json = parseJson(result.bytes);
      if (json === undefined) return invalid(`${file.path} is not UTF-8 JSON`);
      const parsed = parse(json, file, index.manifest.build);
      return typeof parsed === 'string' ? invalid(`${file.path}: ${parsed}`) : { kind: 'loaded', table: parsed };
    });
  }

  return {
    manifest,
    taxi: () => table('taxi', parseClientTaxi),
    zones: () => table('zones', parseClientZones),
    dungeons: () => table('dungeons', parseClientDungeons),
  };
}
