import type { Rgba } from './raster';

/**
 * BLP2 texture decoding for the painted map art (docs/MAPS.md §5.4 (b); terrain-navigation.md
 * §13.4, §15; D-033). Written for this project from the format descriptions on wowdev.wiki ("BLP")
 * and the S3TC block formats (DXT1, DXT3, DXT5); no third-party code is ported. Only mip level 0
 * is decoded. Everything is arithmetic: no bitwise operators (D-012).
 *
 * Header (little-endian, 148 bytes, then a 256-entry palette of B, G, R, A bytes):
 *
 * | Offset | Field |
 * |---|---|
 * | 0 | magic `BLP2` |
 * | 4 | u32 type, 1 |
 * | 8 | u8 colour encoding: 1 palette, 2 DXT, 3 B8G8R8A8 |
 * | 9 | u8 alpha size in bits: 0, 1, 4 or 8 |
 * | 10 | u8 preferred format: 0 DXT1, 1 DXT3, 7 DXT5 (DXT only) |
 * | 11 | u8 has mips |
 * | 12, 16 | u32 width, height |
 * | 20 | u32 × 16 mip offsets |
 * | 84 | u32 × 16 mip sizes |
 * | 148 | palette, 256 × 4 bytes |
 *
 * DXT: alpha size 0 or 1 is DXT1 (1-bit alpha only when the alpha size is 1), otherwise preferred
 * format 7 is DXT5 and anything else DXT3. Palette images store width × height indices, then the
 * alpha bits (LSB first; 4-bit values low nibble first). At the pinned build every map-art and
 * overlay tile is DXT (1,659 files: DXT1 opaque, DXT1 with 1-bit alpha, DXT5), so the palette and
 * B8G8R8A8 paths are covered by synthetic tests only.
 */

export class BlpError extends Error {
  constructor(message: string) {
    super(`BLP: ${message}`);
    this.name = 'BlpError';
  }
}

export type BlpEncoding = 'palette' | 'dxt1' | 'dxt3' | 'dxt5' | 'bgra';

export interface BlpInfo {
  readonly encoding: BlpEncoding;
  /** 0, 1, 4 or 8. */
  readonly alphaBits: number;
  readonly preferredFormat: number;
  readonly width: number;
  readonly height: number;
  /** Byte offset and size of mip level 0. */
  readonly mip0: { readonly offset: number; readonly size: number };
}

export const BLP_HEADER_SIZE = 148;
export const BLP_PALETTE_OFFSET = 148;
export const BLP_DATA_START = BLP_PALETTE_OFFSET + 1024;
/** Largest side accepted (the map art uses 32-512). */
export const BLP_MAX_SIDE = 4096;

const u32 = (b: Uint8Array, at: number): number => (b[at] ?? 0) + (b[at + 1] ?? 0) * 256 + (b[at + 2] ?? 0) * 65536 + (b[at + 3] ?? 0) * 16777216;
const u16 = (b: Uint8Array, at: number): number => (b[at] ?? 0) + (b[at + 1] ?? 0) * 256;

/** Bytes of mip 0 an encoding needs. */
function mipBytes(encoding: BlpEncoding, alphaBits: number, width: number, height: number): number {
  const blocks = Math.ceil(width / 4) * Math.ceil(height / 4);
  switch (encoding) {
    case 'dxt1':
      return blocks * 8;
    case 'dxt3':
    case 'dxt5':
      return blocks * 16;
    case 'bgra':
      return width * height * 4;
    case 'palette':
      return width * height + Math.ceil((width * height * alphaBits) / 8);
  }
}

