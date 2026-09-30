import type { AtlasPlacement } from '../../../src/geo/atlas';
import type { AtlasLayout } from '../../../src/geo/atlas-layout';
import { ART_H, ART_W, BASE_LEVEL, CITY_UIMAPS, TILE, ZONE_CAPITAL_AREA } from './atlas-params';

/**
 * Which paintings the atlas draws, where, and at which levels (docs/research/map-atlas.md §6.1,
 * §7.1): pure, from plain rows (the client's `UiMap` and `UiMapAssignment` rows, the art sizes,
 * the terrain's zone lists and the atlas placements), so tests build them by hand.
 *
 * - Continents (UiMap type 2) are read, never drawn: their land colouring is the land test and the
 *   tint of areas no zone painting has (§6.2 steps 2 and 3).
 * - Zones (type 3 on maps 0 and 1, not a city) are drawn over their terrain polygon: the area of
 *   their row, plus the capital's area where the painting also draws the capital.
 * - Cities (the design's list): over their own polygon when the terrain has their area, else as a card.
 * - The top stored level of a source is the nearest level `round(−log₂ yd/px)`, one finer when that
 *   is coarser than the art by more than the round-up factor (D-042 O10), and never finer than 0.
 */

export type AtlasSourceClass = 'continent' | 'zone' | 'city';

