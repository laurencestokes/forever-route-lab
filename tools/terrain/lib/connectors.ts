import { z } from 'zod';
import { uiMapId } from '../../../src/domain/ids';
import { zoneSourcedPoint } from '../../../src/domain/points';
import { resolvePoint, type MapGeometry } from '../../../src/geo';
import { containsXY, distToPoly, type MapMesh, type OffMeshLink } from './link';
import type { SnapIndex } from './snap';

/**
 * Connectors from the owner's in-game observations (terrain-navigation.md §11; D-031, D-034
 * items 1 and 2): `tools/terrain/inputs/connectors.json`. Types `elevator`, `lift`, `teleport` and
 * `walk`; boats and zeppelins are TravelGraph transports, never connectors. Only `observed` rows
 * are built, as directed off-mesh links (two when `bidirectional`) whose cost is wait + ride (or
 * cast) seconds; `todo` rows change nothing and are listed as missing.
 *
 * Validation (gate G15, RC-12): every endpoint's `uiMapId` must have a UiMapAssignment row on the
 * connector's map in the committed geometry; `teleport` rows carry `castSeconds`, the others
 * `rideSeconds`; an `observed` row needs both endpoints, its seconds, the date and the build.
 */

const seconds = z.strictObject({
  value: z.number().min(0).nullable(),
  basis: z.enum(['reported', 'client-data', 'era-assumed']),
  stat: z.enum(['max', 'none', 'mean']).optional(),
  note: z.string().optional(),
});

const endpoint = z.strictObject({
  uiMapId: z.number().int().positive().nullable(),
  x: z.number().min(0).max(100).nullable(),
  y: z.number().min(0).max(100).nullable(),
  floor: z.enum(['lowest', 'highest', 'only']),
  note: z.string().optional(),
});

const connectorRow = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  status: z.enum(['observed', 'todo']),
  type: z.enum(['elevator', 'lift', 'teleport', 'walk']),
  map: z.number().int().min(0).nullable(),
  bidirectional: z.boolean(),
  a: endpoint,
  b: endpoint,
  rideSeconds: seconds.optional(),
  castSeconds: seconds.optional(),
  waitSeconds: seconds,
  transport: z.strictObject({ gameObjectEntry: z.number().int().positive().nullable(), transportAnimationId: z.number().int().positive().nullable() }),
  observed: z.strictObject({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), build: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/).nullable(), by: z.string() }),
  citation: z.string().nullable(),
});

const connectorFile = z.strictObject({
  $comment: z.array(z.string()).optional(),
  schema: z.literal(1),
  kind: z.literal('nav-connectors'),
  about: z.string().optional(),
  connectors: z.array(connectorRow),
});

export type ConnectorRow = z.infer<typeof connectorRow>;
export type ConnectorFile = z.infer<typeof connectorFile>;

