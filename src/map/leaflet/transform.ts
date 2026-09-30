import type { UiMapId, WorldMapId } from '../../domain/ids';
import type { WorldPoint } from '../../domain/points';
import type { FrameDescriptor, WorldBounds } from '../adapter';

/**
 * World yards ⇄ Leaflet `L.CRS.Simple` coordinates, and the scale maths of the map (docs/MAPS.md
 * §7.1; docs/research/coordinates.md §14). No Leaflet import, so it runs in the node test
 * environment.
 *
 * World axes: `x` north, `y` west, in yards (coordinates.md §2). Leaflet's `CRS.Simple` draws
 * `LatLng(lat, lng)` at pixel `(lng·2^z, −lat·2^z)` at zoom `z` (Leaflet 1.9.4
 * `src/geo/crs/CRS.Simple.js`: `LonLat` projection, transformation `(1, 0, −1, 0)`), so north is up
 * when `lat` grows north and east is right when `lng` grows east. Hence
 *
 *   forward:  lat = x,  lng = −y          (north up, east right: east is decreasing world y)
 *   inverse:  x = lat,  y = −lng
 *
 * and a world rectangle maps to `[[south, west], [north, east]] = [[xMin, −yMax], [xMax, −yMin]]`.
 * Negation is written `0 − v`, so a world `0` never becomes `−0`. The transform is exact (negation
 * and identity only), so a round trip returns the same numbers.
 *
 * **Through a placement** (docs/research/map-atlas.md §5.1, §8.1; step ATL.3): a surface draws each
 * world map through its placement, a translation `E = eOff − y`, `S = sOff − x` into the surface's
 * plane (atlas yards, E east, S south), with `latLng = (−S, E)`:
 *
 *   forward:  lat = x − sOff,  lng = eOff − y
 *   inverse:  x = lat − (0 − sOff),  y = eOff − lng
 *
 * A world surface's identity placement (`eOff = sOff = 0`) gives exactly the numbers above, `−0`
 * included (`x − 0` is `x`), so one code path serves both kinds of surface. Through an atlas
 * placement the round trip is exact for whole yards and within 10⁻⁹ yd otherwise, and exact after
 * the app's 0.1-yd pick rounding (the same arithmetic as src/geo/atlas.ts, map-atlas.md §5.4).
 * Atlas positions are display only (D-017): nothing here measures a distance across maps.
 */

/** `[lat, lng]` for Leaflet. */
export type LatLngPair = readonly [number, number];

/** `[[south, west], [north, east]]` for Leaflet. */
export type LatLngBoundsPair = readonly [LatLngPair, LatLngPair];

export function worldToLatLng(x: number, y: number): LatLngPair {
  return [x, 0 - y];
}

export function pointToLatLng(point: { readonly x: number; readonly y: number }): LatLngPair {
  return worldToLatLng(point.x, point.y);
}

/** The inverse of `worldToLatLng`, on world map `mapId`. */
export function latLngToWorld(lat: number, lng: number, mapId: WorldMapId): WorldPoint {
  return { mapId, x: lat, y: 0 - lng };
}

export function boundsToLatLngBounds(bounds: WorldBounds): LatLngBoundsPair {
  return [
    [bounds.xMin, 0 - bounds.yMax],
    [bounds.xMax, 0 - bounds.yMin],
  ];
}

/** The inverse of `boundsToLatLngBounds`: south/west/north/east edges back to a world rectangle. */
export function latLngBoundsToWorld(south: number, west: number, north: number, east: number, mapId: WorldMapId): WorldBounds {
  return { mapId, xMin: south, xMax: north, yMin: 0 - east, yMax: 0 - west };
}

/** A placement's translation (`SurfacePlacement` in adapter.ts): only its offsets move a point. */
export interface Translation {
  readonly eOff: number;
  readonly sOff: number;
}

/** The identity placement of a world surface. */
export const IDENTITY: Translation = { eOff: 0, sOff: 0 };

/** `worldToLatLng` through a placement: `[x − sOff, eOff − y]`. */
export function placedLatLng(placement: Translation, x: number, y: number): LatLngPair {
  return [x - placement.sOff, placement.eOff - y];
}

/** `boundsToLatLngBounds` through a placement. */
export function placedLatLngBounds(placement: Translation, bounds: WorldBounds): LatLngBoundsPair {
  return [
    [bounds.xMin - placement.sOff, placement.eOff - bounds.yMax],
    [bounds.xMax - placement.sOff, placement.eOff - bounds.yMin],
  ];
}

