import { crc32, deflateSync } from 'node:zlib';

/**
 * A palette PNG writer for the shaded relief (terrain-navigation.md §13.1), ported from the m3b
 * prototype (our own research code): colour type 3 at 4 or 8 bits per pixel, a `tRNS` entry that
 * makes one palette index transparent, and per row the filter (none, sub or up) with the smallest
 * sum of absolute byte values. The IDAT stream is `node:zlib` deflate at level 9, so the bytes are
 * reproducible with the same Node (zlib) build; the manifest also records the SHA-256 of the
 * indices, which does not depend on the compressor. No bitwise operators (D-012).
 */

export type Rgb = readonly [number, number, number];

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** One row packed at `bits` per pixel, high nibble first at 4 bits. */
function packRow(indices: Uint8Array, y: number, width: number, bits: 4 | 8, out: Buffer): void {
  out.fill(0);
  for (let x = 0; x < width; x += 1) {
    const v = indices[y * width + x] ?? 0;
    if (bits === 8) out[x] = v;
    else out[Math.floor(x / 2)] = (out[Math.floor(x / 2)] ?? 0) + (x % 2 === 0 ? v * 16 : v);
  }
}

/**
 * Encodes `indices` (width × height palette indices, row-major) as a palette PNG. Every index must
 * be below the palette length and below 2^bits.
 */
export function palettePng(width: number, height: number, indices: Uint8Array, bits: 4 | 8, palette: readonly Rgb[], transparentIndex: number): Buffer {
  if (indices.length !== width * height) throw new Error(`palettePng: ${String(indices.length)} indices for ${String(width)} × ${String(height)}`);
  const limit = Math.min(palette.length, 2 ** bits);
  for (const v of indices) if (v >= limit) throw new Error(`palettePng: index ${String(v)} is outside the ${String(limit)}-entry palette`);
  if (transparentIndex < 0 || transparentIndex >= palette.length) throw new Error('palettePng: the transparent index is outside the palette');
  const rowBytes = bits === 8 ? width : Math.ceil(width / 2);
  const raw = Buffer.alloc((rowBytes + 1) * height);
  const previous = Buffer.alloc(rowBytes);
  const current = Buffer.alloc(rowBytes);
  const candidates = [Buffer.alloc(rowBytes), Buffer.alloc(rowBytes), Buffer.alloc(rowBytes)];
  for (let y = 0; y < height; y += 1) {
    packRow(indices, y, width, bits, current);
    let best = 0;
    let bestSum = Infinity;
    candidates.forEach((candidate, filter) => {
      let sum = 0;
      for (let i = 0; i < rowBytes; i += 1) {
        const a = i > 0 ? (current[i - 1] ?? 0) : 0;
        const b = previous[i] ?? 0;
        const predictor = filter === 1 ? a : filter === 2 ? b : 0;
        const v = ((current[i] ?? 0) - predictor + 256) % 256;
        candidate[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = filter;
      }
    });
    raw[y * (rowBytes + 1)] = best;
    (candidates[best] ?? current).copy(raw, y * (rowBytes + 1) + 1);
    current.copy(previous);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = bits;
  header[9] = 3;
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((colour, i) => {
    plte[i * 3] = colour[0];
    plte[i * 3 + 1] = colour[1];
    plte[i * 3 + 2] = colour[2];
  });
  const trns = Buffer.alloc(transparentIndex + 1, 255);
  trns[transparentIndex] = 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('PLTE', plte),
    chunk('tRNS', trns),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