export function parseConnectors(value: unknown): ConnectorFile {
  const parsed = connectorFile.safeParse(value);
  if (!parsed.success) throw new Error(`connectors.json: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const ids = parsed.data.connectors.map((c) => c.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup !== undefined) throw new Error(`connectors.json: duplicate id ${dup}`);
  return parsed.data;
}

/** True when the geometry has a UiMapAssignment row for `ui` on world map `mapId`. */
export function uiMapOnMap(geometry: MapGeometry, ui: number, mapId: number): boolean {
  const map = geometry.maps.get(uiMapId(ui));
  return map !== undefined && map.assignments.some((row) => Number(row.mapId) === mapId);
}

/** Problems with the file against the committed geometry (gate G15); empty when valid. */
export function connectorProblems(file: ConnectorFile, geometry: MapGeometry): string[] {
  const out: string[] = [];
  for (const c of file.connectors) {
    const at = `connector ${c.id}`;
    const time = c.type === 'teleport' ? c.castSeconds : c.rideSeconds;
    if (c.type === 'teleport' && c.castSeconds === undefined) out.push(`${at}: a teleport row needs castSeconds`);
    if (c.type !== 'teleport' && c.rideSeconds === undefined) out.push(`${at}: a ${c.type} row needs rideSeconds`);
    if (c.type === 'teleport' && c.rideSeconds !== undefined) out.push(`${at}: a teleport row has castSeconds, not rideSeconds`);
    if (c.type !== 'teleport' && c.castSeconds !== undefined) out.push(`${at}: castSeconds is for teleport rows`);
    if (time?.basis === 'era-assumed' && c.citation === null) out.push(`${at}: an era-assumed time needs a citation`);
    for (const [name, e] of [['a', c.a], ['b', c.b]] as const) {
      if (e.uiMapId === null) {
        if (c.status === 'observed') out.push(`${at}.${name}: an observed row needs a uiMapId`);
        continue;
      }
      if (c.map === null) out.push(`${at}: uiMapId ${String(e.uiMapId)} given but map is null`);
      else if (!uiMapOnMap(geometry, e.uiMapId, c.map)) out.push(`${at}.${name}: UiMap ${String(e.uiMapId)} has no UiMapAssignment row on map ${String(c.map)} (RC-12)`);
    }
    if (c.status !== 'observed') continue;
    if (c.map === null) out.push(`${at}: an observed row needs a map`);
    for (const [name, e] of [['a', c.a], ['b', c.b]] as const) if (e.x === null || e.y === null) out.push(`${at}.${name}: an observed row needs x and y`);
    if (time === undefined || time.value === null) out.push(`${at}: an observed row needs its ${c.type === 'teleport' ? 'cast' : 'ride'} seconds`);
    if (c.waitSeconds.value === null) out.push(`${at}: an observed row needs waitSeconds (0 when none)`);
    if (c.observed.date === null || c.observed.build === null) out.push(`${at}: an observed row needs the date and build`);
  }
  return out;
}

export interface ResolvedEndpoint {
  readonly x: number;
  readonly y: number;
  readonly poly: number;
}

export interface ResolvedConnector {
  readonly index: number;
  readonly id: string;
  readonly a: ResolvedEndpoint;
  readonly b: ResolvedEndpoint;
  readonly costTenths: number;
  readonly bidirectional: boolean;
}

/** The world point of an endpoint (`/way` percent on its UiMap). */
export function endpointWorld(e: ConnectorRow['a'], geometry: MapGeometry): { x: number; y: number; mapId: number } | null {
  if (e.uiMapId === null || e.x === null || e.y === null) return null;
  const w = resolvePoint(zoneSourcedPoint(uiMapId(e.uiMapId), e.x, e.y, 'forever'), geometry);
  return w === null ? null : { x: w.x, y: w.y, mapId: Number(w.mapId) };
}

/**
 * The polygon of an endpoint: among the polygons containing the point, the lowest or highest
 * floor (centroid height), or the only one; with none containing it, the nearest within the snap
 * radius. Throws when nothing qualifies or `only` finds several floors.
 */
export function endpointPolygon(si: SnapIndex, x: number, y: number, floor: 'lowest' | 'highest' | 'only', what: string): number {
  const g: MapMesh = si.g;
  const bin = si.bins.get((Math.floor(x / si.cell) + 1024) * 4096 + (Math.floor(y / si.cell) + 1024)) ?? [];
  const containing = bin.filter((p) => containsXY(g, p, x, y)).sort((p, q) => (g.cz[p] ?? 0) - (g.cz[q] ?? 0) || p - q);
  if (containing.length > 0) {
    if (floor === 'only' && containing.length > 1) throw new Error(`${what}: floor "only" but ${String(containing.length)} floors contain the point`);
    const pick = floor === 'highest' ? containing[containing.length - 1] : containing[0];
    if (pick !== undefined) return pick;
  }
  let best = -1;
  let bestD = si.radius;
  for (const p of bin) {
    const d = distToPoly(g, p, x, y);
    if (d < bestD || (d === bestD && p < best)) {
      bestD = d;
      best = p;
    }
  }
  if (best < 0) throw new Error(`${what}: no polygon within ${String(si.radius)} yd`);
  return best;
}

/** The observed rows of one map as off-mesh links (their index is the row's position in `file`). */
export function resolveConnectors(file: ConnectorFile, mapId: number, geometry: MapGeometry, si: SnapIndex): { connectors: ResolvedConnector[]; links: OffMeshLink[] } {
  const connectors: ResolvedConnector[] = [];
  const links: OffMeshLink[] = [];
  file.connectors.forEach((c, index) => {
    if (c.status !== 'observed' || c.map !== mapId) return;
    const time = c.type === 'teleport' ? c.castSeconds : c.rideSeconds;
    const costTenths = Math.round(((time?.value ?? 0) + (c.waitSeconds.value ?? 0)) * 10);
    const ends = ([['a', c.a], ['b', c.b]] as const).map(([name, e]) => {
      const w = endpointWorld(e, geometry);
      if (w === null || w.mapId !== mapId) throw new Error(`connector ${c.id}.${name}: endpoint does not resolve on map ${String(mapId)}`);
      return { x: w.x, y: w.y, poly: endpointPolygon(si, w.x, w.y, e.floor, `connector ${c.id}.${name}`) };
    });
    const [a, b] = ends as [ResolvedEndpoint, ResolvedEndpoint];
    connectors.push({ index, id: c.id, a, b, costTenths, bidirectional: c.bidirectional });
    links.push({ connector: index, from: a.poly, to: b.poly, costTenths });
    if (c.bidirectional) links.push({ connector: index, from: b.poly, to: a.poly, costTenths });
  });
  return { connectors, links };
}

/** The `observed` rows, for public/nav/connectors.json. */
export function observedRows(file: ConnectorFile): ConnectorRow[] {
  return file.connectors.filter((c) => c.status === 'observed');
}
