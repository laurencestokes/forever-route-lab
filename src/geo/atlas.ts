import type { UiMapId, WorldMapId } from '../domain/ids';
import type { WorldPoint } from '../domain/points';
import type { AtlasLayout, AtlasPoint, AtlasRect, AtlasShift } from './atlas-layout';
import type { GeometryAssignment, MapGeometry } from './types';

/**
 * The atlas surface's placements (docs/research/map-atlas.md §5, §8.1; D-042; the interface agreed
 * with docs/research/map-presentation.md in MP.0c and map-atlas.md §8.7).
 *
 * One atlas unit is one yard; `E` grows east and `S` grows south (map-atlas.md §5.1). A world map is
 * placed by translation only, `E = eOff − Y` and `S = sOff − X` (world `x` north, `y` west), so
 * `scale` is 1 everywhere and every zoom constant, the grid, the scale bar and the level-of-detail
 * thresholds keep their meaning. Leaflet's `CRS.Simple` point is `latLng = (−S, E)`.
 *
 * D-017: atlas coordinates are display only. They are never persisted, never used for a distance
 * (`distanceYards` stays per world map and null across maps), and every atlas point resolves to a
 * real `WorldPoint` of exactly one world map (`partition`, `resolveAtlasPoint`). Which modules may
 * import this file for values is fixed by the architecture test's file-level rule (map-atlas.md
 * §8.1, MA-14); it is deliberately not re-exported from `src/geo/index.ts`.
 *
 * Pure: no DOM, clock, randomness or bitwise operators. `atlasHash` is an arithmetic hash (four
 * lanes modulo primes below 2^31), not SHA-256: `src/geo` cannot call a crypto API, and the atlas
 * index and check T4 need the value synchronously.
 */

/**
 * An axis-aligned rectangle of world yards on one world map (x north, y west), edges included.
 * Structurally the same as `map/adapter`'s `WorldBounds`, which `src/geo` does not import.
 */