/** Reads and checks the header; throws BlpError on anything outside the format. */
export function blpInfo(bytes: Uint8Array): BlpInfo {
  if (bytes.length < BLP_DATA_START) throw new BlpError(`file of ${String(bytes.length)} bytes is shorter than the header and palette`);
  const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  if (magic !== 'BLP2') throw new BlpError(magic === 'BLP1' ? 'BLP1 files are not supported' : 'not a BLP2 file');
  if (u32(bytes, 4) !== 1) throw new BlpError(`type ${String(u32(bytes, 4))} is not 1`);
  const colourEncoding = bytes[8] ?? 0;
  const alphaBits = bytes[9] ?? 0;
  const preferredFormat = bytes[10] ?? 0;
  const width = u32(bytes, 12);
  const height = u32(bytes, 16);
  if (width < 1 || height < 1 || width > BLP_MAX_SIDE || height > BLP_MAX_SIDE) throw new BlpError(`size ${String(width)} × ${String(height)} is out of range`);
  if (![0, 1, 4, 8].includes(alphaBits)) throw new BlpError(`alpha size ${String(alphaBits)} is not 0, 1, 4 or 8`);
  let encoding: BlpEncoding;
  if (colourEncoding === 1) encoding = 'palette';
  else if (colourEncoding === 2) encoding = alphaBits <= 1 ? 'dxt1' : preferredFormat === 7 ? 'dxt5' : 'dxt3';
  else if (colourEncoding === 3) encoding = 'bgra';
  else throw new BlpError(`colour encoding ${String(colourEncoding)} is not supported (JPEG-in-BLP is refused)`);
  const offset = u32(bytes, 20);
  const size = u32(bytes, 84);
  const need = mipBytes(encoding, alphaBits, width, height);
  if (offset < BLP_DATA_START || offset + need > bytes.length) {
    throw new BlpError(`mip 0 (offset ${String(offset)}, ${String(need)} bytes needed) does not fit a file of ${String(bytes.length)} bytes`);
  }
  if (size < need) throw new BlpError(`mip 0 is ${String(size)} bytes, the ${encoding} image needs ${String(need)}`);
  return { encoding, alphaBits, preferredFormat, width, height, mip0: { offset, size } };
}

/** 5-6-5 colour to 8-bit channels by bit replication. */
function rgb565(c: number): readonly [number, number, number] {
  const r = Math.floor(c / 2048);
  const g = Math.floor(c / 32) % 64;
  const b = c % 32;
  return [r * 8 + Math.floor(r / 4), g * 4 + Math.floor(g / 16), b * 8 + Math.floor(b / 4)];
}

/** The four colours of a DXT colour block (RGBA). `threeColour` enables DXT1's c0 ≤ c1 mode. */
function colourTable(bytes: Uint8Array, at: number, threeColour: boolean, transparentIndex3: boolean): readonly number[][] {
  const c0 = u16(bytes, at);
  const c1 = u16(bytes, at + 2);
  const a = rgb565(c0);
  const b = rgb565(c1);
  if (!threeColour || c0 > c1) {
    return [
      [a[0], a[1], a[2], 255],
      [b[0], b[1], b[2], 255],
      [Math.round((2 * a[0] + b[0]) / 3), Math.round((2 * a[1] + b[1]) / 3), Math.round((2 * a[2] + b[2]) / 3), 255],
      [Math.round((a[0] + 2 * b[0]) / 3), Math.round((a[1] + 2 * b[1]) / 3), Math.round((a[2] + 2 * b[2]) / 3), 255],
    ];
  }
  return [
    [a[0], a[1], a[2], 255],
    [b[0], b[1], b[2], 255],
    [Math.floor((a[0] + b[0] + 1) / 2), Math.floor((a[1] + b[1] + 1) / 2), Math.floor((a[2] + b[2] + 1) / 2), 255],
    [0, 0, 0, transparentIndex3 ? 0 : 255],
  ];
}

/** DXT5 alpha palette of a block. */
function alphaTable(a0: number, a1: number): readonly number[] {
  if (a0 > a1) return [a0, a1, ...[1, 2, 3, 4, 5, 6].map((k) => Math.round(((7 - k) * a0 + k * a1) / 7))];
  return [a0, a1, ...[1, 2, 3, 4].map((k) => Math.round(((5 - k) * a0 + k * a1) / 5)), 0, 255];
}

