import { bitList, flag, FormatError, vec3, type Vec3 } from './chunked';

/**
 * Liquids (wowdev.wiki ADT/v18 MH2O, WMO MLIQ; terrain-navigation.md §3.4, §10).
 *
 * MH2O, in the root ADT: 256 chunk headers (u32 instances offset, u32 layer count, u32 attributes
 * offset), offsets from the MH2O payload. Attributes: u64 fishable, u64 **deep** (8 × 8 quad
 * masks, one byte per row). Instance (24 bytes): u16 LiquidType, u16 LiquidObject-or-LVF, f32 min
 * and max height, u8 x, y, width, height (in quads), u32 existence-bitmap offset, u32
 * vertex-data offset.
 *
 * At 1.60.1.70009 every instance names a LiquidObject (id ≥ 42), whose vertex format needs the
 * LiquidObject → LiquidType → LiquidMaterial chain (deferred, U3). Heights are then the
 * instance's maximum. Raw LVF instances (< 42) with heights (LVF 0, 1, 3) keep their heights.
 */

export interface LiquidInstance {
  /** LiquidType ID. */
  readonly type: number;
  /** LiquidObject ID (≥ 42) or a raw liquid vertex format (< 42). */
  readonly objectOrFormat: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** width × height flags, row-major; null when every quad of the rectangle has liquid. */
  readonly exists: readonly boolean[] | null;
  /** (width + 1) × (height + 1) heights, or null (flat at `maxHeight`). */
  readonly heights: Float32Array | null;
}

export interface ChunkLiquid {
  readonly instances: readonly LiquidInstance[];
  /** 64 per-quad deep (fatigue) flags, row-major; null without attributes. */
  readonly deep: readonly boolean[] | null;
}

/** The first LiquidObject ID; smaller values are raw vertex formats. */
export const FIRST_LIQUID_OBJECT = 42;

/** Parses an MH2O payload into 256 per-chunk entries (index = chunk row · 16 + chunk column). */
export function parseMh2o(bytes: Buffer, start: number, size: number): ChunkLiquid[] {
  if (size < 256 * 12) throw new FormatError('MH2O: shorter than its 256 chunk headers');
  const end = start + size;
  const at = (offset: number, length: number, what: string): number => {
    const p = start + offset;
    if (offset <= 0 || p + length > end) throw new FormatError(`MH2O: ${what} at offset ${String(offset)} runs past the chunk`);
    return p;
  };
  const out: ChunkLiquid[] = [];
  for (let i = 0; i < 256; i += 1) {
    const instancesOffset = bytes.readUInt32LE(start + i * 12);
    const layers = bytes.readUInt32LE(start + i * 12 + 4);
    const attributesOffset = bytes.readUInt32LE(start + i * 12 + 8);
    const deep = attributesOffset > 0 ? bitList(bytes, at(attributesOffset, 16, 'attributes') + 8, 64) : null;
    const instances: LiquidInstance[] = [];
    for (let l = 0; l < layers; l += 1) {
      const p = at(instancesOffset + l * 24, 24, 'instance');
      const type = bytes.readUInt16LE(p);
      const objectOrFormat = bytes.readUInt16LE(p + 2);
      const x = bytes.readUInt8(p + 12);
      const y = bytes.readUInt8(p + 13);
      const width = bytes.readUInt8(p + 14);
      const height = bytes.readUInt8(p + 15);
      if (x + width > 8 || y + height > 8) throw new FormatError(`MH2O: chunk ${String(i)} instance rectangle leaves the chunk`);
      const bitmapOffset = bytes.readUInt32LE(p + 16);
      const vertexOffset = bytes.readUInt32LE(p + 20);
      const exists = bitmapOffset > 0 ? bitList(bytes, at(bitmapOffset, Math.ceil((width * height) / 8), 'existence bitmap'), width * height) : null;
      let heights: Float32Array | null = null;
      const format = objectOrFormat < FIRST_LIQUID_OBJECT ? objectOrFormat : -1;
      if (vertexOffset > 0 && (format === 0 || format === 1 || format === 3)) {
        const n = (width + 1) * (height + 1);
        const v = at(vertexOffset, n * 4, 'heights');
        heights = new Float32Array(n);
        for (let k = 0; k < n; k += 1) heights[k] = bytes.readFloatLE(v + k * 4);
      }
      instances.push({ type, objectOrFormat, minHeight: bytes.readFloatLE(p + 4), maxHeight: bytes.readFloatLE(p + 8), x, y, width, height, exists, heights });
    }
    out.push({ instances, deep });
  }
  return out;
}

export interface QuadLiquid {
  /** Surface height at the quad (mean of its four corners, or the instance maximum). */
  readonly height: number;
  readonly type: number;
  readonly deep: boolean;
}

