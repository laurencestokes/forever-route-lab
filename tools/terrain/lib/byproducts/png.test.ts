import sharp from 'sharp';
import { crc32, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readImageHeader } from '../../../../src/infra/maps/image-header';
import { palettePng, PNG_SIGNATURE, type Rgb } from './png';

function chunks(png: Buffer): { type: string; data: Buffer; crcOk: boolean }[] {
  const out: { type: string; data: Buffer; crcOk: boolean }[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    out.push({ type, data, crcOk: png.readUInt32BE(at + 8 + length) === crc32(png.subarray(at + 4, at + 8 + length)) });
    at += 12 + length;
  }
  return out;
}

/** Undoes filters 0-2 (bpp 1) and unpacks the rows. */
function unfilter(raw: Buffer, width: number, height: number, bits: 4 | 8): number[] {
  const rowBytes = bits === 8 ? width : Math.ceil(width / 2);
  const out: number[] = [];
  let previous = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (rowBytes + 1)] ?? 0;
    const row = Buffer.alloc(rowBytes);
    for (let i = 0; i < rowBytes; i += 1) {
      const v = raw[y * (rowBytes + 1) + 1 + i] ?? 0;
      const predictor = filter === 1 ? (i > 0 ? (row[i - 1] ?? 0) : 0) : filter === 2 ? (previous[i] ?? 0) : 0;
      row[i] = (v + predictor) % 256;
    }
    for (let x = 0; x < width; x += 1) out.push(bits === 8 ? (row[x] ?? 0) : x % 2 === 0 ? Math.floor((row[Math.floor(x / 2)] ?? 0) / 16) : (row[Math.floor(x / 2)] ?? 0) % 16);
    previous = row;
  }
  return out;
}

const palette: readonly Rgb[] = [
  [0, 0, 0],
  [96, 128, 160],
  [40, 40, 40],
  [240, 240, 240],
];

describe('palette PNG writer', () => {
  const width = 7;
  const height = 5;
  const indices = Uint8Array.from({ length: width * height }, (_, i) => (i * 7 + Math.floor(i / 3)) % 4);

  it('writes IHDR, PLTE, tRNS, IDAT and IEND with valid CRCs, and the indices round-trip at 4 and 8 bits', () => {
    for (const bits of [4, 8] as const) {
      const png = palettePng(width, height, indices, bits, palette, 0);
      expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
      const parts = chunks(png);
      expect(parts.map((c) => c.type)).toEqual(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
      expect(parts.every((c) => c.crcOk)).toBe(true);
      const ihdr = parts[0]?.data ?? Buffer.alloc(13);
      expect([ihdr.readUInt32BE(0), ihdr.readUInt32BE(4), ihdr[8], ihdr[9]]).toEqual([width, height, bits, 3]);
      expect([...(parts[2]?.data ?? [])]).toEqual([0]);
      expect(unfilter(inflateSync(parts[3]?.data ?? Buffer.alloc(0)), width, height, bits)).toEqual([...indices]);
      expect(readImageHeader(png)).toEqual({ ok: true, header: { contentType: 'image/png', width, height } });
    }
  });

  it('decodes in a standard decoder with index 0 transparent', async () => {
    const png = palettePng(width, height, indices, 4, palette, 0);
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([width, height, 4]);
    for (let i = 0; i < width * height; i += 1) {
      const v = indices[i] ?? 0;
      const colour = palette[v] ?? [0, 0, 0];
      expect([...data.subarray(i * 4, i * 4 + 4)]).toEqual([...colour, v === 0 ? 0 : 255]);
    }
  });

  it('is deterministic and refuses indices outside the palette', () => {
    expect(palettePng(width, height, indices, 4, palette, 0).equals(palettePng(width, height, indices, 4, palette, 0))).toBe(true);
    expect(() => palettePng(2, 1, Uint8Array.from([0, 4]), 4, palette, 0)).toThrow(/outside the 4-entry palette/);
    expect(() => palettePng(2, 2, Uint8Array.from([0, 1]), 4, palette, 0)).toThrow(/2 indices for 2 × 2/);
  });
});