export interface WorldRect {
  readonly mapId: WorldMapId;
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

/** A map placed from its UiMap 947 row (CITED), moved by the layout's shift. */
export interface AtlasPlacedSource {
  readonly kind: 'placed';
  readonly table: 'UiMapAssignment';
  /** The world UiMap the row belongs to (947). */
  readonly uiMapId: UiMapId;
  /** `UiMapAssignment.ID`. */
  readonly row: number;
  /** The client build the row was read at. */
  readonly build: string;
  readonly layoutShift: AtlasShift;
}

/** A map the client does not place on 947, drawn as a card at the atlas scale (map-atlas.md §5.5). */
export interface AtlasInsetSource {
  readonly kind: 'inset';
  readonly table: 'UiMapAssignment';
  /** The zone UiMap whose row gives the rectangle (2521). */
  readonly uiMapId: UiMapId;
  readonly row: number;
  readonly build: string;
  readonly reason: string;
}

/**
 * Where one world map sits on the atlas. `rect` is the world rectangle the placement covers: the
 * 947 row's rectangle for a placed map, the zone row's for an inset. An inset is an ordinary
 * placement (map-presentation MP.0c).
 */
export interface AtlasPlacement {
  readonly mapId: WorldMapId;
  readonly kind: 'placed' | 'inset';
  /** Atlas units per world yard: 1 for every placement (translation only, D-042 A1). */
  readonly scale: 1;
  readonly eOff: number;
  readonly sOff: number;
  readonly rect: WorldRect;
  readonly source: AtlasPlacedSource | AtlasInsetSource;
}

// =============================================================================================
// Placements

const rowsOfUiMap = (geometry: MapGeometry, uiMapId: UiMapId): readonly GeometryAssignment[] => geometry.maps.get(uiMapId)?.assignments ?? [];

const rowsFor = (rows: readonly GeometryAssignment[], mapId: WorldMapId): readonly GeometryAssignment[] => rows.filter((row) => row.mapId === mapId);

/**
 * Why `atlasPlacements(geometry, layout)` returns null: every row the layout needs that the geometry
 * lacks or holds more than once, and every row that contradicts it. Empty when the layout can be
 * realised.
 *
 * - UiMap 947 must have exactly one row for each placed map (its scale map among them).
 * - Each inset's UiMap must have its named row, on the inset's world map.
 * - 947 must have no row for an inset's map: a later build that places the map (map-atlas.md §5.5,
 *   R9) makes the layout stale, and nothing is guessed until it is updated.
 */
export function atlasLayoutProblems(geometry: MapGeometry, layout: AtlasLayout): readonly string[] {
  const problems: string[] = [];
  const world = layout.worldMap;
  const worldRows = rowsOfUiMap(geometry, world.uiMapId);
  if (!(world.artWidth > 0 && world.artHeight > 0)) problems.push(`UiMap ${String(world.uiMapId)}: the art size must be positive`);
  if (!layout.placed.some((spec) => spec.mapId === world.scaleMapId)) problems.push(`the scale map ${String(world.scaleMapId)} is not placed`);
  for (const spec of layout.placed) {
    const count = rowsFor(worldRows, spec.mapId).length;
    if (count !== 1) problems.push(`UiMap ${String(world.uiMapId)} has ${String(count)} rows for world map ${String(spec.mapId)}, the layout needs exactly 1`);
  }
  for (const inset of layout.insets) {
    const row = rowsOfUiMap(geometry, inset.uiMapId).find((candidate) => candidate.id === inset.row);
    if (row === undefined) problems.push(`UiMap ${String(inset.uiMapId)} has no row ${String(inset.row)} for the inset of world map ${String(inset.mapId)}`);
    else if (row.mapId !== inset.mapId) problems.push(`row ${String(inset.row)} of UiMap ${String(inset.uiMapId)} is on world map ${String(row.mapId)}, not ${String(inset.mapId)}`);
    if (rowsFor(worldRows, inset.mapId).length > 0) {
      problems.push(`UiMap ${String(world.uiMapId)} now places world map ${String(inset.mapId)}: the ${layout.name} layout's inset is stale`);
    }
  }
  return problems;
}

/**
 * The atlas placements of `layout` over the committed geometry (map-atlas.md §5.2, §5.5), placed
 * maps first in the layout's order, then the insets; null when `atlasLayoutProblems` finds any
 * problem, in particular without both 947 rows.
 *
 * A placed map's base translation puts the centre of its 947 row's world rectangle `(Xc, Yc)` where
 * the 947 painting draws it, measured in yards at Kalimdor's 947 scale `K`:
 * `eOff = round(W·(uMin + uMax)/2 · K + Yc)`, `sOff = round(H·(vMin + vMax)/2 · K + Xc)`, the
 * design's `round((pxA + pxB·Yc)·K + Yc)` with the row's pixel affine evaluated at the centre
 * (W × H the 947 art size, `K = (yMax − yMin) / ((uMax − uMin)·W)` of the scale map's row). The
 * layout's shift is then added. An inset's `eOff`, `sOff` put its row's north-west corner
 * (`xMax`, `yMax`) at the layout's corner.
 */
export function atlasPlacements(geometry: MapGeometry, layout: AtlasLayout): readonly AtlasPlacement[] | null {
  if (atlasLayoutProblems(geometry, layout).length > 0) return null;
  const world = layout.worldMap;
  const worldRows = rowsOfUiMap(geometry, world.uiMapId);
  const only = (mapId: WorldMapId): GeometryAssignment | null => rowsFor(worldRows, mapId)[0] ?? null;
  const scaleRow = only(world.scaleMapId);
  if (scaleRow === null) return null;
  const k = (scaleRow.yMax - scaleRow.yMin) / ((scaleRow.uiMax[0] - scaleRow.uiMin[0]) * world.artWidth);
  const out: AtlasPlacement[] = [];
  for (const spec of layout.placed) {
    const row = only(spec.mapId);
    if (row === null) return null;
    const xc = (row.xMin + row.xMax) / 2;
    const yc = (row.yMin + row.yMax) / 2;
    const eBase = Math.round(((world.artWidth * (row.uiMin[0] + row.uiMax[0])) / 2) * k + yc);
    const sBase = Math.round(((world.artHeight * (row.uiMin[1] + row.uiMax[1])) / 2) * k + xc);
    out.push({
      mapId: spec.mapId,
      kind: 'placed',
      scale: 1,
      eOff: eBase + spec.shift.e,
      sOff: sBase + spec.shift.s,
      rect: { mapId: spec.mapId, xMin: row.xMin, xMax: row.xMax, yMin: row.yMin, yMax: row.yMax },
      source: { kind: 'placed', table: 'UiMapAssignment', uiMapId: world.uiMapId, row: row.id, build: row.build, layoutShift: spec.shift },
    });
  }
  for (const inset of layout.insets) {
    const row = rowsOfUiMap(geometry, inset.uiMapId).find((candidate) => candidate.id === inset.row);
    if (row === undefined) return null;
    out.push({
      mapId: inset.mapId,
      kind: 'inset',
      scale: 1,
      eOff: inset.corner.e + row.yMax,
      sOff: inset.corner.s + row.xMax,
      rect: { mapId: inset.mapId, xMin: row.xMin, xMax: row.xMax, yMin: row.yMin, yMax: row.yMax },
      source: { kind: 'inset', table: 'UiMapAssignment', uiMapId: inset.uiMapId, row: row.id, build: row.build, reason: inset.reason },
    });
  }
  return out;
}

/** The placement of `mapId`, or null when the map is not on the atlas (instances, battlegrounds, Darkspear Islands 2997). */
export function placementOf(placements: readonly AtlasPlacement[], mapId: WorldMapId): AtlasPlacement | null {
  return placements.find((placement) => placement.mapId === mapId) ?? null;
}

// =============================================================================================
// Transforms and the partition

/** A world point's atlas position through `placement`: `E = eOff − y`, `S = sOff − x`. The point's own map is the caller's concern. */
export function worldToAtlas(placement: AtlasPlacement, x: number, y: number): AtlasPoint {
  return { e: placement.eOff - y, s: placement.sOff - x };
}

/**
 * The world point of `placement`'s map at an atlas position: `y = eOff − E`, `x = sOff − S`.
 * In doubles the round trip is exact for whole yards and within 10⁻⁹ yd otherwise; picks, which
 * the app rounds to 0.1 yd, round-trip exactly after that rounding (map-atlas.md §5.4, MA-08).
 */
export function atlasToWorld(placement: AtlasPlacement, e: number, s: number): WorldPoint {
  return { mapId: placement.mapId, x: placement.sOff - s, y: placement.eOff - e };
}

/** `placement`'s world rectangle in atlas units: its row rectangle for a placed map, the card for an inset. */
export function atlasRectOf(placement: AtlasPlacement): AtlasRect {
  const { rect } = placement;
  return { eMin: placement.eOff - rect.yMax, eMax: placement.eOff - rect.yMin, sMin: placement.sOff - rect.xMax, sMax: placement.sOff - rect.xMin };
}

/** True when the atlas point is inside the rectangle, edges included. */
export function atlasRectContains(rect: AtlasRect, e: number, s: number): boolean {
  return e >= rect.eMin && e <= rect.eMax && s >= rect.sMin && s <= rect.sMax;
}

/**
 * The one world map an atlas point belongs to (map-atlas.md §5.4): inside an inset's card, the
 * inset's map; otherwise the layout's `west` map when `E ≤ seamE` and its `east` map beyond. It is
 * total, so a click anywhere yields a point of a real map and `MapEvent` is unchanged (D-042 A5).
 * Throws only when `placements` do not come from `layout` (a layout without a west or east map).
 */
export function partition(placements: readonly AtlasPlacement[], layout: AtlasLayout, e: number, s: number): WorldMapId {
  for (const placement of placements) {
    if (placement.kind === 'inset' && atlasRectContains(atlasRectOf(placement), e, s)) return placement.mapId;
  }
  const side = e <= layout.seamE ? 'west' : 'east';
  const spec = layout.placed.find((candidate) => candidate.side === side);
  if (spec === undefined) throw new RangeError(`the ${layout.name} atlas layout has no ${side} map`);
  return spec.mapId;
}

/** The world point under an atlas point: `partition`, then that map's inverse. Null only when the partition's map has no placement (placements not from `layout`). */
export function resolveAtlasPoint(placements: readonly AtlasPlacement[], layout: AtlasLayout, e: number, s: number): WorldPoint | null {
  const placement = placementOf(placements, partition(placements, layout, e, s));
  return placement === null ? null : atlasToWorld(placement, e, s);
}

// =============================================================================================
// Identity

export const ATLAS_CANONICAL_FORMAT = 'frl-atlas-layout';
export const ATLAS_CANONICAL_VERSION = 1;

/**
 * The canonical string `atlasHash` is taken over (version 1): `JSON.stringify` of
 *
 * ```
 * ["frl-atlas-layout", 1, name, [eMin, eMax, sMin, sMax], seamE,
 *   [worldUiMapId, artWidth, artHeight, scaleMapId],
 *   [[mapId, kind, scale, eOff, sOff, xMin, xMax, yMin, yMax, uiMapId, row, build, shiftE|null, shiftS|null, side|null, cornerE|null, cornerS|null], …]]
 * ```
 *
 * with placements ascending by world map id, so the order they are built in never matters.
 * Everything that decides where a pixel of the raster lies or which map a click resolves to is in
 * it; free text (the inset's reason, the art size's source, the layout's basis) is provenance and
 * is not. Numbers are ECMAScript's shortest round-trip form.
 */
export function canonicalAtlasString(placements: readonly AtlasPlacement[], layout: AtlasLayout): string {
  const world = layout.worldMap;
  const rows = [...placements]
    .sort((a, b) => a.mapId - b.mapId)
    .map((placement) => {
      const { rect, source } = placement;
      const placed = layout.placed.find((spec) => spec.mapId === placement.mapId) ?? null;
      const inset = layout.insets.find((spec) => spec.mapId === placement.mapId) ?? null;
      return [
        placement.mapId,
        placement.kind,
        placement.scale,
        placement.eOff,
        placement.sOff,
        rect.xMin,
        rect.xMax,
        rect.yMin,
        rect.yMax,
        source.uiMapId,
        source.row,
        source.build,
        source.kind === 'placed' ? source.layoutShift.e : null,
        source.kind === 'placed' ? source.layoutShift.s : null,
        placed === null ? null : placed.side,
        inset === null ? null : inset.corner.e,
        inset === null ? null : inset.corner.s,
      ];
    });
  const { extent } = layout;
  return JSON.stringify([
    ATLAS_CANONICAL_FORMAT,
    ATLAS_CANONICAL_VERSION,
    layout.name,
    [extent.eMin, extent.eMax, extent.sMin, extent.sMax],
    layout.seamE,
    [world.uiMapId, world.artWidth, world.artHeight, world.scaleMapId],
    rows,
  ]);
}

/** Four hash lanes: `h = (h·base + code unit) mod modulus`, each modulus a prime below 2^31, so every step is exact in doubles (< 2^40). */
const HASH_LANES: readonly (readonly [base: number, modulus: number])[] = [
  [257, 2147483647],
  [263, 2147483629],
  [269, 2147483587],
  [271, 2147483579],
];

/**
 * The atlas identity (map-atlas.md §7.2, §7.5 T4): 32 lowercase hex digits, four 31-bit
 * polynomial hashes of `canonicalAtlasString` over its UTF-16 code units. The atlas index records
 * it; the runtime refuses an index whose value differs from this one, and T4 checks the committed
 * index against it. It notices any change to the layout constant or to the rows the placements come
 * from; it is a change detector, not a cryptographic digest.
 */
export function atlasHash(placements: readonly AtlasPlacement[], layout: AtlasLayout): string {
  const text = canonicalAtlasString(placements, layout);
  return HASH_LANES.map(([base, modulus]) => {
    let h = 0;
    for (let i = 0; i < text.length; i += 1) h = (h * base + text.charCodeAt(i)) % modulus;
    return h.toString(16).padStart(8, '0');
  }).join('');
}