/** The inverse of `placedLatLng`, on world map `mapId` (whatever the partition would say there). */
export function latLngOnMap(placement: Translation, lat: number, lng: number, mapId: WorldMapId): WorldPoint {
  return { mapId, x: lat - (0 - placement.sOff), y: placement.eOff - lng };
}

/** The inverse of `placedLatLngBounds`: south/west/north/east edges back to a rectangle of `mapId`'s yards. */
export function latLngBoundsOnMap(placement: Translation, south: number, west: number, north: number, east: number, mapId: WorldMapId): WorldBounds {
  return { mapId, xMin: south - (0 - placement.sOff), xMax: north - (0 - placement.sOff), yMin: placement.eOff - east, yMax: placement.eOff - west };
}

/** An atlas position (E east, S south) of a Leaflet point: `E = lng`, `S = −lat`. */
export function latLngToAtlas(lat: number, lng: number): { readonly e: number; readonly s: number } {
  return { e: lng, s: 0 - lat };
}

/** A placement's world rectangle as Leaflet bounds: where the map lies on the surface. */
export function placementLatLngBounds(placement: Translation & { readonly rect: WorldBounds }): LatLngBoundsPair {
  return placedLatLngBounds(placement, placement.rect);
}

/** Two `[[south, west], [north, east]]` rectangles overlap (edges included). */
export function latLngBoundsMeet(a: LatLngBoundsPair, b: LatLngBoundsPair): boolean {
  return a[0][0] <= b[1][0] && a[1][0] >= b[0][0] && a[0][1] <= b[1][1] && a[1][1] >= b[0][1];
}

/** A rectangle grown by `fraction` of its size on every side (Leaflet's `LatLngBounds.pad`). */
export function padLatLngBounds(bounds: LatLngBoundsPair, fraction: number): LatLngBoundsPair {
  const dLat = (bounds[1][0] - bounds[0][0]) * fraction;
  const dLng = (bounds[1][1] - bounds[0][1]) * fraction;
  return [
    [bounds[0][0] - dLat, bounds[0][1] - dLng],
    [bounds[1][0] + dLat, bounds[1][1] + dLng],
  ];
}

/**
 * A connector's arc (map-atlas.md §8.5) in Leaflet coordinates: a quadratic Bézier from `from` to
 * `to` whose control point sits `2 × bulge` of the chord to the left of travel (north when the leg
 * runs east), so the curve's apex bulges `bulge` of the chord; `segments + 1` points, the ends
 * exact. The surface's plane is isotropic (one unit is one yard both ways), so the bulge is the
 * same on screen. Display only: its length is never a distance (D-017).
 */
export function connectorArc(from: LatLngPair, to: LatLngPair, bulge = 0.12, segments = 24): readonly LatLngPair[] {
  const [lat0, lng0] = from;
  const [lat2, lng2] = to;
  const dLat = lat2 - lat0;
  const dLng = lng2 - lng0;
  // Left of the travel direction (dLng east, dLat north): rotate it a quarter turn anticlockwise.
  const lat1 = (lat0 + lat2) / 2 + 2 * bulge * dLng;
  const lng1 = (lng0 + lng2) / 2 - 2 * bulge * dLat;
  const out: LatLngPair[] = [from];
  const n = Math.max(2, Math.floor(segments));
  for (let i = 1; i < n; i += 1) {
    const t = i / n;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    out.push([a * lat0 + b * lat1 + c * lat2, a * lng0 + b * lng1 + c * lng2]);
  }
  out.push(to);
  return out;
}

/** The point halfway along `connectorArc` (t = 0.5), where its transition glyph sits. */
export function connectorMidpoint(from: LatLngPair, to: LatLngPair, bulge = 0.12): LatLngPair {
  const [lat0, lng0] = from;
  const [lat2, lng2] = to;
  const lat1 = (lat0 + lat2) / 2 + 2 * bulge * (lng2 - lng0);
  const lng1 = (lng0 + lng2) / 2 - 2 * bulge * (lat2 - lat0);
  return [0.25 * lat0 + 0.5 * lat1 + 0.25 * lat2, 0.25 * lng0 + 0.5 * lng1 + 0.25 * lng2];
}

/**
 * How much of an image over `bounds` to cut away on each side so only `clip` shows, as fractions
 * of its height (top, bottom) and width (right, left) on screen (north up, east right: world x
 * down the image is decreasing, world y across it is decreasing). Null when the image has no area,
 * the clip is on another map, or the clip covers the whole image; a clip that misses the image
 * cuts it all away.
 */
