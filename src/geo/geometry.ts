import { areaId, uiMapId, worldMapId, type UiMapId } from '../domain/ids';
import {
  GEOMETRY_ROW_SOURCES,
  type EraToForeverCoefficients,
  type GeometryAssignment,
  type GeometryKind,
  type GeometryRowSource,
  type MapGeometry,
  type UiMapGeometry,
} from './types';

/**
 * Construction and parsing of `MapGeometry` (docs/MAPS.md §5.3). Pure: the caller reads and
 * JSON-parses the file; this module checks its shape and builds the lookup maps. Nothing is
 * repaired: any problem rejects the whole file with path-level messages.
 */

export interface MapGeometryInput {
  readonly kind: GeometryKind;
  readonly product: string;
  readonly recordedFrameHash: string | null;
  /** The file's `contentHash` (types.ts); omitted or null when there is none. */
  readonly recordedContentHash?: string | null;
  readonly maps: readonly UiMapGeometry[];
  readonly eraToForever: readonly (readonly [UiMapId, EraToForeverCoefficients])[];
}

const byNumber = (a: number, b: number): number => a - b;

const sortedAssignments = (rows: readonly GeometryAssignment[]): readonly GeometryAssignment[] =>
  [...rows].sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);

/** Structural problems `createMapGeometry` refuses: duplicates, empty maps, degenerate rectangles. */
export function geometryProblems(input: MapGeometryInput): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const map of input.maps) {
    if (seen.has(map.uiMapId)) problems.push(`UiMap ${String(map.uiMapId)} appears twice`);
    seen.add(map.uiMapId);
    if (map.assignments.length === 0) problems.push(`UiMap ${String(map.uiMapId)} has no assignment rows`);
    const orders = new Set<number>();
    for (const row of map.assignments) {
      const where = `UiMap ${String(map.uiMapId)} row ${String(row.id)}`;
      if (orders.has(row.orderIndex)) problems.push(`${where}: OrderIndex ${String(row.orderIndex)} appears twice`);
      orders.add(row.orderIndex);
      const values = [row.xMin, row.xMax, row.yMin, row.yMax, ...row.uiMin, ...row.uiMax];
      if (!values.every(Number.isFinite)) problems.push(`${where}: non-finite bounds`);
      else {
        if (!(row.xMin < row.xMax && row.yMin < row.yMax)) problems.push(`${where}: degenerate or reversed world bounds`);
        if (!(row.uiMin[0] < row.uiMax[0] && row.uiMin[1] < row.uiMax[1])) problems.push(`${where}: degenerate or reversed UI rectangle`);
      }
    }
  }
  const eraSeen = new Set<number>();
  for (const [id, coefficients] of input.eraToForever) {
    if (eraSeen.has(id)) problems.push(`eraToForever ${String(id)} appears twice`);
    eraSeen.add(id);
    const values = [coefficients.scaleX, coefficients.offsetX, coefficients.scaleY, coefficients.offsetY];
    if (!values.every(Number.isFinite) || coefficients.scaleX === 0 || coefficients.scaleY === 0) {
      problems.push(`eraToForever ${String(id)}: coefficients must be finite with non-zero scales`);
    }
  }
  return problems;
}

/**
 * Builds a `MapGeometry` with maps in ascending UiMapId order and rows in ascending OrderIndex,
 * so iteration never depends on input order. Throws on any `geometryProblems` finding.
 */
export function createMapGeometry(input: MapGeometryInput): MapGeometry {
  const problems = geometryProblems(input);
  if (problems.length > 0) throw new Error(`invalid map geometry: ${problems.join('; ')}`);
  const maps = [...input.maps]
    .sort((a, b) => byNumber(a.uiMapId, b.uiMapId))
    .map((map): readonly [UiMapId, UiMapGeometry] => [map.uiMapId, { ...map, assignments: sortedAssignments(map.assignments) }]);
  const era = [...input.eraToForever].sort((a, b) => byNumber(a[0], b[0]));
  return {
    kind: input.kind,
    product: input.product,
    recordedFrameHash: input.recordedFrameHash,
    recordedContentHash: input.recordedContentHash ?? null,
    maps: new Map(maps),
    eraToForever: new Map(era),
  };
}

// =============================================================================================
// Parsing geometry.placeholder.json / geometry.local.json

export type GeometryParseResult =
  | { readonly ok: true; readonly geometry: MapGeometry }
  | { readonly ok: false; readonly errors: readonly string[] };

type Json = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

const BUILD = /^\d+\.\d+\.\d+\.\d+$/;
const HASH = /^[0-9a-f]{64}$/;
const CANONICAL_ID = /^[1-9]\d*$/;

const ASSIGNMENT_KEYS = ['id', 'mapId', 'areaId', 'orderIndex', 'xMin', 'xMax', 'yMin', 'yMax', 'uiMin', 'uiMax', 'source', 'build'];
const MAP_KEYS = ['name', 'nameSource', 'type', 'parent', 'assignments'];
const ERA_KEYS = ['scaleX', 'offsetX', 'scaleY', 'offsetY', 'fromBuild', 'toBuild', 'source'];

