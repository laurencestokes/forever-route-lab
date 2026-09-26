/**
 * Test support for the map-art pipeline (not used by the tools): synthetic BLP2 files and
 * synthetic client tables, so every step runs without the client. No client bytes.
 */
import type { ArtTables } from './art-plan';
import type { AssignmentRow, ClientMapTables } from './client-tables';

export interface SynthBlp {
  /** 1 palette, 2 DXT, 3 B8G8R8A8. */
  readonly colourEncoding: number;
  readonly alphaBits: number;
  readonly preferredFormat?: number;
  readonly width: number;
  readonly height: number;
  /** Mip 0 bytes. */
  readonly mip0: Uint8Array;
  /** Up to 256 [r, g, b] entries (palette encoding). */
  readonly palette?: readonly (readonly [number, number, number])[];
  /** Overrides the magic (error tests). */
  readonly magic?: string;
  /** Overrides the recorded mip-0 size (error tests). */
  readonly mip0Size?: number;
}

const u32 = (out: Uint8Array, at: number, value: number): void => {
  out[at] = value % 256;
  out[at + 1] = Math.floor(value / 256) % 256;
  out[at + 2] = Math.floor(value / 65536) % 256;
  out[at + 3] = Math.floor(value / 16777216) % 256;
};

export function blpFile(b: SynthBlp): Uint8Array {
  const header = 148 + 1024;
  const out = new Uint8Array(header + b.mip0.length);
  const magic = b.magic ?? 'BLP2';
  for (let i = 0; i < 4; i += 1) out[i] = magic.charCodeAt(i);
  u32(out, 4, 1);
  out[8] = b.colourEncoding;
  out[9] = b.alphaBits;
  out[10] = b.preferredFormat ?? 0;
  out[11] = 0;
  u32(out, 12, b.width);
  u32(out, 16, b.height);
  u32(out, 20, header);
  u32(out, 84, b.mip0Size ?? b.mip0.length);
  (b.palette ?? []).forEach(([r, g, bl], i) => {
    out[148 + i * 4] = bl;
    out[148 + i * 4 + 1] = g;
    out[148 + i * 4 + 2] = r;
    out[148 + i * 4 + 3] = 255;
  });
  out.set(b.mip0, header);
  return out;
}

/** An 8-bit-per-channel image as a B8G8R8A8 BLP (colour encoding 3, alpha 8). */
export function bgraBlp(width: number, height: number, rgba: (x: number, y: number) => readonly [number, number, number, number]): Uint8Array {
  const mip0 = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = rgba(x, y);
      const p = (y * width + x) * 4;
      mip0[p] = b;
      mip0[p + 1] = g;
      mip0[p + 2] = r;
      mip0[p + 3] = a;
    }
  }
  return blpFile({ colourEncoding: 3, alphaBits: 8, width, height, mip0 });
}

/** A DXT1 colour block: two 5-6-5 endpoints and 16 two-bit indices (pixel i = row-major within the 4 × 4 block). */
export function dxtColourBlock(c0: number, c1: number, indices: readonly number[]): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = c0 % 256;
  out[1] = Math.floor(c0 / 256);
  out[2] = c1 % 256;
  out[3] = Math.floor(c1 / 256);
  let bits = 0;
  for (let i = 0; i < 16; i += 1) bits += (indices[i] ?? 0) * 4 ** i;
  u32(out, 4, bits);
  return out;
}

/** A DXT5 alpha block: two endpoints and 16 three-bit indices. */
export function dxt5AlphaBlock(a0: number, a1: number, indices: readonly number[]): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = a0;
  out[1] = a1;
  let low = 0;
  let high = 0;
  for (let i = 0; i < 8; i += 1) low += (indices[i] ?? 0) * 8 ** i;
  for (let i = 0; i < 8; i += 1) high += (indices[i + 8] ?? 0) * 8 ** i;
  for (let k = 0; k < 3; k += 1) {
    out[2 + k] = Math.floor(low / 256 ** k) % 256;
    out[5 + k] = Math.floor(high / 256 ** k) % 256;
  }
  return out;
}

/** 5-6-5 packing of 8-bit channels (truncating). */
export const rgb565 = (r: number, g: number, b: number): number => Math.floor(r / 8) * 2048 + Math.floor(g / 4) * 32 + Math.floor(b / 8);

export const tileColour = (seed: number): readonly [number, number, number, number] => [(seed * 37) % 256, (seed * 91) % 256, (seed * 53) % 256, 255];

