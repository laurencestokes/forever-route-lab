import { bitList, chunks, flag, FormatError, vec3, type Vec3 } from './chunked';
import { parseMh2o, type ChunkLiquid } from './liquid';

/**
 * Root ADT terrain (wowdev.wiki ADT/v18; terrain-navigation.md §3.4). Offsets are from the MCNK
 * payload:
 *
 * | Offset | Field |
 * |---|---|
 * | 0x00 | flags (0x10000: high-resolution holes) |
 * | 0x04, 0x08 | index x (column), index y (row) |
 * | 0x14 | high-resolution holes, u64: 8 × 8 quads, one byte per row, bit = column |
 * | 0x34 | AreaTable ID |
 * | 0x3C | low-resolution holes, u16: 4 × 4 cells of 2 × 2 quads, bit = row · 4 + column |
 * | 0x68 | position: world X of the north edge, world Y of the west edge, base Z |
 * | 0x80 | sub-chunks (MCVT: 145 heights, rows of 9 outer and 8 inner vertices) |
 *
 * Each quad is a four-triangle fan around its inner vertex (geometry.ts). Liquids come from the
 * file's MH2O chunk (liquid.ts).
 */

export interface Mcnk {
  /** Column in the tile, west to east. */
  readonly ix: number;
  /** Row in the tile, north to south. */
  readonly iy: number;
  readonly flags: number;
  readonly areaId: number;
  /** World X of the north edge, world Y of the west edge, base Z. */
  readonly position: Vec3;
  /** 145 heights relative to `position[2]`, or null without MCVT. */
  readonly heights: Float32Array | null;
  /** 64 flags, row-major: true where the quad is a hole. */
  readonly holes: readonly boolean[];
  readonly liquid: ChunkLiquid | null;
}

export interface AdtRoot {
  /** 256 chunks in file order (row-major). */
  readonly chunks: readonly Mcnk[];
  readonly hasMh2o: boolean;
}

export const MCNK_HIGH_RES_HOLES = 0x10000;

/** MCVT index of outer vertex (row 0-8, col 0-8). */
export function outerIndex(row: number, col: number): number {
  return row * 17 + col;
}

/** MCVT index of inner vertex (row 0-7, col 0-7), at the centre of quad (row, col). */
export function innerIndex(row: number, col: number): number {
  return row * 17 + 9 + col;
}

function lowResHoles(mask: number): boolean[] {
  const holes = new Array<boolean>(64).fill(false);
  for (let k = 0; k < 16; k += 1) {
    if (!flag(mask, 2 ** k)) continue;
    const row = Math.floor(k / 4) * 2;
    const col = (k % 4) * 2;
    for (const r of [row, row + 1]) for (const c of [col, col + 1]) holes[r * 8 + c] = true;
  }
  return holes;
}

export function parseAdtRoot(bytes: Buffer): AdtRoot {
  const raw: Omit<Mcnk, 'liquid'>[] = [];
  let mh2o: { start: number; size: number } | null = null;
  for (const c of chunks(bytes, 0, bytes.length, 'ADT')) {
    if (c.id === 'MH2O') mh2o = c;
    if (c.id !== 'MCNK') continue;
    if (c.size < 0x80) throw new FormatError('ADT: MCNK header truncated');
    const o = c.start;
    const flags = bytes.readUInt32LE(o);
    const holes = flag(flags, MCNK_HIGH_RES_HOLES) ? bitList(bytes, o + 0x14, 64) : lowResHoles(bytes.readUInt16LE(o + 0x3c));
    let heights: Float32Array | null = null;
    for (const sc of chunks(bytes, o + 0x80, o + c.size, 'MCNK')) {
      if (sc.id !== 'MCVT') continue;
      if (sc.size < 145 * 4) throw new FormatError('ADT: MCVT holds fewer than 145 heights');
      heights = new Float32Array(145);
      for (let i = 0; i < 145; i += 1) heights[i] = bytes.readFloatLE(sc.start + i * 4);
    }
    raw.push({ ix: bytes.readUInt32LE(o + 4), iy: bytes.readUInt32LE(o + 8), flags, areaId: bytes.readUInt32LE(o + 0x34), position: vec3(bytes, o + 0x68), heights, holes });
  }
  if (raw.length !== 256) throw new FormatError(`ADT: ${String(raw.length)} MCNK chunks, expected 256`);
  const seen = new Set<number>();
  for (const m of raw) {
    if (m.ix > 15 || m.iy > 15 || seen.has(m.iy * 16 + m.ix)) throw new FormatError(`ADT: MCNK index (${String(m.ix)}, ${String(m.iy)}) is out of range or repeated`);
    seen.add(m.iy * 16 + m.ix);
  }
  const liquids = mh2o === null ? null : parseMh2o(bytes, mh2o.start, mh2o.size);
  return { chunks: raw.map((m) => ({ ...m, liquid: liquids?.[m.iy * 16 + m.ix] ?? null })), hasMh2o: mh2o !== null };
}