class Reader {
  readonly errors: string[] = [];

  fail(path: string, message: string): void {
    this.errors.push(`${path}: ${message}`);
  }

  keys(value: Json, allowed: readonly string[], path: string): void {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) this.fail(`${path}.${key}`, 'unknown key');
    for (const key of allowed) if (!(key in value)) this.fail(`${path}.${key}`, 'missing');
  }

  integer(value: unknown, path: string, min: number): number {
    if (typeof value === 'number' && Number.isInteger(value) && value >= min) return value;
    this.fail(path, `must be an integer >= ${String(min)}`);
    return min;
  }

  integerOrNull(value: unknown, path: string, min: number): number | null {
    return value === null ? null : this.integer(value, path, min);
  }

  finite(value: unknown, path: string): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    this.fail(path, 'must be a finite number');
    return 0;
  }

  string(value: unknown, path: string): string {
    if (typeof value === 'string' && value !== '') return value;
    this.fail(path, 'must be a non-empty string');
    return '';
  }

  build(value: unknown, path: string): string {
    const text = this.string(value, path);
    if (text !== '' && !BUILD.test(text)) this.fail(path, 'must be a build such as 1.60.1.69893');
    return text;
  }

  source(value: unknown, path: string, allowed: readonly GeometryRowSource[]): GeometryRowSource {
    const match = GEOMETRY_ROW_SOURCES.find((source) => source === value);
    if (match !== undefined && allowed.includes(match)) return match;
    this.fail(path, `must be one of ${allowed.join(', ')}`);
    return allowed[0] ?? 'local-db2';
  }

  pair(value: unknown, path: string): readonly [number, number] {
    if (!Array.isArray(value) || value.length !== 2) {
      this.fail(path, 'must be a [u, v] pair');
      return [0, 0];
    }
    const pair: readonly [number, number] = [this.finite(value[0], `${path}[0]`), this.finite(value[1], `${path}[1]`)];
    if (pair.some((n) => n < 0 || n > 1)) this.fail(path, 'UI coordinates must lie in 0..1');
    return pair;
  }

  id(key: string, path: string): UiMapId {
    if (!CANONICAL_ID.test(key)) this.fail(path, 'UiMap keys must be positive integers without leading zeros');
    return uiMapId(Number(key));
  }
}

const ROW_SOURCES: Readonly<Record<'placeholder' | 'local', readonly GeometryRowSource[]>> = {
  placeholder: ['questiedb-conversion', 'db2-csv'],
  local: ['local-db2'],
};

function readAssignment(reader: Reader, value: unknown, path: string, sources: readonly GeometryRowSource[]): GeometryAssignment | null {
  if (!isRecord(value)) {
    reader.fail(path, 'must be an object');
    return null;
  }
  reader.keys(value, ASSIGNMENT_KEYS, path);
  return {
    id: reader.integer(value['id'], `${path}.id`, 1),
    mapId: worldMapId(reader.integer(value['mapId'], `${path}.mapId`, 0)),
    areaId: areaId(reader.integer(value['areaId'], `${path}.areaId`, 0)),
    orderIndex: reader.integer(value['orderIndex'], `${path}.orderIndex`, 0),
    xMin: reader.finite(value['xMin'], `${path}.xMin`),
    xMax: reader.finite(value['xMax'], `${path}.xMax`),
    yMin: reader.finite(value['yMin'], `${path}.yMin`),
    yMax: reader.finite(value['yMax'], `${path}.yMax`),
    uiMin: reader.pair(value['uiMin'], `${path}.uiMin`),
    uiMax: reader.pair(value['uiMax'], `${path}.uiMax`),
    source: reader.source(value['source'], `${path}.source`, sources),
    build: reader.build(value['build'], `${path}.build`),
  };
}

function readMap(reader: Reader, key: string, value: unknown, sources: readonly GeometryRowSource[]): UiMapGeometry | null {
  const path = `maps.${key}`;
  const id = reader.id(key, path);
  if (!isRecord(value)) {
    reader.fail(path, 'must be an object');
    return null;
  }
  reader.keys(value, MAP_KEYS, path);
  const rows = value['assignments'];
  const assignments: GeometryAssignment[] = [];
  if (!Array.isArray(rows) || rows.length === 0) reader.fail(`${path}.assignments`, 'must be a non-empty array');
  else {
    rows.forEach((row: unknown, index) => {
      const parsed = readAssignment(reader, row, `${path}.assignments[${String(index)}]`, sources);
      if (parsed !== null) assignments.push(parsed);
    });
  }
  const parent = reader.integerOrNull(value['parent'], `${path}.parent`, 0);
  return {
    uiMapId: id,
    name: reader.string(value['name'], `${path}.name`),
    nameSource: reader.source(value['nameSource'], `${path}.nameSource`, sources),
    type: reader.integerOrNull(value['type'], `${path}.type`, 0),
    parent: parent === null ? null : uiMapId(parent),
    assignments,
  };
}