/**
 * A two-UiMap world: UiMap 1411 (style 1: one 10 × 6 layer of 4 × 4 tiles, so 3 × 2 tiles with
 * cropped edges) with two overlays (one of them without tiles), and UiMap 947 (style 2: one 4 × 4
 * layer, a single tile) with two assignment rows. Tile FileDataIDs are 1000 + n; each tile is a
 * flat colour (`tileColour`), overlays are half-transparent.
 */
export function syntheticArtWorld(): { readonly tables: ClientMapTables; readonly files: ReadonlyMap<number, Uint8Array> } {
  const files = new Map<number, Uint8Array>();
  const flat = (id: number, w: number, h: number, alpha = 255): number => {
    const [r, g, b] = tileColour(id);
    files.set(id, bgraBlp(w, h, () => [r, g, b, alpha]));
    return id;
  };
  const artTiles: ArtTables['artTiles'][number][] = [];
  let tileId = 1;
  for (let row = 0; row < 2; row += 1) for (let col = 0; col < 3; col += 1) artTiles.push({ id: tileId++, uiMapArtId: 20, row, col, layerIndex: 0, fileDataId: flat(1000 + row * 3 + col, 4, 4) });
  artTiles.push({ id: tileId, uiMapArtId: 21, row: 0, col: 0, layerIndex: 0, fileDataId: flat(1100, 4, 4) });
  const art: ArtTables = {
    uiMaps: [
      { id: 1411, name: 'Durotar', type: 3, parent: 1414 },
      { id: 947, name: 'Azeroth', type: 1, parent: 0 },
    ],
    xMapArt: [
      { id: 1, uiMapId: 1411, uiMapArtId: 20, phaseId: 0 },
      { id: 2, uiMapId: 947, uiMapArtId: 21, phaseId: 0 },
    ],
    art: [
      { id: 20, styleId: 1 },
      { id: 21, styleId: 2 },
    ],
    styleLayers: [
      { id: 1, styleId: 1, layerIndex: 0, layerWidth: 10, layerHeight: 6, tileWidth: 4, tileHeight: 4 },
      { id: 2, styleId: 2, layerIndex: 0, layerWidth: 4, layerHeight: 4, tileWidth: 4, tileHeight: 4 },
    ],
    artTiles,
    overlays: [
      { id: 7, uiMapArtId: 20, textureWidth: 5, textureHeight: 3, offsetX: 2, offsetY: 1, playerConditionId: 0, flags: 4, areaIds: [370, 0, 0, 0] },
      { id: 8, uiMapArtId: 20, textureWidth: 2, textureHeight: 2, offsetX: 0, offsetY: 0, playerConditionId: 0, flags: 4, areaIds: [371, 0, 0, 0] },
    ],
    overlayTiles: [
      { id: 1, overlayId: 7, row: 0, col: 0, layerIndex: 0, fileDataId: flat(2000, 4, 4, 128) },
      { id: 2, overlayId: 7, row: 0, col: 1, layerIndex: 0, fileDataId: flat(2001, 16, 4, 128) },
    ],
  };
  const assignment = (id: number, uiMapId: number, orderIndex: number, mapId: number, region: readonly number[], uiMin: readonly number[], uiMax: readonly number[]): AssignmentRow => ({
    id,
    uiMapId,
    orderIndex,
    mapId,
    areaId: uiMapId === 1411 ? 14 : 0,
    region,
    uiMin,
    uiMax,
    wmoDoodadPlacementId: 0,
    wmoGroupId: 0,
  });
  const tables: ClientMapTables = {
    art,
    assignments: [
      assignment(46721, 1411, 0, 1, [-1716.6666259765625, -7249.99951171875, -1000000, 1808.333251953125, -1962.4998779296875, 1000000], [0, 0], [1, 1]),
      assignment(46774, 947, 0, 1, [-19733.2109375, -11733.2998046875, -1000000, 17066.599609375, 12799.900390625, 1000000], [0, 0], [0.5, 1]),
      assignment(46775, 947, 1, 0, [-10000, -5000, -1000000, 10000, 5000, 1000000], [0.5, 0], [1, 1]),
    ],
    inputs: [
      { table: 'UiMap', fileDataId: 1957206, ckey: 'a'.repeat(32), rows: 2 },
      { table: 'UiMapAssignment', fileDataId: 1957219, ckey: 'b'.repeat(32), rows: 3 },
    ],
    layoutBuild: '1.60.1.70009',
  };
  return { tables, files };
}

/** A fake CKey for a synthetic file: 32 hex digits from its FileDataID. */
export const fakeCkey = (fileDataId: number): string => fileDataId.toString(16).padStart(32, '0');
