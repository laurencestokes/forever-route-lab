import { BASE_LEVEL, MIN_LEVEL, TILE } from './atlas-params';
import type { Rgb } from './atlas-raster';

/**
 * The tile pyramid (docs/research/map-atlas.md §6.3, §6.4, §7.1, §7.2): exact 2×2 reductions of the
 * level −2 composite, the sparse rule (a key is sea, stored or virtual), the fine-level tile sets
 * and the nearest stored ancestor a recomposed or virtual tile is drawn from, and the runtime
 * index's bitmaps. Pure, deterministic, no bitwise operators (D-012).
 */

/** An RGB raster (3 bytes per pixel), row-major. */
export interface Rgb8 {
  readonly w: number;
  readonly h: number;
  readonly d: Uint8Array;
}

/** One 2×2 box reduction, rounded half up: `(a + b + c + d + 2) / 4`, floored. */
export function reduce(src: Rgb8): Rgb8 {
  const w = Math.floor(src.w / 2);
  const h = Math.floor(src.h / 2);
  const d = new Uint8Array(w * h * 3);
  const row = src.w * 3;
  const s = src.d;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let c = 0; c < 3; c += 1) {
        const i = (2 * y * src.w + 2 * x) * 3 + c;
        d[(y * w + x) * 3 + c] = Math.floor(((s[i] ?? 0) + (s[i + 3] ?? 0) + (s[i + row] ?? 0) + (s[i + row + 3] ?? 0) + 2) / 4);
      }
    }
  }
  return { w, h, d };
}

/** Levels −3 … −8 as successive reductions of level −2 (§6.3), keyed by level. */
export function reductions(base: Rgb8, minLevel = MIN_LEVEL): Map<number, Rgb8> {
  const levels = new Map<number, Rgb8>([[BASE_LEVEL, base]]);
  let cur = base;
  for (let z = BASE_LEVEL - 1; z >= minLevel; z -= 1) {
    cur = reduce(cur);
    levels.set(z, cur);
  }
  return levels;
}

/** Tile (tx, ty) of a level raster, padded with the deep sea beyond its edge. */
export function extractTile(level: Rgb8, tx: number, ty: number, sea: Rgb): Uint8Array {
  const d = new Uint8Array(TILE * TILE * 3);
  for (let j = 0; j < TILE; j += 1) {
    for (let i = 0; i < TILE; i += 1) {
      const x = tx * TILE + i;
      const y = ty * TILE + j;
      const o = (j * TILE + i) * 3;
      if (x >= level.w || y >= level.h) {
        d[o] = sea[0];
        d[o + 1] = sea[1];
        d[o + 2] = sea[2];
        continue;
      }
      const q = (y * level.w + x) * 3;
      d[o] = level.d[q] ?? 0;
      d[o + 1] = level.d[q + 1] ?? 0;
      d[o + 2] = level.d[q + 2] ?? 0;
    }
  }
  return d;
}

/** True when every pixel is the deep-sea colour: a sea key (§7.1, MA-10). */
export function isSeaTile(d: Uint8Array, sea: Rgb): boolean {
  for (let i = 0; i < d.length; i += 3) if (d[i] !== sea[0] || d[i + 1] !== sea[1] || d[i + 2] !== sea[2]) return false;
  return true;
}

/**
 * The top level of what shows in a level-`z` tile: the highest among the level −2 tiles it covers
 * (`tileMax` holds, per level −2 tile, the highest top level of any pixel's content).
 */
export function tileTopLevel(tileMax: Int8Array, tw: number, th: number, z: number, tx: number, ty: number): number {
  const n = 2 ** (BASE_LEVEL - z);
  let mx = -99;
  for (let y = ty * n; y < Math.min(th, (ty + 1) * n); y += 1) {
    for (let x = tx * n; x < Math.min(tw, (tx + 1) * n); x += 1) mx = Math.max(mx, tileMax[y * tw + x] ?? -99);
  }
  return mx;
}

export type TileKind = 'stored' | 'virtual' | 'sea';

/**
 * The sparse rule for levels −8 to −2 (§7.1): all deep sea → `sea`; else `stored` when the top
 * level of its content is at least `z`, otherwise `virtual` (drawn from its nearest stored ancestor).
 */
export function classifyTile(d: Uint8Array, sea: Rgb, top: number, z: number): TileKind {
  if (isSeaTile(d, sea)) return 'sea';
  return top < z ? 'virtual' : 'stored';
}

/** `floor(v / 2^k)` for non-negative integers, without bitwise operators. */
export const shiftDown = (v: number, k: number): number => Math.floor(v / 2 ** k);

