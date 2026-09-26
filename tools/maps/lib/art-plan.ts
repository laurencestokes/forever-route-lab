import type { PixelRect } from './raster';

/**
 * Which BLP tiles make each UiMap's painted image, and where they go (docs/MAPS.md §3, §5.4 (b);
 * terrain-navigation.md §13.4; D-033). Pure: it works on plain rows, which `client-tables.ts`
 * reads from the client's DB2 tables and tests build by hand.
 *
 * Rules, as the client's world map draws the art:
 *
 * - `UiMapXMapArt` links a UiMap to a `UiMapArt` (phase 0 only: one row per UiMap at the pin);
 *   the art names a style, whose `UiMapArtStyleLayer` rows give each layer's canvas
 *   (`LayerWidth × LayerHeight`) and tile size.
 * - `UiMapArtTile` rows of the art and layer are drawn at `(ColIndex · TileWidth,
 *   RowIndex · TileHeight)`; the canvas crops the edge tiles (4 × 3 tiles of 256 for 1002 × 668).
 *   Every cell of the tile grid must have exactly one tile.
 * - Explored areas ("fully explored" image): every `WorldMapOverlay` of the art with
 *   `PlayerConditionID` 0, in ID order. Its `WorldMapOverlayTile` rows of the layer are drawn at
 *   `(OffsetX + ColIndex · TileWidth, OffsetY + RowIndex · TileHeight)` at the file's own pixel
 *   size and cut to the overlay's rectangle `(OffsetX, OffsetY, TextureWidth, TextureHeight)`, then
 *   to the canvas. The grid is ceil(TextureWidth / TileWidth) × ceil(TextureHeight / TileHeight).
 *   An overlay without tiles is skipped and reported.
 */

export interface UiMapRow {
  readonly id: number;
  readonly name: string;
  readonly type: number;
  readonly parent: number;
}
export interface XMapArtRow {
  readonly id: number;
  readonly uiMapId: number;
  readonly uiMapArtId: number;
  readonly phaseId: number;
}
export interface ArtRow {
  readonly id: number;
  readonly styleId: number;
}
export interface StyleLayerRow {
  readonly id: number;
  readonly styleId: number;
  readonly layerIndex: number;
  readonly layerWidth: number;
  readonly layerHeight: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
}
export interface ArtTileRow {
  readonly id: number;
  readonly uiMapArtId: number;
  readonly row: number;
  readonly col: number;
  readonly layerIndex: number;
  readonly fileDataId: number;
}
export interface OverlayRow {
  readonly id: number;
  readonly uiMapArtId: number;
  readonly textureWidth: number;
  readonly textureHeight: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly playerConditionId: number;
  readonly flags: number;
  readonly areaIds: readonly number[];
}
export interface OverlayTileRow {
  readonly id: number;
  readonly overlayId: number;
  readonly row: number;
  readonly col: number;
  readonly layerIndex: number;
  readonly fileDataId: number;
}

export interface ArtTables {
  readonly uiMaps: readonly UiMapRow[];
  readonly xMapArt: readonly XMapArtRow[];
  readonly art: readonly ArtRow[];
  readonly styleLayers: readonly StyleLayerRow[];
  readonly artTiles: readonly ArtTileRow[];
  readonly overlays: readonly OverlayRow[];
  readonly overlayTiles: readonly OverlayTileRow[];
}

export interface TilePlacement {
  readonly row: number;
  readonly col: number;
  readonly fileDataId: number;
  /** Top-left pixel on the canvas. */
  readonly x: number;
  readonly y: number;
}

export interface OverlayPlan {
  readonly id: number;
  readonly areaIds: readonly number[];
  readonly flags: number;
  /** `(OffsetX, OffsetY)` and `TextureWidth × TextureHeight`, uncut. */
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** The overlay rectangle cut to the canvas; tiles are drawn only inside it. */
  readonly clip: PixelRect;
  readonly tiles: readonly TilePlacement[];
}

export interface ArtPlan {
  readonly uiMapId: number;
  readonly name: string;
  readonly uiMapType: number;
  readonly uiMapArtId: number;
  readonly styleId: number;
  readonly layerIndex: number;
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  /** Row-major. */
  readonly tiles: readonly TilePlacement[];
  /** ID order. */
  readonly overlays: readonly OverlayPlan[];
}