export function clipInset(
  bounds: WorldBounds,
  clip: WorldBounds,
): { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number } | null {
  const height = bounds.xMax - bounds.xMin;
  const width = bounds.yMax - bounds.yMin;
  if (clip.mapId !== bounds.mapId || !(height > 0) || !(width > 0)) return null;
  const part = (value: number): number => Math.min(1, Math.max(0, value));
  const inset = {
    top: part((bounds.xMax - clip.xMax) / height),
    bottom: part((clip.xMin - bounds.xMin) / height),
    left: part((bounds.yMax - clip.yMax) / width),
    right: part((clip.yMin - bounds.yMin) / width),
  };
  return inset.top === 0 && inset.bottom === 0 && inset.left === 0 && inset.right === 0 ? null : inset;
}

/** Yards per screen pixel at a `CRS.Simple` zoom (`2^zoom` pixels per yard). */
export function yardsPerPixel(zoom: number): number {
  return 2 ** (0 - zoom);
}

/** The zoom at which an image `pixels` wide spans `yards` (MAPS §7.1: `log2(1002 / (Ymax − Ymin))`). */
export function nativeZoom(pixels: number, yards: number): number {
  return Math.log2(pixels / yards);
}

/** The largest 1, 2 or 5 × 10^k not above `limit` (for scale bars and grid spacing); null for a limit below 1e-6 or non-finite. */
export function niceFloor(limit: number): number | null {
  if (!Number.isFinite(limit) || limit < 1e-6) return null;
  let power = 1;
  while (power * 10 <= limit) power *= 10;
  while (power > limit) power /= 10;
  for (const step of [5, 2, 1]) if (step * power <= limit) return step * power;
  return power;
}

/** The smallest 1, 2 or 5 × 10^k not below `minimum`; null for a minimum that is not positive and finite. */
export function niceCeil(minimum: number): number | null {
  if (!Number.isFinite(minimum) || minimum <= 0) return null;
  let power = 1;
  while (power > minimum) power /= 10;
  while (power * 10 < minimum) power *= 10;
  for (const step of [1, 2, 5, 10]) if (step * power >= minimum) return step * power;
  return 10 * power;
}

/** `12500` → `12,500 yd` (fixed separators: no host locale). */
export function formatYards(yards: number): string {
  const rounded = Math.round(yards);
  const digits = String(Math.abs(rounded));
  let grouped = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ',';
    grouped += digits.charAt(i);
  }
  return `${rounded < 0 ? '-' : ''}${grouped} yd`;
}

export interface ScaleBar {
  readonly yards: number;
  readonly widthPx: number;
  readonly text: string;
}

/** A yard scale bar at most `maxWidthPx` wide: the longest nice length that fits. Null when the zoom is not usable. */
export function scaleBarAt(zoom: number, maxWidthPx: number): ScaleBar | null {
  const perPixel = yardsPerPixel(zoom);
  const yards = niceFloor(perPixel * maxWidthPx);
  if (yards === null || yards < 1) return null;
  return { yards, widthPx: yards / perPixel, text: formatYards(yards) };
}

/** Grid spacing in yards so lines are at least `minSpacingPx` apart on screen. */
export function gridSpacingAt(zoom: number, minSpacingPx: number): number | null {
  return niceCeil(yardsPerPixel(zoom) * minSpacingPx);
}

/**
 * A grid line's label: the Blizzard axis, its yard value (with a true minus sign) and the direction
 * the axis grows, `X 500 (N)` or `Y −4100 (W)`. World X runs north and Y runs west
 * (coordinates.md §2), the opposite of the screen habit, and RXP writes world pairs as (Y, X), so
 * the direction is spelled out (M3 review MAP-COORD-14).
 */
export function gridLabel(axis: 'X' | 'Y', value: number): string {
  const rounded = Math.round(value);
  return `${axis} ${rounded < 0 ? '−' : ''}${String(Math.abs(rounded))} (${axis === 'X' ? 'N' : 'W'})`;
}

/**
 * The zoom at which `bounds` just fits a `widthPx` × `heightPx` view with `paddingPx` free on
 * every side (`CRS.Simple`: `2^zoom` pixels per yard; world y spans the width, x the height); null
 * when the view or the bounds have no area.
 */
export function zoomToFit(bounds: WorldBounds, widthPx: number, heightPx: number, paddingPx: number): number | null {
  const width = widthPx - 2 * paddingPx;
  const height = heightPx - 2 * paddingPx;
  const yards = { across: bounds.yMax - bounds.yMin, down: bounds.xMax - bounds.xMin };
  if (!(width > 0) || !(height > 0) || !(yards.across > 0) || !(yards.down > 0)) return null;
  return Math.log2(Math.min(width / yards.across, height / yards.down));
}