/** The fine-level tiles a rectangle of atlas units touches at level `z` (§6.4). */
export function tilesOfRect(z: number, E0: number, E1: number, S0: number, S1: number, into: Set<string>): void {
  const p = 2 ** -z;
  for (let ty = Math.floor(S0 / p / TILE); ty <= Math.floor((S1 / p - 1) / TILE); ty += 1) {
    for (let tx = Math.floor(E0 / p / TILE); tx <= Math.floor((E1 / p - 1) / TILE); tx += 1) if (tx >= 0 && ty >= 0) into.add(`${String(tx)},${String(ty)}`);
  }
}

/** The nearest stored ancestor of a fine tile: a stored level −1 tile, or a stored key of levels −2 … −8. */
export type Ancestor =
  | { readonly kind: 'fine'; readonly z: number; readonly d: Uint8Array }
  | { readonly kind: 'level'; readonly z: number; readonly level: Rgb8; readonly ox: number; readonly oy: number };

export function nearestAncestor(z: number, tx: number, ty: number, fineMinus1: ReadonlyMap<string, Uint8Array>, isStored: (z: number, x: number, y: number) => boolean, levels: ReadonlyMap<number, Rgb8>): Ancestor | null {
  for (let k = 1; k <= 8; k += 1) {
    const a = z - k;
    if (a < MIN_LEVEL) break;
    const ax = shiftDown(tx, k);
    const ay = shiftDown(ty, k);
    if (a === -1) {
      const d = fineMinus1.get(`${String(ax)},${String(ay)}`);
      if (d !== undefined) return { kind: 'fine', z: a, d };
      continue;
    }
    if (isStored(a, ax, ay)) {
      const level = levels.get(a);
      if (level === undefined) throw new Error(`level ${String(a)} is missing`);
      return { kind: 'level', z: a, level, ox: ax * TILE, oy: ay * TILE };
    }
  }
  return null;
}

/**
 * The bilinear upscale of an ancestor over tile (tx, ty) of level `z`, clamped at the ancestor
 * tile's edges as the runtime draws a virtual tile (§6.4): `(i, j)` is a global pixel of level `z`.
 */
export function ancestorSampler(anc: Ancestor, z: number, tx: number, ty: number, sea: Rgb): (i: number, j: number, col: number[]) => void {
  const k = z - anc.z;
  const f = 2 ** k;
  const baseX = shiftDown(tx, k) * 2 ** k * TILE;
  const baseY = shiftDown(ty, k) * 2 ** k * TILE;
  // One texel of the ancestor, clamped to its tile (no inner closures: a hot path of the fine levels).
  const texel = (x: number, y: number, c: number): number => {
    const cx = x < 0 ? 0 : x > TILE - 1 ? TILE - 1 : x;
    const cy = y < 0 ? 0 : y > TILE - 1 ? TILE - 1 : y;
    if (anc.kind === 'fine') return anc.d[(cy * TILE + cx) * 3 + c] ?? 0;
    const X = anc.ox + cx;
    const Y = anc.oy + cy;
    return X < anc.level.w && Y < anc.level.h ? (anc.level.d[(Y * anc.level.w + X) * 3 + c] ?? 0) : (sea[c] ?? 0);
  };
  return (i, j, col) => {
    const fu = (i - baseX + 0.5) / f - 0.5;
    const fv = (j - baseY + 0.5) / f - 0.5;
    const x0 = Math.floor(fu);
    const y0 = Math.floor(fv);
    const ax = fu - x0;
    const ay = fv - y0;
    for (let c = 0; c < 3; c += 1) {
      col[c] = (texel(x0, y0, c) * (1 - ax) + texel(x0 + 1, y0, c) * ax) * (1 - ay) + (texel(x0, y0 + 1, c) * (1 - ax) + texel(x0 + 1, y0 + 1, c) * ax) * ay;
    }
  };
}

/** A bitmap over `n` keys, bit `k` in byte `floor(k / 8)` at weight `2^(k mod 8)`, as base64. */
export function bitmapBase64(n: number, keys: Iterable<number>): string {
  const bytes = new Uint8Array(Math.ceil(n / 8));
  const seen = new Set<number>();
  for (const k of keys) {
    if (seen.has(k)) continue;
    seen.add(k);
    const byte = Math.floor(k / 8);
    bytes[byte] = (bytes[byte] ?? 0) + 2 ** (k % 8);
  }
  return Buffer.from(bytes).toString('base64');
}

/** The keys set in a base64 bitmap of `n` keys. */
export function bitmapKeys(base64: string, n: number): number[] {
  const bytes = Buffer.from(base64, 'base64');
  const out: number[] = [];
  for (let k = 0; k < n; k += 1) if (Math.floor((bytes[Math.floor(k / 8)] ?? 0) / 2 ** (k % 8)) % 2 === 1) out.push(k);
  return out;
}