export interface PlanReport {
  readonly plans: readonly ArtPlan[];
  /** UiMaps without art, or whose art is not drawn, with the reason. */
  readonly skippedUiMaps: readonly { readonly uiMapId: number; readonly reason: string }[];
  /** Overlays left out of an image, with the reason. */
  readonly skippedOverlays: readonly { readonly uiMapId: number; readonly overlayId: number; readonly reason: string }[];
}

/** The published file name of one plan: `<uiMapId>.webp` for layer 0, `<uiMapId>-<layer>.webp` otherwise. */
export function artFileName(plan: Pick<ArtPlan, 'uiMapId' | 'layerIndex'>, extension: string): string {
  return plan.layerIndex === 0 ? `${String(plan.uiMapId)}.${extension}` : `${String(plan.uiMapId)}-${String(plan.layerIndex)}.${extension}`;
}

const byId = <T extends { readonly id: number }>(a: T, b: T): number => a.id - b.id;

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list === undefined) out.set(k, [row]);
    else list.push(row);
  }
  return out;
}

/** Places a grid of tiles, requiring exactly one tile per cell of `rows × cols`. */
function placeGrid(
  tiles: readonly { readonly row: number; readonly col: number; readonly fileDataId: number }[],
  rows: number,
  cols: number,
  tileWidth: number,
  tileHeight: number,
  origin: { readonly x: number; readonly y: number },
  what: string,
): TilePlacement[] {
  const cells = new Map<number, TilePlacement>();
  for (const t of tiles) {
    if (t.row >= rows || t.col >= cols) throw new Error(`${what}: tile (${String(t.row)}, ${String(t.col)}) is outside its ${String(rows)} × ${String(cols)} grid`);
    const key = t.row * cols + t.col;
    if (cells.has(key)) throw new Error(`${what}: two tiles at (${String(t.row)}, ${String(t.col)})`);
    if (!Number.isInteger(t.fileDataId) || t.fileDataId <= 0) throw new Error(`${what}: tile (${String(t.row)}, ${String(t.col)}) has FileDataID ${String(t.fileDataId)}`);
    cells.set(key, { row: t.row, col: t.col, fileDataId: t.fileDataId, x: origin.x + t.col * tileWidth, y: origin.y + t.row * tileHeight });
  }
  if (cells.size !== rows * cols) throw new Error(`${what}: ${String(cells.size)} tiles for a ${String(rows)} × ${String(cols)} grid`);
  return [...cells.entries()].sort((a, b) => a[0] - b[0]).map(([, placement]) => placement);
}