/**
 * The least zoom the map allows (M3 review MAP-UX-7): `preferred` (-6 by default) where the view
 * is large enough to show the largest extent at that zoom; otherwise the zoom that fits it, snapped
 * down to `snap`, but never below `floor`. Recomputed when the container changes size.
 */
export function minZoomFor(
  extents: readonly WorldBounds[],
  widthPx: number,
  heightPx: number,
  options: { readonly paddingPx: number; readonly preferred: number; readonly floor: number; readonly snap: number },
): number {
  let fit = Infinity;
  for (const extent of extents) {
    const zoom = zoomToFit(extent, widthPx, heightPx, options.paddingPx);
    if (zoom !== null) fit = Math.min(fit, zoom);
  }
  if (!Number.isFinite(fit)) return options.preferred;
  const snapped = options.snap > 0 ? Math.floor(fit / options.snap) * options.snap : fit;
  return Math.max(options.floor, Math.min(options.preferred, snapped));
}

/** Multiples of `spacing` in `[min, max]`, ascending; empty when there are more than `limit` (a guard against a bad spacing). */
export function gridValues(min: number, max: number, spacing: number, limit = 400): readonly number[] {
  if (!(spacing > 0) || !Number.isFinite(min) || !Number.isFinite(max) || max < min) return [];
  const first = Math.ceil(min / spacing);
  const last = Math.floor(max / spacing);
  if (last - first + 1 > limit) return [];
  const out: number[] = [];
  for (let k = first; k <= last; k += 1) out.push(k * spacing === 0 ? 0 : k * spacing);
  return out;
}

/** The overlap of two world rectangles on the same map, or null. */
export function intersectBounds(a: WorldBounds, b: WorldBounds): WorldBounds | null {
  if (a.mapId !== b.mapId) return null;
  const xMin = Math.max(a.xMin, b.xMin);
  const xMax = Math.min(a.xMax, b.xMax);
  const yMin = Math.max(a.yMin, b.yMin);
  const yMax = Math.min(a.yMax, b.yMax);
  return xMin <= xMax && yMin <= yMax ? { mapId: a.mapId, xMin, xMax, yMin, yMax } : null;
}

/**
 * The grid lines to draw: constant-x lines (world north coordinate, drawn horizontally) and
 * constant-y lines (drawn vertically), inside the visible rectangle clipped to `clip` (the
 * surface extent) when given.
 */
export function gridLinesIn(
  visible: WorldBounds,
  clip: WorldBounds | null,
  spacing: number,
): { readonly area: WorldBounds; readonly xs: readonly number[]; readonly ys: readonly number[] } | null {
  const area = clip === null ? visible : intersectBounds(visible, clip);
  if (area === null) return null;
  return { area, xs: gridValues(area.xMin, area.xMax, spacing), ys: gridValues(area.yMin, area.yMax, spacing) };
}

/** Squared distance from `p` to segment `a`–`b`. */
function segmentDistanceSq(p: { readonly x: number; readonly y: number }, a: WorldPoint, b: WorldPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  const ex = a.x + t * dx - p.x;
  const ey = a.y + t * dy - p.y;
  return ex * ex + ey * ey;
}

/**
 * The segment of a polyline nearest to `p` (segment `i` joins vertices `i` and `i + 1`); ties go to
 * the lower index; null for fewer than two points. World and screen distances order the same way
 * because the map is isotropic (coordinates.md §4.1).
 */
export function nearestSegment(points: readonly WorldPoint[], p: { readonly x: number; readonly y: number }): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) continue;
    const distance = segmentDistanceSq(p, a, b);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/**
 * The zone frames containing `p`, smallest first (a city before its zone), ties by UiMap id. Frames
 * are map rectangles, not zone borders (coordinates.md §5): this is a display aid, not
 * membership, and not the jump-to-zone choice either (the controller opens the frame `p` is most
 * central in, coordinates.md §15; M3 review MAP-UX-1).
 */
export function zonesAt(frames: readonly FrameDescriptor[], p: WorldPoint): readonly UiMapId[] {
  const hits: { readonly uiMapId: UiMapId; readonly area: number }[] = [];
  for (const frame of frames) {
    if (frame.kind !== 'zone' || frame.ref.kind !== 'zone') continue;
    const b = frame.bounds;
    if (b.mapId !== p.mapId || p.x < b.xMin || p.x > b.xMax || p.y < b.yMin || p.y > b.yMax) continue;
    hits.push({ uiMapId: frame.ref.uiMapId, area: (b.xMax - b.xMin) * (b.yMax - b.yMin) });
  }
  return [...new Map(hits.sort((a, b) => a.area - b.area || a.uiMapId - b.uiMapId).map((hit) => [hit.uiMapId, hit])).keys()];
}
