import type { UiMapId, WorldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import { isFullUiRectangle, zoneFramesContaining, type MapGeometry } from '../geo';
import { insideRings, ringArea } from '../geo/zone-rings';
import type { ZoneShapes } from './map-labels';

/**
 * The zone a point of the map is in, for the "Viewing" chip (docs/research/map-presentation.md
 * §13.5; review QA-01). The zone frames overlap heavily (coordinates.md §15): the frame a point is
 * most central in names The Barrens for the Valley of Trials, and Searing Gorge for Kargath. The
 * terrain zone rings (D-032, `src/geo/zone-rings.ts`: the areas' own outlines, which the zone labels
 * and the zone fill already use) do not overlap, so they name the zone:
 *
 * 1. a zone frame holding the point whose area the terrain has no ring of on that map (the
 *    underground cities, Ironforge and the Undercity, drawn over their zones' terrain), most central
 *    first;
 * 2. else the area whose rings hold the point (even-odd, so a city enclave is its own zone), the
 *    smallest first, when a UiMap names that area;
 * 3. else, where no ring holds it (the rings still loading, the sea off a coast, a map without
 *    terrain arcs such as Zephras Isle), the zone frame the point is most central in.
 *
 * Null when no frame holds it either. Display only: a name for the view, never stored (the picked
 * points' zone hint stays `attributeZone`'s).
 */
export function zoneOfPoint(point: WorldPoint, shapes: ReadonlyMap<WorldMapId, ZoneShapes> | null, geometry: MapGeometry): UiMapId | null {
  const frames = zoneFramesContaining(point, geometry);
  const onMap = shapes?.get(point.mapId);
  if (onMap === undefined || onMap.rings.length === 0) return frames[0] ?? null;
  const index = ringIndexOf(onMap);
  // 1. A frame over terrain its area has no ring of.
  for (const id of frames) {
    const row = geometry.maps.get(id)?.assignments.find((candidate) => candidate.mapId === point.mapId && candidate.areaId > 0 && isFullUiRectangle(candidate));
    if (row !== undefined && !index.areas.has(row.areaId)) return id;
  }
  // 2. The rings that hold it.
  const uiMaps = areaUiMapsOf(geometry);
  let best: { readonly uiMapId: UiMapId; readonly area: number } | null = null;
  for (const zone of index.zones) {
    const box = zone.box;
    if (point.x < box.xMin || point.x > box.xMax || point.y < box.yMin || point.y > box.yMax) continue;
    const uiMapId = uiMaps.get(`${String(point.mapId)}:${String(zone.areaId)}`);
    if (uiMapId === undefined || !insideRings(zone.rings, point.x, point.y)) continue;
    if (best === null || zone.area < best.area) best = { uiMapId, area: zone.area };
  }
  // 3. The frame it is most central in.
  return best?.uiMapId ?? frames[0] ?? null;
}

interface RingZone {
  readonly areaId: number;
  readonly rings: readonly (readonly WorldPoint[])[];
  readonly box: { readonly xMin: number; readonly xMax: number; readonly yMin: number; readonly yMax: number };
  /** The area the rings enclose (the outer rings' sum; a lookup's tie-break only). */
  readonly area: number;
}

/** Each map's zones with their bounding boxes, once per shapes object. */
const ringIndexes = new WeakMap<ZoneShapes, { readonly zones: readonly RingZone[]; readonly areas: ReadonlySet<number> }>();

function ringIndexOf(shapes: ZoneShapes): { readonly zones: readonly RingZone[]; readonly areas: ReadonlySet<number> } {
  const known = ringIndexes.get(shapes);
  if (known !== undefined) return known;
  const zones = shapes.rings.map((zone): RingZone => {
    let xMin = Number.POSITIVE_INFINITY;
    let xMax = Number.NEGATIVE_INFINITY;
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;
    let area = 0;
    for (const ring of zone.rings) {
      area += ringArea(ring);
      for (const p of ring) {
        xMin = Math.min(xMin, p.x);
        xMax = Math.max(xMax, p.x);
        yMin = Math.min(yMin, p.y);
        yMax = Math.max(yMax, p.y);
      }
    }
    return { areaId: zone.areaId, rings: zone.rings, box: { xMin, xMax, yMin, yMax }, area };
  });
  const index = { zones, areas: new Set(zones.map((zone) => zone.areaId)) };
  ringIndexes.set(shapes, index);
  return index;
}

/** Each terrain area's UiMap, by `mapId:areaId`: the UiMap whose one full-rectangle row names it (as the zone fill finds it). */
const areaUiMaps = new WeakMap<MapGeometry, ReadonlyMap<string, UiMapId>>();

function areaUiMapsOf(geometry: MapGeometry): ReadonlyMap<string, UiMapId> {
  const known = areaUiMaps.get(geometry);
  if (known !== undefined) return known;
  const out = new Map<string, UiMapId>();
  for (const map of geometry.maps.values()) {
    const [row] = map.assignments;
    if (map.assignments.length !== 1 || row === undefined || row.areaId <= 0 || !isFullUiRectangle(row)) continue;
    out.set(`${String(row.mapId)}:${String(row.areaId)}`, map.uiMapId);
  }
  areaUiMaps.set(geometry, out);
  return out;
}
