import { chunks, FormatError } from './chunked';

/**
 * WDT (wowdev.wiki "WDT"): `MPHD` flags; `MAIN` 64 × 64 × (u32 flags, u32 async id); `MAID`
 * 64 × 64 × 8 FileDataIDs (root ADT, obj0, obj1, tex0, lod, map texture, map texture normal,
 * minimap), both row-major `[YY][XX]`; `MODF` for a map whose only terrain is one global WMO.
 *
 * Navigation reads only `root` and `obj0`; `obj1` and `tex0` are never read (§3.4).
 */

export interface WdtTile {
  readonly row: number;
  readonly col: number;
  readonly flags: number;
  readonly rootAdt: number;
  readonly obj0: number;
  readonly obj1: number;
  readonly tex0: number;
  readonly lod: number;
  readonly mapTexture: number;
  readonly minimap: number;
}

export interface Wdt {
  readonly mphdFlags: number;
  /** Tiles with a root ADT or a MAIN flag, row-major. */
  readonly tiles: readonly WdtTile[];
  readonly hasMaid: boolean;
  /** FileDataID of the global WMO (MODF), when the map has one. */
  readonly globalWmo: number | null;
}

export function parseWdt(bytes: Buffer): Wdt {
  let mphdFlags = 0;
  let main: { start: number; size: number } | null = null;
  let maid: { start: number; size: number } | null = null;
  let globalWmo: number | null = null;
  for (const c of chunks(bytes, 0, bytes.length, 'WDT')) {
    if (c.id === 'MPHD') mphdFlags = bytes.readUInt32LE(c.start);
    else if (c.id === 'MAIN') main = c;
    else if (c.id === 'MAID') maid = c;
    else if (c.id === 'MODF' && c.size >= 4) globalWmo = bytes.readUInt32LE(c.start);
  }
  if (main === null || main.size !== 4096 * 8) throw new FormatError('WDT: MAIN is missing or not 64 × 64 entries');
  if (maid !== null && maid.size !== 4096 * 32) throw new FormatError('WDT: MAID is not 64 × 64 × 8 FileDataIDs');
  const tiles: WdtTile[] = [];
  for (let i = 0; i < 4096; i += 1) {
    const flags = bytes.readUInt32LE(main.start + i * 8);
    const row = Math.floor(i / 64);
    const col = i % 64;
    if (maid === null) {
      if (flags !== 0) tiles.push({ row, col, flags, rootAdt: 0, obj0: 0, obj1: 0, tex0: 0, lod: 0, mapTexture: 0, minimap: 0 });
      continue;
    }
    const at = maid.start + i * 32;
    const rootAdt = bytes.readUInt32LE(at);
    if (rootAdt === 0 && flags === 0) continue;
    tiles.push({
      row,
      col,
      flags,
      rootAdt,
      obj0: bytes.readUInt32LE(at + 4),
      obj1: bytes.readUInt32LE(at + 8),
      tex0: bytes.readUInt32LE(at + 12),
      lod: bytes.readUInt32LE(at + 16),
      mapTexture: bytes.readUInt32LE(at + 20),
      minimap: bytes.readUInt32LE(at + 28),
    });
  }
  return { mphdFlags, tiles, hasMaid: maid !== null, globalWmo };
}

/** Tile lookup by (row, col). */
export function wdtTile(wdt: Wdt, row: number, col: number): WdtTile | undefined {
  return wdt.tiles.find((t) => t.row === row && t.col === col);
}