/** The drawing plan of every UiMap with art, in UiMapID order, and one per style layer. */
export function planArt(tables: ArtTables): PlanReport {
  const plans: ArtPlan[] = [];
  const skippedUiMaps: { uiMapId: number; reason: string }[] = [];
  const skippedOverlays: { uiMapId: number; overlayId: number; reason: string }[] = [];
  const links = groupBy(tables.xMapArt, (r) => r.uiMapId);
  const artById = new Map(tables.art.map((r) => [r.id, r]));
  const layersByStyle = groupBy(tables.styleLayers, (r) => r.styleId);
  const tilesByArt = groupBy(tables.artTiles, (r) => r.uiMapArtId);
  const overlaysByArt = groupBy(tables.overlays, (r) => r.uiMapArtId);
  const overlayTiles = groupBy(tables.overlayTiles, (r) => r.overlayId);
  for (const uiMap of [...tables.uiMaps].sort(byId)) {
    const linked = links.get(uiMap.id) ?? [];
    const phase0 = linked.filter((r) => r.phaseId === 0);
    if (linked.length === 0) {
      skippedUiMaps.push({ uiMapId: uiMap.id, reason: 'no UiMapXMapArt row' });
      continue;
    }
    if (phase0.length === 0) {
      skippedUiMaps.push({ uiMapId: uiMap.id, reason: `only phased art (PhaseID ${linked.map((r) => String(r.phaseId)).join(', ')})` });
      continue;
    }
    if (phase0.length > 1) throw new Error(`UiMap ${String(uiMap.id)}: ${String(phase0.length)} UiMapXMapArt rows for phase 0`);
    const link = phase0[0];
    if (link === undefined) continue;
    const art = artById.get(link.uiMapArtId);
    if (art === undefined) throw new Error(`UiMap ${String(uiMap.id)}: UiMapArt ${String(link.uiMapArtId)} does not exist`);
    const layers = [...(layersByStyle.get(art.styleId) ?? [])].sort((a, b) => a.layerIndex - b.layerIndex);
    if (layers.length === 0) throw new Error(`UiMap ${String(uiMap.id)}: art style ${String(art.styleId)} has no UiMapArtStyleLayer`);
    if (new Set(layers.map((l) => l.layerIndex)).size !== layers.length) throw new Error(`art style ${String(art.styleId)} repeats a LayerIndex`);
    const artTiles = tilesByArt.get(art.id) ?? [];
    for (const layer of layers) {
      const what = `UiMap ${String(uiMap.id)} art ${String(art.id)} layer ${String(layer.layerIndex)}`;
      const { layerWidth: width, layerHeight: height, tileWidth, tileHeight } = layer;
      if (width < 1 || height < 1 || tileWidth < 1 || tileHeight < 1) throw new Error(`${what}: layer or tile size is zero`);
      const tiles = placeGrid(
        artTiles.filter((t) => t.layerIndex === layer.layerIndex),
        Math.ceil(height / tileHeight),
        Math.ceil(width / tileWidth),
        tileWidth,
        tileHeight,
        { x: 0, y: 0 },
        what,
      );
      const overlays: OverlayPlan[] = [];
      for (const overlay of [...(overlaysByArt.get(art.id) ?? [])].sort(byId)) {
        if (overlay.playerConditionId !== 0) {
          skippedOverlays.push({ uiMapId: uiMap.id, overlayId: overlay.id, reason: `PlayerConditionID ${String(overlay.playerConditionId)}` });
          continue;
        }
        const own = (overlayTiles.get(overlay.id) ?? []).filter((t) => t.layerIndex === layer.layerIndex);
        if (own.length === 0) {
          skippedOverlays.push({ uiMapId: uiMap.id, overlayId: overlay.id, reason: 'no WorldMapOverlayTile rows' });
          continue;
        }
        if (overlay.textureWidth < 1 || overlay.textureHeight < 1) throw new Error(`${what}: overlay ${String(overlay.id)} has a zero texture size`);
        const clip: PixelRect = {
          x0: Math.max(0, overlay.offsetX),
          y0: Math.max(0, overlay.offsetY),
          x1: Math.min(width, overlay.offsetX + overlay.textureWidth),
          y1: Math.min(height, overlay.offsetY + overlay.textureHeight),
        };
        if (clip.x1 <= clip.x0 || clip.y1 <= clip.y0) {
          skippedOverlays.push({ uiMapId: uiMap.id, overlayId: overlay.id, reason: 'rectangle lies outside the canvas' });
          continue;
        }
        overlays.push({
          id: overlay.id,
          areaIds: overlay.areaIds.filter((a) => a !== 0),
          flags: overlay.flags,
          rect: { x: overlay.offsetX, y: overlay.offsetY, width: overlay.textureWidth, height: overlay.textureHeight },
          clip,
          tiles: placeGrid(
            own,
            Math.ceil(overlay.textureHeight / tileHeight),
            Math.ceil(overlay.textureWidth / tileWidth),
            tileWidth,
            tileHeight,
            { x: overlay.offsetX, y: overlay.offsetY },
            `${what} overlay ${String(overlay.id)}`,
          ),
        });
      }
      plans.push({ uiMapId: uiMap.id, name: uiMap.name, uiMapType: uiMap.type, uiMapArtId: art.id, styleId: art.styleId, layerIndex: layer.layerIndex, width, height, tileWidth, tileHeight, tiles, overlays });
    }
  }
  return { plans, skippedUiMaps, skippedOverlays };
}

/** Every BLP FileDataID a plan reads, ascending, without repeats. */
export function planFileDataIds(plan: ArtPlan): readonly number[] {
  const ids = new Set<number>();
  for (const t of plan.tiles) ids.add(t.fileDataId);
  for (const o of plan.overlays) for (const t of o.tiles) ids.add(t.fileDataId);
  return [...ids].sort((a, b) => a - b);
}
