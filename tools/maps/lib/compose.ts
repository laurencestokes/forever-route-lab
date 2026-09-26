import type { ArtPlan } from './art-plan';
import { decodeBlp, type BlpEncoding } from './blp';
import { createRaster, drawOver, type Rgba } from './raster';

/**
 * Assembles one plan (art-plan.ts) into its image: base tiles first, then the explored-area
 * overlays in ID order, source-over (docs/MAPS.md §5.4 (b)). Base tiles must be exactly the
 * layer's tile size. Overlay tiles are drawn at their own pixel size and cut to the overlay's
 * rectangle, so the power-of-two padding of edge tiles never shows.
 *
 * The client's Lua sizes an edge overlay tile as the next power of two from 16; at the pin 19 of
 * the 972 overlay tiles are 32 px on a side where that rule gives 16 (the remainder is at most
 * 16 px). They are drawn at their pixel size too; `compose` counts them in `oversizedEdgeTiles`.
 */

export interface ComposeStats {
  readonly tiles: number;
  readonly overlays: number;
  readonly overlayTiles: number;
  /** Overlay edge tiles larger than the client's power-of-two rule predicts (see above). */
  readonly oversizedEdgeTiles: number;
  /** Decoded tiles by BLP encoding. */
  readonly encodings: Readonly<Partial<Record<BlpEncoding, number>>>;
}

export interface Composed {
  readonly image: Rgba;
  readonly stats: ComposeStats;
}

/** The client's edge-tile file size: 16, doubled until it holds `pixels`. */
export function edgeTileFileSize(pixels: number): number {
  let size = 16;
  while (size < pixels) size *= 2;
  return size;
}

/** `read(fileDataId)` returns the BLP bytes and must throw when the file is missing. */
export function composeArt(plan: ArtPlan, read: (fileDataId: number) => Uint8Array): Composed {
  const image = createRaster(plan.width, plan.height);
  const encodings: Partial<Record<BlpEncoding, number>> = {};
  const decode = (fileDataId: number): Rgba => {
    const { info, image: tile } = decodeBlp(read(fileDataId));
    encodings[info.encoding] = (encodings[info.encoding] ?? 0) + 1;
    return tile;
  };
  for (const t of plan.tiles) {
    const tile = decode(t.fileDataId);
    if (tile.width !== plan.tileWidth || tile.height !== plan.tileHeight) {
      throw new Error(
        `UiMap ${String(plan.uiMapId)}: tile ${String(t.fileDataId)} is ${String(tile.width)} × ${String(tile.height)}, the layer's tiles are ${String(plan.tileWidth)} × ${String(plan.tileHeight)}`,
      );
    }
    drawOver(image, tile, t.x, t.y);
  }
  let overlayTiles = 0;
  let oversizedEdgeTiles = 0;
  for (const overlay of plan.overlays) {
    const cols = Math.max(...overlay.tiles.map((t) => t.col)) + 1;
    const rows = Math.max(...overlay.tiles.map((t) => t.row)) + 1;
    for (const t of overlay.tiles) {
      const tile = decode(t.fileDataId);
      const wantW = t.col < cols - 1 ? plan.tileWidth : overlay.rect.width - t.col * plan.tileWidth;
      const wantH = t.row < rows - 1 ? plan.tileHeight : overlay.rect.height - t.row * plan.tileHeight;
      if (tile.width < Math.min(wantW, plan.tileWidth) || tile.height < Math.min(wantH, plan.tileHeight)) {
        throw new Error(`UiMap ${String(plan.uiMapId)} overlay ${String(overlay.id)}: tile ${String(t.fileDataId)} (${String(tile.width)} × ${String(tile.height)}) does not cover its part of the overlay`);
      }
      const expectW = t.col < cols - 1 ? plan.tileWidth : edgeTileFileSize(wantW);
      const expectH = t.row < rows - 1 ? plan.tileHeight : edgeTileFileSize(wantH);
      if (tile.width > expectW || tile.height > expectH) oversizedEdgeTiles += 1;
      drawOver(image, tile, t.x, t.y, overlay.clip);
      overlayTiles += 1;
    }
  }
  return { image, stats: { tiles: plan.tiles.length, overlays: plan.overlays.length, overlayTiles, oversizedEdgeTiles, encodings } };
}
