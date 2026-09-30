import type { AtlasPlacement } from '../../../src/geo/atlas';
import type { AtlasLayout } from '../../../src/geo/atlas-layout';
import { levelBitmaps } from './atlas-index';
import { MINIMAP_BASE_LEVEL, MINIMAP_MAX_LEVEL, MINIMAP_MIN_LEVEL, MINIMAP_TILE, MINIMAP_TILE_TEMPLATE, MINIMAP_UNDERLAY_LEVEL, NAVY } from './minimap-params';
import type { Rgb } from './minimap-texels';

/**
 * Tile keys and the runtime index of the minimap style (docs/research/map-atlas.md §18.4, §21.1):
 *
 * - a **sea key** is a tile every pixel of which is exactly the navy: no file, its sea bit set;
 * - a **stored key** is every other tile, at every level (no virtual keys: "full detail
 *   everywhere", so the runtime never crops an ancestor);
 * - the index has Part I's shape (`map-atlas-index`) with `style: "minimap"`, `baseLevel` 0 (so every
 *   level carries a sea bitmap), `underlayLevel` −6, both sea colours the navy, no painted names, and
 *   the painted index's layout, `atlasHash`, extent, `seamE`, placements and insets.
 *
 * Pure; no bitwise operators (the bitmaps are atlas-pyramid's arithmetic ones).
 */

/** The tile grid of level `z` over the extent: level 0 is `ceil(W / 256) × ceil(H / 256)`; each coarser level halves it, rounding up. */
export function levelGrid(z: number, extentW: number, extentH: number): { readonly nx: number; readonly ny: number } {
  const nx0 = Math.ceil(extentW / MINIMAP_TILE);
  const ny0 = Math.ceil(extentH / MINIMAP_TILE);
  const f = 2 ** -z;
  return { nx: Math.ceil(nx0 / f), ny: Math.ceil(ny0 / f) };
}

export function isSeaTile(d: Uint8Array, sea: Rgb = NAVY): boolean {
  for (let i = 0; i < d.length; i += 3) if (d[i] !== sea[0] || d[i + 1] !== sea[1] || d[i + 2] !== sea[2]) return false;
  return true;
}

export function isFlatTile(d: Uint8Array): boolean {
  for (let i = 3; i < d.length; i += 3) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) return false;
  return true;
}

export interface LevelKeys {
  readonly z: number;
  readonly nx: number;
  readonly ny: number;
  readonly stored: (readonly [number, number])[];
  readonly sea: (readonly [number, number])[];
  /** Stored tiles of one flat colour (not the navy): none expected (§18.4). */
  flatNonSea: number;
}

export function emptyLevels(extentW: number, extentH: number): Map<number, LevelKeys> {
  const out = new Map<number, LevelKeys>();
  for (let z = MINIMAP_MAX_LEVEL; z >= MINIMAP_MIN_LEVEL; z -= 1) {
    const { nx, ny } = levelGrid(z, extentW, extentH);
    out.set(z, { z, nx, ny, stored: [], sea: [], flatNonSea: 0 });
  }
  return out;
}

/** Classifies one tile into its level's keys; returns true when it is stored (has a file). */
export function classify(levels: ReadonlyMap<number, LevelKeys>, z: number, x: number, y: number, d: Uint8Array): boolean {
  const L = levels.get(z);
  if (L === undefined) throw new Error(`level ${String(z)} is not in the pyramid`);
  if (isSeaTile(d)) {
    L.sea.push([x, y]);
    return false;
  }
  if (isFlatTile(d)) L.flatNonSea += 1;
  L.stored.push([x, y]);
  return true;
}

const byKey = (a: readonly [number, number], b: readonly [number, number]): number => a[1] - b[1] || a[0] - b[0];

/** The runtime index (`index.json`), compact JSON and a final LF. */
export function minimapIndexText(layout: AtlasLayout, atlasHash: string, placements: readonly AtlasPlacement[], levels: ReadonlyMap<number, LevelKeys>): string {
  const insets = placements
    .filter((p) => p.kind === 'inset')
    .map((p) => {
      const spec = layout.insets.find((i) => Number(i.mapId) === Number(p.mapId));
      return { mapId: Number(p.mapId), uiMapId: Number(spec?.uiMapId ?? 0), eMin: p.eOff - p.rect.yMax, eMax: p.eOff - p.rect.yMin, sMin: p.sOff - p.rect.xMax, sMax: p.sOff - p.rect.xMin };
    });
  const index = {
    schema: 1,
    kind: 'map-atlas-index',
    style: 'minimap',
    layout: layout.name,
    atlasHash,
    tileSize: MINIMAP_TILE,
    minLevel: MINIMAP_MIN_LEVEL,
    maxLevel: MINIMAP_MAX_LEVEL,
    baseLevel: MINIMAP_BASE_LEVEL,
    underlayLevel: MINIMAP_UNDERLAY_LEVEL,
    template: MINIMAP_TILE_TEMPLATE,
    seaColour: NAVY,
    coastColour: NAVY,
    extent: layout.extent,
    seamE: layout.seamE,
    placements: placements.map((p) => ({ mapId: Number(p.mapId), kind: p.kind, eOff: p.eOff, sOff: p.sOff, rect: { xMin: p.rect.xMin, xMax: p.rect.xMax, yMin: p.rect.yMin, yMax: p.rect.yMax } })),
    insets,
    uiMaps: {},
    levels: Array.from({ length: MINIMAP_MAX_LEVEL - MINIMAP_MIN_LEVEL + 1 }, (_, i) => {
      const L = levels.get(MINIMAP_MIN_LEVEL + i);
      if (L === undefined) throw new Error(`level ${String(MINIMAP_MIN_LEVEL + i)} is missing`);
      return levelBitmaps({ z: L.z, nx: L.nx, ny: L.ny, stored: [...L.stored].sort(byKey), sea: [...L.sea].sort(byKey) });
    }),
  };
  return `${JSON.stringify(index)}\n`;
}