export interface AtlasBounds {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

export interface AtlasSourceSpec {
  readonly uiMapId: number;
  readonly name: string;
  readonly cls: AtlasSourceClass;
  readonly mapId: number;
  /** `UiMapAssignment.ID` of the UiMap's single full-rectangle row, and its world rectangle. */
  readonly assignment: number;
  readonly bounds: AtlasBounds;
  /** Yards per source pixel. */
  readonly ydpx: number;
  /** The nearest level and the stored top level (O10). */
  readonly tNearest: number;
  readonly t: number;
  /** Tile yards per pixel at `t` over the art's: above 1 the tiles are coarser than the art. */
  readonly loss: number;
  /** The terrain areas the painting is drawn over, or null (continents, and cities drawn as cards). */
  readonly areas: readonly number[] | null;
  /** The painting's rectangle in atlas units. */
  readonly E0: number;
  readonly E1: number;
  readonly S0: number;
  readonly S1: number;
  /** Its world map's placement offsets. */
  readonly eOff: number;
  readonly sOff: number;
}

export interface InsetSpec {
  readonly uiMapId: number;
  readonly name: string;
  readonly mapId: number;
  readonly assignment: number;
  readonly bounds: AtlasBounds;
  /** Card corner and size in atlas units. */
  readonly e0: number;
  readonly s0: number;
  readonly w: number;
  readonly h: number;
  readonly ydpx: number;
  readonly top: number;
}

export interface PlanUiMap {
  readonly id: number;
  readonly name: string;
  readonly type: number;
}

export interface PlanAssignment {
  readonly id: number;
  readonly uiMapId: number;
  readonly orderIndex: number;
  readonly mapId: number;
  readonly areaId: number;
  /** Region_0 … Region_5: min X, min Y, min Z, max X, max Y, max Z. */
  readonly region: readonly number[];
  readonly uiMin: readonly number[];
  readonly uiMax: readonly number[];
}

export interface AtlasPlanInputs {
  readonly uiMaps: readonly PlanUiMap[];
  readonly assignments: readonly PlanAssignment[];
  /** Art size per UiMap (layer 0). */
  readonly artSize: ReadonlyMap<number, { readonly width: number; readonly height: number }>;
  /** The terrain byproducts' zone ids per world map (`zones.json` `zones`). */
  readonly terrainZones: ReadonlyMap<number, readonly number[]>;
  readonly placements: readonly AtlasPlacement[];
  readonly roundUp: number;
}

export interface AtlasPlan {
  /** Continents, zones and cities, coarsest art first (yd/px descending), then by UiMap id: the drawing and summing order. */
  readonly sources: readonly AtlasSourceSpec[];
  readonly insets: readonly InsetSpec[];
}

const full = (row: PlanAssignment): boolean => row.uiMin[0] === 0 && row.uiMin[1] === 0 && row.uiMax[0] === 1 && row.uiMax[1] === 1;

function boundsOf(row: PlanAssignment): AtlasBounds {
  const [xMin, yMin, , xMax, yMax] = row.region;
  if (xMin === undefined || yMin === undefined || xMax === undefined || yMax === undefined) throw new Error(`UiMapAssignment ${String(row.id)}: Region has fewer than 5 values`);
  return { xMin, xMax, yMin, yMax };
}

/** `t` and `tNearest` of a source of `ydpx` yards per pixel (§7.1, O10); `|| 0` turns −0 into 0. */
export function topLevels(ydpx: number, roundUp: number): { readonly tNearest: number; readonly t: number; readonly loss: number } {
  const tn = Math.round(-Math.log2(ydpx));
  const nearestLoss = 2 ** -tn / ydpx;
  const t = Math.min(0, tn + (nearestLoss > roundUp ? 1 : 0)) || 0;
  return { tNearest: Math.min(0, tn) || 0, t, loss: 2 ** -Math.min(0, t) / ydpx };
}

export function planAtlas(inputs: AtlasPlanInputs): AtlasPlan {
  const byUiMap = new Map<number, PlanAssignment[]>();
  for (const row of inputs.assignments) {
    const list = byUiMap.get(row.uiMapId);
    if (list === undefined) byUiMap.set(row.uiMapId, [row]);
    else list.push(row);
  }
  const placed = new Map(inputs.placements.filter((p) => p.kind === 'placed').map((p) => [Number(p.mapId), p]));
  const sources: AtlasSourceSpec[] = [];
  for (const uiMap of [...inputs.uiMaps].sort((a, b) => a.id - b.id)) {
    const rows = byUiMap.get(uiMap.id) ?? [];
    const [row] = rows;
    if (rows.length !== 1 || row === undefined || row.orderIndex !== 0 || !full(row)) continue;
    const placement = placed.get(row.mapId);
    if (placement === undefined) continue;
    const size = inputs.artSize.get(uiMap.id);
    if (size === undefined || size.width !== ART_W || size.height !== ART_H) continue;
    const cls: AtlasSourceClass | null = CITY_UIMAPS.includes(uiMap.id) ? 'city' : uiMap.type === 2 ? 'continent' : uiMap.type === 3 ? 'zone' : null;
    if (cls === null) continue;
    const b = boundsOf(row);
    const ydpx = (b.yMax - b.yMin) / ART_W;
    const levels = topLevels(ydpx, inputs.roundUp);
    const list = inputs.terrainZones.get(row.mapId) ?? [];
    let areas: number[] | null = null;
    if (cls === 'zone') {
      const capital = ZONE_CAPITAL_AREA[uiMap.id];
      areas = [row.areaId, ...(capital === undefined ? [] : [capital])].filter((a) => list.includes(a));
      if (areas.length === 0) areas = null;
    } else if (cls === 'city') areas = list.includes(row.areaId) ? [row.areaId] : null;
    sources.push({
      uiMapId: uiMap.id,
      name: uiMap.name,
      cls,
      mapId: row.mapId,
      assignment: row.id,
      bounds: b,
      ydpx,
      ...levels,
      areas,
      E0: placement.eOff - b.yMax,
      E1: placement.eOff - b.yMin,
      S0: placement.sOff - b.xMax,
      S1: placement.sOff - b.xMin,
      eOff: placement.eOff,
      sOff: placement.sOff,
    });
  }
  sources.sort((a, c) => c.ydpx - a.ydpx || a.uiMapId - c.uiMapId);
  const insets: InsetSpec[] = [];
  for (const placement of inputs.placements) {
    if (placement.kind !== 'inset' || placement.source.kind !== 'inset') continue;
    const uiMapId = Number(placement.source.uiMapId);
    const row = (byUiMap.get(uiMapId) ?? []).find((r) => r.id === placement.source.row);
    if (row === undefined) throw new Error(`the inset's row ${String(placement.source.row)} of UiMap ${String(uiMapId)} is not in the client tables`);
    const b = boundsOf(row);
    const ydpx = (b.yMax - b.yMin) / ART_W;
    const name = inputs.uiMaps.find((u) => u.id === uiMapId)?.name ?? '';
    insets.push({
      uiMapId,
      name,
      mapId: row.mapId,
      assignment: row.id,
      bounds: b,
      e0: placement.eOff - b.yMax,
      s0: placement.sOff - b.xMax,
      w: b.yMax - b.yMin,
      h: b.xMax - b.xMin,
      ydpx,
      // a card is composed at level −2 and coarser only (§6.1: the Zephras Isle card's top level is −2)
      top: Math.min(BASE_LEVEL, Math.round(-Math.log2(ydpx))),
    });
  }
  return { sources, insets };
}

/** The level −2 tile grid over the layout's extent (§7.1): tile (0, 0) starts at the origin. */
export function baseGrid(layout: AtlasLayout): { readonly tw: number; readonly th: number } {
  const p = 2 ** -BASE_LEVEL;
  return { tw: Math.ceil((layout.extent.eMax - layout.extent.eMin) / p / TILE), th: Math.ceil((layout.extent.sMax - layout.extent.sMin) / p / TILE) };
}

/** Tile grid size at level `z` over a level −2 grid of `tw × th` tiles. */
export function gridAt(z: number, tw: number, th: number): { readonly nx: number; readonly ny: number } {
  return { nx: Math.ceil((tw * TILE * 2 ** (z - BASE_LEVEL)) / TILE), ny: Math.ceil((th * TILE * 2 ** (z - BASE_LEVEL)) / TILE) };
}