/** The liquid over quad (row, col) of a chunk: the first instance, in layer order, that covers it. */
export function liquidAt(liquid: ChunkLiquid | null, row: number, col: number): QuadLiquid | null {
  if (liquid === null) return null;
  for (const l of liquid.instances) {
    if (row < l.y || row >= l.y + l.height || col < l.x || col >= l.x + l.width) continue;
    const lr = row - l.y;
    const lc = col - l.x;
    if (l.exists !== null && l.exists[lr * l.width + lc] !== true) continue;
    let height = l.maxHeight;
    if (l.heights !== null) {
      const w = l.width + 1;
      height = ((l.heights[lr * w + lc] ?? 0) + (l.heights[lr * w + lc + 1] ?? 0) + (l.heights[(lr + 1) * w + lc] ?? 0) + (l.heights[(lr + 1) * w + lc + 1] ?? 0)) / 4;
    }
    return { height, type: l.type, deep: liquid.deep?.[row * 8 + col] === true };
  }
  return null;
}

/** LiquidType IDs that are hazards (never traversable): `LiquidType.SoundBank` 2 (magma) or 3 (slime). */
export function hazardLiquidTypes(rows: Iterable<{ readonly id: number; readonly soundBank: number }>): Set<number> {
  const out = new Set<number>();
  for (const r of rows) if (r.soundBank === 2 || r.soundBank === 3) out.add(r.id);
  return out;
}

// ---------------------------------------------------------------------------------------------
// WMO liquids

/** An MLIQ surface: a grid of (xVerts × yVerts) heights over (xTiles × yTiles) tiles of one unit. */
export interface WmoLiquid {
  readonly xVerts: number;
  readonly yVerts: number;
  readonly xTiles: number;
  readonly yTiles: number;
  /** Model-space corner (x, y, z). */
  readonly corner: Vec3;
  readonly material: number;
  readonly heights: Float32Array;
  /** One byte per tile: low four bits the legacy liquid (15 = none), high bits flags. */
  readonly tiles: Uint8Array;
}

/** MLIQ: u32 xVerts, yVerts, xTiles, yTiles; corner; u16 material; 8-byte vertices (height at +4); tile bytes. */
export function parseMliq(bytes: Buffer, start: number, size: number): WmoLiquid {
  if (size < 30) throw new FormatError('MLIQ: header truncated');
  const xVerts = bytes.readUInt32LE(start);
  const yVerts = bytes.readUInt32LE(start + 4);
  const xTiles = bytes.readUInt32LE(start + 8);
  const yTiles = bytes.readUInt32LE(start + 12);
  const n = xVerts * yVerts;
  if (30 + n * 8 + xTiles * yTiles > size) throw new FormatError('MLIQ: vertices or tiles run past the chunk');
  const heights = new Float32Array(n);
  for (let i = 0; i < n; i += 1) heights[i] = bytes.readFloatLE(start + 30 + i * 8 + 4);
  const tiles = Uint8Array.from(bytes.subarray(start + 30 + n * 8, start + 30 + n * 8 + xTiles * yTiles));
  return { xVerts, yVerts, xTiles, yTiles, corner: vec3(bytes, start + 16), material: bytes.readUInt16LE(start + 28), heights, tiles };
}

/** A tile of an MLIQ grid holds liquid unless its low four bits are 15. */
export function mliqTileHasLiquid(tile: number): boolean {
  return tile % 16 !== 15;
}

/** MOHD flag: group liquid values are LiquidType IDs. */
export const MOHD_USE_LIQUID_TYPE_ID = 0x4;
/** MOGP flag: a legacy water liquid is ocean. */
export const MOGP_IS_OCEAN = 0x80000;

/** Legacy WMO liquid numbering (1-20) to LiquidType IDs: water 13 (ocean 14 with MOGP 0x80000), ocean 14, magma 19, slime 20. */
function legacyLiquid(value: number, mogpFlags: number): number {
  if (value <= 0 || value >= 21) return value;
  switch ((value - 1) % 4) {
    case 0:
      return flag(mogpFlags, MOGP_IS_OCEAN) ? 14 : 13;
    case 1:
      return 14;
    case 2:
      return 19;
    default:
      return 20;
  }
}

/**
 * The LiquidType ID of a WMO group's liquid (wowdev.wiki WMO "MOGP groupLiquid"):
 *
 * - root flag 0x4: the group value is a LiquidType ID (legacy 1-20 values still convert);
 * - otherwise 15 means none, and any other value v converts as legacy v + 1;
 * - when that gives 0 and the group has an MLIQ, the first tile with liquid gives legacy
 *   (tile mod 16) + 1.
 *
 * Returns 0 for no liquid.
 */
export function wmoLiquidType(groupLiquid: number, rootFlags: number, mogpFlags: number, liquid: WmoLiquid | null): number {
  let type: number;
  if (flag(rootFlags, MOHD_USE_LIQUID_TYPE_ID)) type = legacyLiquid(groupLiquid, mogpFlags);
  else if (groupLiquid === 15) type = 0;
  else type = legacyLiquid(groupLiquid + 1, mogpFlags);
  if (type === 0 && liquid !== null) {
    for (const tile of liquid.tiles) {
      if (mliqTileHasLiquid(tile)) return legacyLiquid((tile % 16) + 1, mogpFlags);
    }
  }
  return type;
}