function decodeDxt(bytes: Uint8Array, info: BlpInfo, out: Uint8Array): void {
  const { width, height, encoding } = info;
  const blockBytes = encoding === 'dxt1' ? 8 : 16;
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  let at = info.mip0.offset;
  const alpha = new Array<number>(16).fill(255);
  for (let by = 0; by < bh; by += 1) {
    for (let bx = 0; bx < bw; bx += 1) {
      let colourAt = at;
      if (encoding === 'dxt3') {
        for (let i = 0; i < 16; i += 1) {
          const byte = bytes[at + Math.floor(i / 2)] ?? 0;
          alpha[i] = (i % 2 === 0 ? byte % 16 : Math.floor(byte / 16)) * 17;
        }
        colourAt = at + 8;
      } else if (encoding === 'dxt5') {
        const table = alphaTable(bytes[at] ?? 0, bytes[at + 1] ?? 0);
        const low = (bytes[at + 2] ?? 0) + (bytes[at + 3] ?? 0) * 256 + (bytes[at + 4] ?? 0) * 65536;
        const high = (bytes[at + 5] ?? 0) + (bytes[at + 6] ?? 0) * 256 + (bytes[at + 7] ?? 0) * 65536;
        for (let i = 0; i < 16; i += 1) {
          const bits = i < 8 ? low : high;
          alpha[i] = table[Math.floor(bits / 8 ** (i % 8)) % 8] ?? 255;
        }
        colourAt = at + 8;
      }
      const colours = colourTable(bytes, colourAt, encoding === 'dxt1', encoding === 'dxt1' && info.alphaBits > 0);
      const indices = u32(bytes, colourAt + 4);
      for (let i = 0; i < 16; i += 1) {
        const x = bx * 4 + (i % 4);
        const y = by * 4 + Math.floor(i / 4);
        if (x >= width || y >= height) continue;
        const colour = colours[Math.floor(indices / 4 ** i) % 4] ?? [0, 0, 0, 255];
        const p = (y * width + x) * 4;
        out[p] = colour[0] ?? 0;
        out[p + 1] = colour[1] ?? 0;
        out[p + 2] = colour[2] ?? 0;
        out[p + 3] = encoding === 'dxt1' ? (colour[3] ?? 255) : (alpha[i] ?? 255);
      }
      at += blockBytes;
    }
  }
}

function decodePalette(bytes: Uint8Array, info: BlpInfo, out: Uint8Array): void {
  const n = info.width * info.height;
  const base = info.mip0.offset;
  const alphaAt = base + n;
  for (let i = 0; i < n; i += 1) {
    const entry = BLP_PALETTE_OFFSET + (bytes[base + i] ?? 0) * 4;
    out[i * 4] = bytes[entry + 2] ?? 0;
    out[i * 4 + 1] = bytes[entry + 1] ?? 0;
    out[i * 4 + 2] = bytes[entry] ?? 0;
    let a = 255;
    if (info.alphaBits === 1) a = Math.floor((bytes[alphaAt + Math.floor(i / 8)] ?? 0) / 2 ** (i % 8)) % 2 === 1 ? 255 : 0;
    else if (info.alphaBits === 4) {
      const byte = bytes[alphaAt + Math.floor(i / 2)] ?? 0;
      a = (i % 2 === 0 ? byte % 16 : Math.floor(byte / 16)) * 17;
    } else if (info.alphaBits === 8) a = bytes[alphaAt + i] ?? 0;
    out[i * 4 + 3] = a;
  }
}

function decodeBgra(bytes: Uint8Array, info: BlpInfo, out: Uint8Array): void {
  const n = info.width * info.height;
  const base = info.mip0.offset;
  for (let i = 0; i < n; i += 1) {
    const p = base + i * 4;
    out[i * 4] = bytes[p + 2] ?? 0;
    out[i * 4 + 1] = bytes[p + 1] ?? 0;
    out[i * 4 + 2] = bytes[p] ?? 0;
    out[i * 4 + 3] = info.alphaBits === 0 ? 255 : (bytes[p + 3] ?? 0);
  }
}

/** Decodes mip level 0 to straight (non-premultiplied) RGBA. */
export function decodeBlp(bytes: Uint8Array): { readonly info: BlpInfo; readonly image: Rgba } {
  const info = blpInfo(bytes);
  const data = new Uint8Array(info.width * info.height * 4);
  if (info.encoding === 'palette') decodePalette(bytes, info, data);
  else if (info.encoding === 'bgra') decodeBgra(bytes, info, data);
  else decodeDxt(bytes, info, data);
  return { info, image: { width: info.width, height: info.height, data } };
}
