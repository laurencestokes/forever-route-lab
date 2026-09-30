/**
 * A synthetic atlas world for the tests only (no client bytes): two small world maps placed by a
 * synthetic UiMap 947, one zone painting on map 1 over a square island of two terrain areas, and a
 * card. Every raster is made in memory.
 *
 * World map 1 (west): its 947 row covers X −1,336…1,336, Y −2,004…2,004 at 4 yd per 947 px, so
 * `eOff` 2,004 and `sOff` 1,336 (E 0…4,008, S 0…2,672). The island is X −800…800, Y −1,200…1,200:
 * area 10 (the zone's own polygon) where Y ≥ 0, area 20 where Y < 0. The zone painting (UiMap 5001)
 * covers the whole row at 4 yd/px (top level −2); its explored-overlay union paints only X > 0, and it
 * is a flat colour except where a test draws a label. The continent painting (UiMap 5000, read for
 * the land test and the tint, never drawn) shows land everywhere except its right part (u ≥ 700,
 * world Y < −796), so area 20's land there is dropped. World map 0 (east) is all sea. The card
 * (UiMap 5002, map 2991) is 1,002 × 668 yd at E 4,096, S 3,072.
 */
import sharp from 'sharp';
import { parseGeometryFile } from '../../../src/geo/geometry';
import { uiMapId, worldMapId } from '../../../src/domain/ids';
import type { AtlasLayout } from '../../../src/geo/atlas-layout';
import type { MapGeometry } from '../../../src/geo/types';
import type { ArtSourceEntry } from './art-manifest';
import type { AtlasBuildInputs, AtlasRasterInput, TerrainMapInput } from './atlas-build';
import type { AtlasLabelEntry } from './atlas-labels';
import { reliefGrid, type ReliefGrid, type ZoneArc } from './atlas-mask';
import { RELIEF_WATER } from './atlas-params';
import type { PlanAssignment, PlanUiMap } from './atlas-plan';
import { sha256Hex } from './hash';
import { rasterSha256, type Rgba } from './raster';

export const ZONE_COLOUR: readonly [number, number, number] = [200, 40, 40];
export const CARD_COLOUR: readonly [number, number, number] = [30, 160, 60];
export const LABEL_COLOUR: readonly [number, number, number] = [250, 250, 250];
export const CONTINENT_LAND: readonly [number, number, number] = [220, 150, 60];
export const CONTINENT_SEA: readonly [number, number, number] = [60, 90, 160];

/** The continent painting: land colour, with a sea-coloured band at u ≥ 700. */
export function continentRaster(): Rgba {
  return flatRaster(CONTINENT_LAND, [{ box: [700, 0, 1001, 667], colour: CONTINENT_SEA }]);
}

export const SYNTH_LAYOUT: AtlasLayout = {
  name: 'compact',
  worldMap: { uiMapId: uiMapId(947), artWidth: 1002, artHeight: 668, scaleMapId: worldMapId(1), source: 'synthetic' },
  placed: [
    { mapId: worldMapId(1), side: 'west', shift: { e: 0, s: 0 } },
    { mapId: worldMapId(0), side: 'east', shift: { e: 5120, s: 0 } },
  ],
  insets: [{ mapId: worldMapId(2991), uiMapId: uiMapId(5002), row: 9002, corner: { e: 4096, s: 3072 }, reason: 'synthetic' }],
  seamE: 4608,
  extent: { eMin: 0, eMax: 10240, sMin: 0, sMax: 4096 },
  basis: 'synthetic',
};

const row = (id: number, mapId: number, region: readonly number[], orderIndex = 0): Record<string, unknown> => ({
  id,
  mapId,
  areaId: 0,
  orderIndex,
  xMin: region[0],
  xMax: region[3],
  yMin: region[1],
  yMax: region[4],
  uiMin: [0, 0],
  uiMax: [1, 1],
  source: 'local-db2',
  build: '1.60.1.70009',
});

export function synthGeometry(): MapGeometry {
  const maps = {
    '947': { name: 'Azeroth', nameSource: 'local-db2', type: 1, parent: 0, assignments: [row(9000, 1, [-1336, -2004, 0, 1336, 2004, 0]), row(9001, 0, [-1336, -2004, 0, 1336, 2004, 0], 1)] },
    '5002': { name: 'Card Isle', nameSource: 'local-db2', type: 3, parent: 947, assignments: [row(9002, 2991, [0, 0, 0, 668, 1002, 0])] },
  };
  const parsed = parseGeometryFile({ schema: 1, kind: 'local', redistribution: 'local-only', product: 'wow_classic_beta', build: '1.60.1.70009', maps, eraToForever: {} });
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.geometry;
}