function readEra(reader: Reader, key: string, value: unknown): readonly [UiMapId, EraToForeverCoefficients] | null {
  const path = `eraToForever.${key}`;
  const id = reader.id(key, path);
  if (!isRecord(value)) {
    reader.fail(path, 'must be an object');
    return null;
  }
  reader.keys(value, ERA_KEYS, path);
  if (value['source'] !== 'questiedb-conversion') reader.fail(`${path}.source`, 'must be questiedb-conversion');
  return [
    id,
    {
      scaleX: reader.finite(value['scaleX'], `${path}.scaleX`),
      offsetX: reader.finite(value['offsetX'], `${path}.offsetX`),
      scaleY: reader.finite(value['scaleY'], `${path}.scaleY`),
      offsetY: reader.finite(value['offsetY'], `${path}.offsetY`),
      fromBuild: reader.build(value['fromBuild'], `${path}.fromBuild`),
      toBuild: reader.build(value['toBuild'], `${path}.toBuild`),
      source: 'questiedb-conversion',
    },
  ];
}

/** A recorded SHA-256 (`frameHash`, `contentHash`): a lowercase hex digest, or null/absent where `required` is null. */
function recordedHash(reader: Reader, file: Json, key: string, required: string | null): string | null {
  const hash = file[key];
  if (typeof hash === 'string' && HASH.test(hash)) return hash;
  if (hash !== undefined && hash !== null) reader.fail(key, 'must be a lowercase hex SHA-256 or null');
  else if (required !== null) reader.fail(key, required);
  return null;
}

/**
 * Parses an already JSON-decoded geometry file (placeholder or local). Top-level keys other than
 * the ones read here (`_generated`, `inputs`, `build`, ...) are provenance and ignored. Placeholder
 * rows must be `questiedb-conversion` or `db2-csv`, and the placeholder must record `frameHash` and
 * `contentHash`; local rows must be `local-db2`, the file must say `"redistribution": "local-only"`,
 * and its hashes are optional (MAPS.md §5.3, §5.7). The recorded hashes are only read: the caller
 * recomputes both (`canonicalFrameTuples`, `canonicalGeometryContent`) and compares.
 */
export function parseGeometryFile(value: unknown): GeometryParseResult {
  const reader = new Reader();
  if (!isRecord(value)) return { ok: false, errors: ['(root): must be an object'] };
  if (value['schema'] !== 1) reader.fail('schema', 'must be 1');
  const kind = value['kind'];
  if (kind !== 'placeholder' && kind !== 'local') {
    reader.fail('kind', 'must be "placeholder" or "local"');
    return { ok: false, errors: reader.errors };
  }
  if (kind === 'local' && value['redistribution'] !== 'local-only') reader.fail('redistribution', 'a local geometry must be "local-only"');
  if (kind === 'placeholder' && 'redistribution' in value) reader.fail('redistribution', 'the committed placeholder carries no redistribution marker');
  const product = reader.string(value['product'], 'product');
  const recordedFrameHash = recordedHash(reader, value, 'frameHash', kind === 'placeholder' ? 'the placeholder must record its frame hash' : null);
  const recordedContentHash = recordedHash(reader, value, 'contentHash', kind === 'placeholder' ? 'the placeholder must record its content hash' : null);

  const sources = ROW_SOURCES[kind];
  const maps: UiMapGeometry[] = [];
  const rawMaps = value['maps'];
  if (!isRecord(rawMaps) || Object.keys(rawMaps).length === 0) reader.fail('maps', 'must be a non-empty object');
  else {
    for (const [key, entry] of Object.entries(rawMaps)) {
      const map = readMap(reader, key, entry, sources);
      if (map !== null) maps.push(map);
    }
  }
  const era: (readonly [UiMapId, EraToForeverCoefficients])[] = [];
  const rawEra = value['eraToForever'];
  if (!isRecord(rawEra)) reader.fail('eraToForever', 'must be an object (empty when the set has no coefficients)');
  else {
    for (const [key, entry] of Object.entries(rawEra)) {
      const parsed = readEra(reader, key, entry);
      if (parsed !== null) era.push(parsed);
    }
  }
  if (reader.errors.length > 0) return { ok: false, errors: reader.errors };
  const input: MapGeometryInput = { kind, product, recordedFrameHash, recordedContentHash, maps, eraToForever: era };
  const problems = geometryProblems(input);
  if (problems.length > 0) return { ok: false, errors: problems };
  return { ok: true, geometry: createMapGeometry(input) };
}

/** Every assignment row of a geometry, with its UiMap, in ascending (UiMapId, OrderIndex) order. */
export function allAssignments(geometry: MapGeometry): readonly { readonly uiMapId: UiMapId; readonly row: GeometryAssignment }[] {
  const out: { readonly uiMapId: UiMapId; readonly row: GeometryAssignment }[] = [];
  for (const map of geometry.maps.values()) for (const row of map.assignments) out.push({ uiMapId: map.uiMapId, row });
  return out;
}