export const SYNTH_UIMAPS: readonly PlanUiMap[] = [
  { id: 947, name: 'Azeroth', type: 1 },
  { id: 5000, name: 'Test Continent', type: 2 },
  { id: 5001, name: 'Test Zone', type: 3 },
  { id: 5002, name: 'Card Isle', type: 3 },
];

export const SYNTH_ASSIGNMENTS: readonly PlanAssignment[] = [
  { id: 9000, uiMapId: 947, orderIndex: 0, mapId: 1, areaId: 0, region: [-1336, -2004, 0, 1336, 2004, 0], uiMin: [0, 0], uiMax: [1, 1] },
  { id: 9001, uiMapId: 947, orderIndex: 1, mapId: 0, areaId: 0, region: [-1336, -2004, 0, 1336, 2004, 0], uiMin: [0, 0], uiMax: [1, 1] },
  { id: 9004, uiMapId: 5000, orderIndex: 0, mapId: 1, areaId: 0, region: [-1336, -2004, 0, 1336, 2004, 0], uiMin: [0, 0], uiMax: [1, 1] },
  { id: 9003, uiMapId: 5001, orderIndex: 0, mapId: 1, areaId: 10, region: [-1336, -2004, 0, 1336, 2004, 0], uiMin: [0, 0], uiMax: [1, 1] },
  { id: 9002, uiMapId: 5002, orderIndex: 0, mapId: 2991, areaId: 30, region: [0, 0, 0, 668, 1002, 0], uiMin: [0, 0], uiMax: [1, 1] },
];

/** The island's arcs: area 10 (Y ≥ 0) and area 20 (Y < 0), each against the sea (0) and each other. */
export const ISLAND_ARCS: readonly ZoneArc[] = [
  [10, 0, -800, 0, 0, 1200, 1600, 0, 0, -1200],
  [10, 20, 800, 0, -1600, 0],
  [20, 0, -800, 0, 0, -1200, 1600, 0, 0, 1200],
];

export const RELIEF_RECT = { xMin: -2048, xMax: 2048, yMin: -2048, yMax: 2048 } as const;
export const RELIEF_CELL = 16;

/** Relief RGBA of map 1: land (grey `grey(X, Y)`) on the island, sea water elsewhere. */
export function islandRelief(grey: (X: number, Y: number) => number = () => 150): { w: number; h: number; d: Uint8Array } {
  const w = (RELIEF_RECT.yMax - RELIEF_RECT.yMin) / RELIEF_CELL;
  const h = (RELIEF_RECT.xMax - RELIEF_RECT.xMin) / RELIEF_CELL;
  const d = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r += 1) {
    for (let c = 0; c < w; c += 1) {
      const X = RELIEF_RECT.xMax - (r + 0.5) * RELIEF_CELL;
      const Y = RELIEF_RECT.yMax - (c + 0.5) * RELIEF_CELL;
      const land = X > -800 && X < 800 && Y > -1200 && Y < 1200;
      const g = grey(X, Y);
      const px = land ? [g, g, g] : RELIEF_WATER;
      const o = (r * w + c) * 4;
      d[o] = px[0] ?? 0;
      d[o + 1] = px[1] ?? 0;
      d[o + 2] = px[2] ?? 0;
      d[o + 3] = 255;
    }
  }
  return { w, h, d };
}

export function islandGrid(): ReliefGrid {
  const r = islandRelief();
  return reliefGrid(1, r.d, r.w, r.h, RELIEF_CELL, RELIEF_RECT, ISLAND_ARCS);
}

/** A 1002 × 668 raster of one colour, with optional boxes of other colours. */
export function flatRaster(colour: readonly number[], boxes: readonly { box: readonly number[]; colour: readonly number[] }[] = [], alpha = 255): Rgba {
  const data = new Uint8Array(1002 * 668 * 4);
  for (let y = 0; y < 668; y += 1) {
    for (let x = 0; x < 1002; x += 1) {
      let c = colour;
      for (const b of boxes) if (x >= (b.box[0] ?? 0) && x <= (b.box[2] ?? 0) && y >= (b.box[1] ?? 0) && y <= (b.box[3] ?? 0)) c = b.colour;
      const o = (y * 1002 + x) * 4;
      data[o] = c[0] ?? 0;
      data[o + 1] = c[1] ?? 0;
      data[o + 2] = c[2] ?? 0;
      data[o + 3] = c[3] ?? alpha;
    }
  }
  return { width: 1002, height: 668, data };
}

/** The zone's overlay union: painted (alpha 255) where the painting's v < 334 (world X > 0), transparent elsewhere. */
export function overlayUnion(): Rgba {
  const data = new Uint8Array(1002 * 668 * 4);
  for (let y = 0; y < 334; y += 1) for (let x = 0; x < 1002; x += 1) data[(y * 1002 + x) * 4 + 3] = 255;
  return { width: 1002, height: 668, data };
}

function record(uiMapId: number, full: Rgba, overlays: Rgba | null): ArtSourceEntry {
  return { uiMapId, layer: 0, name: `UiMap ${String(uiMapId)}`, width: 1002, height: 668, pixelsSha256: rasterSha256(full), overlaysSha256: overlays === null ? null : rasterSha256(overlays), inputHash: sha256Hex(`synthetic ${String(uiMapId)}`) };
}

async function png(img: { w: number; h: number; d: Uint8Array }): Promise<Buffer> {
  return sharp(Buffer.from(img.d), { raw: { width: img.w, height: img.h, channels: 4 } }).png().toBuffer();
}

/** The whole synthetic build input; `zone` overrides the zone painting (labels). */
export async function synthBuildInputs(options: { zone?: Rgba; labels?: readonly AtlasLabelEntry[] } = {}): Promise<AtlasBuildInputs> {
  const zone = options.zone ?? flatRaster(ZONE_COLOUR);
  const overlays = overlayUnion();
  const card = flatRaster(CARD_COLOUR);
  const continent = continentRaster();
  const rasters = new Map<number, AtlasRasterInput>([
    [5000, { full: continent, overlays: null, record: record(5000, continent, null) }],
    [5001, { full: zone, overlays, record: record(5001, zone, overlays) }],
    [5002, { full: card, overlays: null, record: record(5002, card, null) }],
  ]);
  const relief1 = await png(islandRelief());
  const sea0 = await png({ w: 16, h: 16, d: new Uint8Array(16 * 16 * 4).map((_, i) => (i % 4 === 3 ? 255 : (RELIEF_WATER[i % 4] ?? 0))) });
  const zones1 = Buffer.from(JSON.stringify({ zones: [10, 20], arcs: ISLAND_ARCS }));
  const zones0 = Buffer.from(JSON.stringify({ zones: [], arcs: [] }));
  const terrain: TerrainMapInput[] = [
    { mapId: 0, reliefPath: '0/relief.png', reliefPng: sea0, reliefSha256: sha256Hex(sea0), zonesPath: '0/zones.json', zonesBytes: zones0, zonesSha256: sha256Hex(zones0), rect: { xMin: -2048, xMax: 2048, yMin: -2048, yMax: 2048 }, pixelYd: 256 },
    { mapId: 1, reliefPath: '1/relief.png', reliefPng: relief1, reliefSha256: sha256Hex(relief1), zonesPath: '1/zones.json', zonesBytes: zones1, zonesSha256: sha256Hex(zones1), rect: RELIEF_RECT, pixelYd: RELIEF_CELL },
  ];
  const labels = options.labels ?? [];
  const labelsText = JSON.stringify(labels);
  return {
    layout: SYNTH_LAYOUT,
    geometry: synthGeometry(),
    uiMaps: SYNTH_UIMAPS,
    assignments: SYNTH_ASSIGNMENTS,
    artSize: new Map([
      [5000, { width: 1002, height: 668 }],
      [5001, { width: 1002, height: 668 }],
      [5002, { width: 1002, height: 668 }],
    ]),
    rasters,
    artSources: [...rasters.values()].map((r) => r.record),
    terrain,
    labels: { labels },
    labelsFile: { path: 'tools/maps/inputs/atlas-labels.json', sha256: sha256Hex(labelsText) },
  };
}
