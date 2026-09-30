import { RECOLOUR, type RecolourParams } from './minimap-params';
import { edgeFeather, dryClamp, navyFloor } from './minimap-seams';
import {
  ADT_YD,
  clampByte,
  isWetTexel,
  luma,
  ORIGIN_YD,
  parseTileKey,
  QUADS,
  smooth,
  TEX,
  TEXELS_PER_QUAD,
  tileKey,
  WATER_WET,
  type LiquidGrid,
  type MapTexels,
  type Rgb,
} from './minimap-texels';

/**
 * The sea recolour of docs/research/map-atlas.md §19.2 (revision 3.1; D-049 O12), steps 1-6 in
 * texel space per ADT tile, then the seam steps 7-9 (`minimap-seams.ts`). Ported from the signed-off
 * prototype (`rule3.ts` with `P31`, build `b5`) with the same arithmetic in the same order, so the
 * same texels come out; the edge skirts of §18.6, which the prototype did not apply, are new. Pure:
 * no file system, clock or randomness, no bitwise operators (D-012).
 *
 * 1. Colour weight `w_c = warm · chroma · cap · hue` (water is cool, coloured, not bright, and not
 *    bluer than both families).
 * 2. Gate: 1 on a wet quad of the client's liquid grid and within 1 quad (4.2 yd), 0 from 2 quads
 *    (8.3 yd), bilinear per texel. `w = w_c · gate`.
 * 3. Family field: per tile, the `w_c`-weighted mean of b − g over the tile's own wet texels, two box
 *    passes of radius 12, then `f = smoothstep(2, 18, ·)`; the open-sea reference moves with `f`
 *    between the dark and the navy family's (no texel's own tint can flip it).
 * 4. Ramp `t = smoothstep(0, 60, L − ref)` times the family feather; on a dry quad `t` is capped so the
 *    target is never brighter than the texel (the dry cap). Target `navy + t · (shallow − navy)`.
 * 5. Mix `out = c + w · (target − c)`.
 * 6. Void: pure black connected through pure black to an absent ADT, and the edge skirts, become the
 *    navy; haze (texels joined to the void through luma below 64, up to 192 texels) is composited
 *    over the navy by coverage.
 */

export interface RecolourStats {
  voidTexels: number;
  skirtTexels: number;
  full: number;
  partial: number;
  hazeTexels: number;
  dryCapped: number;
  dryClamped: number;
  floored: number;
}

export interface SkirtSide {
  readonly tile: string;
  readonly side: 'N' | 'S' | 'W' | 'E';
  /** Texels of the strip on dry quads (the whole strip, 32 × 512 texels, is made void). */
  readonly dryTexels: number;
  readonly dryShare: number;
  /** Share of the dry texels the three most common colours cover. */
  readonly topShare: number;
  readonly topColours: readonly (readonly [number, number, number, number])[];
  readonly nextWetShare: number;
  /** World position of the strip's middle (yd). */
  readonly worldX: number;
  readonly worldY: number;
}

export interface BlackComponent {
  readonly tile: string;
  readonly texels: number;
  /** Tile texel bounding box `[x0, y0, x1, y1]`. */
  readonly box: readonly [number, number, number, number];
  readonly worldX: number;
  readonly worldY: number;
}

export interface BlackCensus {
  /** Pure-black texels not connected to the void (kept as drawn, O16), per tile component. */
  readonly components: number;
  readonly texels: number;
  readonly tiles: number;
  readonly sizeClasses: Readonly<Record<string, number>>;
  /** Components over 64 texels, largest first. */
  readonly over64: readonly BlackComponent[];
}

export interface MapRecolour {
  readonly rec: Map<string, Uint8Array>;
  /** Recolour weight × 255 per texel (the feathers' and the census's water test). */
  readonly weight: Map<string, Uint8Array>;
  /** Void texels (1) per tile, the edge skirts included. */
  readonly voidMasks: ReadonlyMap<string, Uint8Array>;
  /** Haze weight per tile (tiles with any haze only). */
  readonly haze: ReadonlyMap<string, Float32Array>;
  readonly stats: RecolourStats;
  readonly familyFeatheredTiles: number;
  readonly edgeFeathered: number;
  readonly skirts: readonly SkirtSide[];
  readonly black: BlackCensus;
}

// ---------------------------------------------------------------------------------------------
// Step 1: colour weight

export function colourWeight(r: number, g: number, b: number, p: RecolourParams = RECOLOUR): number {
  const warm = smooth(p.warm[0], p.warm[1], b - r);
  if (warm <= 0) return 0;
  const chroma = smooth(p.chroma[0], p.chroma[1], Math.max(g, b) - r);
  if (chroma <= 0) return 0;
  return warm * chroma * (1 - smooth(p.lumaCap[0], p.lumaCap[1], luma(r, g, b))) * (1 - smooth(p.hue[0], p.hue[1], b - g));
}

// ---------------------------------------------------------------------------------------------
// Step 2: the gate

/**
 * The gate over the liquid grid: 1 on wet quads and within `hard` quads of one, falling to 0 over
 * `soft` more, by a two-pass chamfer distance (steps 1 and 1.4142) in quads.
 */
export function softGate(l: LiquidGrid, hard: number, soft: number): Float32Array {
  const W = l.quadCols;
  const H = l.quadRows;
  const d = new Float32Array(W * H).fill(1e9);
  for (let i = 0; i < W * H; i += 1) if (l.water[i] === WATER_WET) d[i] = 0;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const g = y * W + x;
      let v = d[g] ?? 0;
      if (x > 0) v = Math.min(v, (d[g - 1] ?? 0) + 1);
      if (y > 0) v = Math.min(v, (d[g - W] ?? 0) + 1);
      if (x > 0 && y > 0) v = Math.min(v, (d[g - W - 1] ?? 0) + 1.4142);
      if (x < W - 1 && y > 0) v = Math.min(v, (d[g - W + 1] ?? 0) + 1.4142);
      d[g] = v;
    }
  }
  for (let y = H - 1; y >= 0; y -= 1) {
    for (let x = W - 1; x >= 0; x -= 1) {
      const g = y * W + x;
      let v = d[g] ?? 0;
      if (x < W - 1) v = Math.min(v, (d[g + 1] ?? 0) + 1);
      if (y < H - 1) v = Math.min(v, (d[g + W] ?? 0) + 1);
      if (x < W - 1 && y < H - 1) v = Math.min(v, (d[g + W + 1] ?? 0) + 1.4142);
      if (x > 0 && y < H - 1) v = Math.min(v, (d[g + W - 1] ?? 0) + 1.4142);
      d[g] = v;
    }
  }
  // in place: each distance is read once, before its gate value replaces it
  for (let i = 0; i < W * H; i += 1) d[i] = 1 - smooth(hard, hard + soft, d[i] ?? 0);
  return d;
}

/** The gate at texel (x, y) of tile (row, col): bilinear over the quad centres, clamped to the grid. */
export function gateAt(gate: Float32Array, l: LiquidGrid, row: number, col: number, x: number, y: number): number {
  const qr0 = (row - l.row0) * QUADS;
  const qc0 = (col - l.col0) * QUADS;
  const fx = (qc0 * TEXELS_PER_QUAD + x + 0.5) / TEXELS_PER_QUAD - 0.5;
  const fy = (qr0 * TEXELS_PER_QUAD + y + 0.5) / TEXELS_PER_QUAD - 0.5;
  const x0 = Math.max(0, Math.min(l.quadCols - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(l.quadRows - 1, Math.floor(fy)));
  const x1 = Math.min(l.quadCols - 1, x0 + 1);
  const y1 = Math.min(l.quadRows - 1, y0 + 1);
  const ax = Math.max(0, Math.min(1, fx - x0));
  const ay = Math.max(0, Math.min(1, fy - y0));
  const W = l.quadCols;
  return (
    ((gate[y0 * W + x0] ?? 0) * (1 - ax) + (gate[y0 * W + x1] ?? 0) * ax) * (1 - ay) +
    ((gate[y1 * W + x0] ?? 0) * (1 - ax) + (gate[y1 * W + x1] ?? 0) * ax) * ay
  );
}

// ---------------------------------------------------------------------------------------------
// Step 3: the family field

/** Box sum of radius `r` (zero outside) along rows, then columns, in place (`tmp` is scratch). */
function box2(a: Float32Array, W: number, r: number, tmp: Float32Array): void {
  for (let y = 0; y < W; y += 1) {
    let s = 0;
    const o = y * W;
    for (let x = 0; x < r && x < W; x += 1) s += a[o + x] ?? 0;
    for (let x = 0; x < W; x += 1) {
      if (x + r < W) s += a[o + x + r] ?? 0;
      if (x - r - 1 >= 0) s -= a[o + x - r - 1] ?? 0;
      tmp[o + x] = s;
    }
  }
  for (let x = 0; x < W; x += 1) {
    let s = 0;
    for (let y = 0; y < r && y < W; y += 1) s += tmp[y * W + x] ?? 0;
    for (let y = 0; y < W; y += 1) {
      if (y + r < W) s += tmp[(y + r) * W + x] ?? 0;
      if (y - r - 1 >= 0) s -= tmp[(y - r - 1) * W + x] ?? 0;
      a[y * W + x] = s;
    }
  }
}

/**
 * The family weight of every texel of tile (row, col): 0 takes the dark family's open-sea
 * reference, 1 the navy family's (§19.2 step 3). Reads only the tile's own texels, because the source
 * draws one water style per tile.
 */
export function familyField(src: Uint8Array, l: LiquidGrid, row: number, col: number, p: RecolourParams = RECOLOUR): Float32Array {
  const f = new Float32Array(TEX * TEX);
  const H = 2 * p.familyRadius;
  const W = TEX + 2 * H;
  const num = new Float32Array(W * W);
  const den = new Float32Array(W * W);
  const tmp = new Float32Array(W * W);
  const qr0 = (row - l.row0) * QUADS;
  const qc0 = (col - l.col0) * QUADS;
  for (let ly = 0; ly < TEX; ly += 1) {
    const qy = qr0 + Math.floor(ly / TEXELS_PER_QUAD);
    if (qy < 0 || qy >= l.quadRows) continue;
    for (let lx = 0; lx < TEX; lx += 1) {
      const qx = qc0 + Math.floor(lx / TEXELS_PER_QUAD);
      if (qx < 0 || qx >= l.quadCols || l.water[qy * l.quadCols + qx] !== WATER_WET) continue;
      const q = (ly * TEX + lx) * 3;
      const r = src[q] ?? 0;
      const g = src[q + 1] ?? 0;
      const b = src[q + 2] ?? 0;
      const w = colourWeight(r, g, b, p);
      if (w <= 0) continue;
      const bg = Math.max(p.familyClamp[0], Math.min(p.familyClamp[1], b - g));
      const k = (ly + H) * W + lx + H;
      num[k] = w * bg;
      den[k] = w;
    }
  }
  box2(num, W, p.familyRadius, tmp);
  box2(num, W, p.familyRadius, tmp);
  box2(den, W, p.familyRadius, tmp);
  box2(den, W, p.familyRadius, tmp);
  for (let y = 0; y < TEX; y += 1) {
    for (let x = 0; x < TEX; x += 1) {
      const i = y * TEX + x;
      const k = (y + H) * W + x + H;
      const d = den[k] ?? 0;
      const bg = d > 1e-3 ? (num[k] ?? 0) / d : (src[i * 3 + 2] ?? 0) - (src[i * 3 + 1] ?? 0);
      f[i] = smooth(p.familyStep[0], p.familyStep[1], bg);
    }
  }
  return f;
}

// ---------------------------------------------------------------------------------------------
// Step 4: the family feather (a tile's modal water colour, its family, and edges between families)

export type Family = 'dark' | 'navy';

export interface TileBase {
  readonly base: Rgb | null;
  readonly family: Family | null;
}

/** The two water families by a tile's modal wet colour (§17.1): dark rgb(8, 16, 16) and its variants, navy rgb(27–33, 47–68, 66–96). */
export function familyOf(base: Rgb | null): Family | null {
  if (base === null) return null;
  const [r, g, b] = base;
  if (r <= 12 && g >= 12 && g <= 26 && b >= 12 && b <= 28 && g >= r + 4 && b >= r + 4) return 'dark';
  if (r <= 40 && g >= 40 && g <= 75 && b >= 60 && b <= 100 && b >= r + 30 && b > g) return 'navy';
  return null;
}

/** Per tile: the most common exact colour over wet texels (every second texel), and its family. */
export function tileBases(m: MapTexels, l: LiquidGrid): Map<string, TileBase> {
  const out = new Map<string, TileBase>();
  for (const t of m.tiles) {
    const k = tileKey(t.row, t.col);
    const px = m.rgb.get(k);
    if (px === undefined) continue;
    const qr0 = (t.row - l.row0) * QUADS;
    const qc0 = (t.col - l.col0) * QUADS;
    const modes = new Map<number, number>();
    for (let y = 0; y < TEX; y += 2) {
      for (let x = 0; x < TEX; x += 2) {
        if (l.water[(qr0 + Math.floor(y / TEXELS_PER_QUAD)) * l.quadCols + qc0 + Math.floor(x / TEXELS_PER_QUAD)] !== WATER_WET) continue;
        const p = (y * TEX + x) * 3;
        const key = (px[p] ?? 0) * 65536 + (px[p + 1] ?? 0) * 256 + (px[p + 2] ?? 0);
        modes.set(key, (modes.get(key) ?? 0) + 1);
      }
    }
    let best = -1;
    let bestN = 0;
    for (const [key, n] of modes) {
      if (n > bestN || (n === bestN && key < best)) {
        best = key;
        bestN = n;
      }
    }
    const base: Rgb | null = best < 0 ? null : [Math.floor(best / 65536), Math.floor(best / 256) % 256, best % 256];
    out.set(k, { base, family: familyOf(base) });
  }
  return out;
}

/** A tile without wet texels takes the most common base among its 8 neighbours that have a family. */
export function smoothBases(bases: ReadonlyMap<string, TileBase>): Map<string, TileBase> {
  const out = new Map(bases);
  for (const [k, v] of bases) {
    if (v.family !== null) continue;
    const [r, c] = parseTileKey(k);
    const votes = new Map<string, { n: number; b: TileBase }>();
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const n = bases.get(tileKey(r + dr, c + dc));
        if (n === undefined || n.family === null || n.base === null) continue;
        const kk = n.base.join(',');
        const e = votes.get(kk) ?? { n: 0, b: n };
        e.n += 1;
        votes.set(kk, e);
      }
    }
    let best: TileBase | null = null;
    let bn = 0;
    for (const e of votes.values()) {
      if (e.n > bn) {
        bn = e.n;
        best = e.b;
      }
    }
    if (best !== null && v.base === null) out.set(k, best);
  }
  return out;
}

/** Per tile beside a tile of the other family: the feather factor, 0 at the shared edge rising to 1 over `F` texels. */
export function familyFeathers(bases: ReadonlyMap<string, TileBase>, F: number): Map<string, (x: number, y: number) => number> {
  const out = new Map<string, (x: number, y: number) => number>();
  for (const [k, v] of bases) {
    if (v.family === null) continue;
    const [r, c] = parseTileKey(k);
    const differs = (dr: number, dc: number): boolean => {
      const n = bases.get(tileKey(r + dr, c + dc));
      return n !== undefined && n.family !== null && n.family !== v.family;
    };
    const W = differs(0, -1);
    const E = differs(0, 1);
    const N = differs(-1, 0);
    const S = differs(1, 0);
    if (!W && !E && !N && !S) continue;
    out.set(k, (x, y) => {
      let d = 1e9;
      if (W) d = Math.min(d, x + 0.5);
      if (E) d = Math.min(d, TEX - 0.5 - x);
      if (N) d = Math.min(d, y + 0.5);
      if (S) d = Math.min(d, TEX - 0.5 - y);
      return smooth(0, F, d);
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Step 6: the void, the edge skirts, the haze

const isBlack = (px: Uint8Array, i: number): boolean => px[i * 3] === 0 && px[i * 3 + 1] === 0 && px[i * 3 + 2] === 0;

const worldXOf = (row: number, yTexel: number): number => ORIGIN_YD - (row + yTexel / TEX) * ADT_YD;
const worldYOf = (col: number, xTexel: number): number => ORIGIN_YD - (col + xTexel / TEX) * ADT_YD;

/**
 * The void of a map: pure-black texels 4-connected through pure black to an absent ADT. Returns the
 * void per tile, and the census of the other black texels (O16: kept as drawn), per tile component.
 */
export function voidMasks(m: MapTexels): { readonly masks: Map<string, Uint8Array>; readonly black: BlackCensus } {
  // 0 other, 1 black, 2 void
  const state = new Map<string, Uint8Array>();
  for (const t of m.tiles) {
    const k = tileKey(t.row, t.col);
    const px = m.rgb.get(k);
    if (px === undefined) continue;
    let s: Uint8Array | null = null;
    for (let i = 0; i < TEX * TEX; i += 1) {
      if (!isBlack(px, i)) continue;
      s ??= new Uint8Array(TEX * TEX);
      s[i] = 1;
    }
    if (s !== null) state.set(k, s);
  }
  const present = (r: number, c: number): boolean => m.rgb.has(tileKey(r, c));
  const stack: number[] = [];
  const tiles: string[] = [];
  const tileIndex = new Map<string, number>();
  const indexOf = (k: string): number => {
    let n = tileIndex.get(k);
    if (n === undefined) {
      n = tiles.length;
      tiles.push(k);
      tileIndex.set(k, n);
    }
    return n;
  };
  const mark = (r: number, c: number, i: number): void => {
    const k = tileKey(r, c);
    const s = state.get(k);
    if (s !== undefined && s[i] === 1) {
      s[i] = 2;
      stack.push(indexOf(k) * TEX * TEX + i);
    }
  };
  for (const [k, s] of state) {
    const [r, c] = parseTileKey(k);
    void s;
    for (let j = 0; j < TEX; j += 1) {
      if (!present(r - 1, c)) mark(r, c, j);
      if (!present(r + 1, c)) mark(r, c, (TEX - 1) * TEX + j);
      if (!present(r, c - 1)) mark(r, c, j * TEX);
      if (!present(r, c + 1)) mark(r, c, j * TEX + TEX - 1);
    }
  }
  while (stack.length > 0) {
    const code = stack.pop() ?? 0;
    const i = code % (TEX * TEX);
    const [r, c] = parseTileKey(tiles[(code - i) / (TEX * TEX)] ?? '0_0');
    const x = i % TEX;
    const y = (i - x) / TEX;
    if (x > 0) mark(r, c, i - 1);
    else mark(r, c - 1, i + TEX - 1);
    if (x < TEX - 1) mark(r, c, i + 1);
    else mark(r, c + 1, i - TEX + 1);
    if (y > 0) mark(r, c, i - TEX);
    else mark(r - 1, c, i + (TEX - 1) * TEX);
    if (y < TEX - 1) mark(r, c, i + TEX);
    else mark(r + 1, c, i - (TEX - 1) * TEX);
  }
  // the black texels left: per-tile 4-connected components
  const components: BlackComponent[] = [];
  const sizeClasses: Record<string, number> = { '1': 0, '2-4': 0, '5-16': 0, '17-64': 0, '65-256': 0, '>256': 0 };
  let texels = 0;
  const tilesWith = new Set<string>();
  for (const t of m.tiles) {
    const k = tileKey(t.row, t.col);
    const s = state.get(k);
    if (s === undefined) continue;
    const seen = new Uint8Array(TEX * TEX);
    for (let g = 0; g < TEX * TEX; g += 1) {
      if (s[g] !== 1 || seen[g] === 1) continue;
      let n = 0;
      let x0 = TEX;
      let y0 = TEX;
      let x1 = -1;
      let y1 = -1;
      const st = [g];
      seen[g] = 1;
      while (st.length > 0) {
        const h = st.pop() ?? 0;
        n += 1;
        const x = h % TEX;
        const y = (h - x) / TEX;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
        for (const q of [x > 0 ? h - 1 : -1, x < TEX - 1 ? h + 1 : -1, y > 0 ? h - TEX : -1, y < TEX - 1 ? h + TEX : -1]) {
          if (q >= 0 && s[q] === 1 && seen[q] !== 1) {
            seen[q] = 1;
            st.push(q);
          }
        }
      }
      texels += n;
      tilesWith.add(k);
      const cls = n === 1 ? '1' : n <= 4 ? '2-4' : n <= 16 ? '5-16' : n <= 64 ? '17-64' : n <= 256 ? '65-256' : '>256';
      sizeClasses[cls] = (sizeClasses[cls] ?? 0) + 1;
      if (n > 64) {
        components.push({ tile: k, texels: n, box: [x0, y0, x1, y1], worldX: Math.round(worldXOf(t.row, (y0 + y1) / 2)), worldY: Math.round(worldYOf(t.col, (x0 + x1) / 2)) });
      }
    }
  }
  components.sort((a, b) => b.texels - a.texels || (a.tile < b.tile ? -1 : a.tile > b.tile ? 1 : a.box[1] - b.box[1] || a.box[0] - b.box[0]));
  const masks = new Map<string, Uint8Array>();
  for (const t of m.tiles) {
    const k = tileKey(t.row, t.col);
    const s = state.get(k);
    if (s === undefined) continue;
    let mk: Uint8Array | null = null;
    for (let i = 0; i < TEX * TEX; i += 1) {
      if (s[i] !== 2) continue;
      mk ??= new Uint8Array(TEX * TEX);
      mk[i] = 1;
    }
    if (mk !== null) masks.set(k, mk);
  }
  const count = Object.values(sizeClasses).reduce((a, b) => a + b, 0);
  return { masks, black: { components: count, texels, tiles: tilesWith.size, sizeClasses, over64: components } };
}

type Side = 'N' | 'S' | 'W' | 'E';
const SIDES: readonly (readonly [Side, number, number])[] = [
  ['N', -1, 0],
  ['S', 1, 0],
  ['W', 0, -1],
  ['E', 0, 1],
];

/** Texel (x, y) at position `j` along a side and `depth` texels in from it. */
function sideTexel(side: Side, j: number, depth: number): readonly [number, number] {
  if (side === 'N') return [j, depth];
  if (side === 'S') return [j, TEX - 1 - depth];
  if (side === 'W') return [depth, j];
  return [TEX - 1 - depth, j];
}

/**
 * The edge skirts (§18.6): on a side facing an absent ADT, the outermost chunk row (32 texels) is a
 * skirt when at least half of its texels lie on dry quads, the three most common colours cover at
 * least 90 % of those dry texels (flat drawn ground, not terrain detail), and the next chunk row
 * inward is at least 90 % wet in the liquid grid. The whole strip becomes void (the navy): its
 * inner texels, over the chunk row's last wet quads, hold the ground's blended edge, which would
 * otherwise stay as a faint line.
 *
 * The design worded the test as "at most three distinct colours, whose chunks have no liquid"; the
 * four skirts it names (north of Kalimdor 20_45-20_47 and east of 20_47) hold 4 to 9 colours, three
 * of which cover 92-98 % of their dry texels, and their chunk row's inner quad row is wet (the
 * ground ends 28 texels in). The test above is that wording made to fit the texels it was written from.
 */
export function edgeSkirts(m: MapTexels, l: LiquidGrid, p: RecolourParams = RECOLOUR): { readonly masks: Map<string, Uint8Array>; readonly sides: SkirtSide[] } {
  const masks = new Map<string, Uint8Array>();
  const sides: SkirtSide[] = [];
  const D = p.skirtDepth;
  for (const t of m.tiles) {
    const k = tileKey(t.row, t.col);
    const px = m.rgb.get(k);
    if (px === undefined) continue;
    for (const [side, dr, dc] of SIDES) {
      if (m.rgb.has(tileKey(t.row + dr, t.col + dc))) continue;
      const colours = new Map<number, number>();
      let dry = 0;
      let blackDry = 0;
      for (let d = 0; d < D; d += 1) {
        for (let j = 0; j < TEX; j += 1) {
          const [x, y] = sideTexel(side, j, d);
          if (isWetTexel(l, t.row, t.col, x, y)) continue;
          dry += 1;
          const q = (y * TEX + x) * 3;
          const key = (px[q] ?? 0) * 65536 + (px[q + 1] ?? 0) * 256 + (px[q + 2] ?? 0);
          if (key === 0) blackDry += 1;
          colours.set(key, (colours.get(key) ?? 0) + 1);
        }
      }
      if (dry === 0 || blackDry === dry) continue;
      let nextWet = 0;
      for (let d = D; d < 2 * D; d += 1) {
        for (let j = 0; j < TEX; j += 1) {
          const [x, y] = sideTexel(side, j, d);
          if (isWetTexel(l, t.row, t.col, x, y)) nextWet += 1;
        }
      }
      const top = [...colours].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, p.skirtTopColours);
      const topShare = top.reduce((s, e) => s + e[1], 0) / dry;
      const dryShare = dry / (D * TEX);
      const nextWetShare = nextWet / (D * TEX);
      if (dryShare < p.skirtMinDryShare || topShare < p.skirtTopShare || nextWetShare < p.skirtNextWetShare) continue;
      let mk = masks.get(k);
      if (mk === undefined) {
        mk = new Uint8Array(TEX * TEX);
        masks.set(k, mk);
      }
      for (let d = 0; d < D; d += 1) {
        for (let j = 0; j < TEX; j += 1) {
          const [x, y] = sideTexel(side, j, d);
          mk[y * TEX + x] = 1;
        }
      }
      const [mx, my] = sideTexel(side, TEX / 2, D / 2);
      sides.push({
        tile: k,
        side,
        dryTexels: dry,
        dryShare: Math.round(dryShare * 1e4) / 1e4,
        topShare: Math.round(topShare * 1e4) / 1e4,
        topColours: top.map(([key, n]) => [Math.floor(key / 65536), Math.floor(key / 256) % 256, key % 256, n] as const),
        nextWetShare: Math.round(nextWetShare * 1e4) / 1e4,
        worldX: Math.round(worldXOf(t.row, my)),
        worldY: Math.round(worldYOf(t.col, mx)),
      });
    }
  }
  return { masks, sides };
}

/**
 * The haze weight per tile: a breadth-first flood from the void through texels darker than
 * `hazeLuma`, up to `hazeMax` texels, weight `1 − smoothstep(max − fade, max, distance)`.
 */
export function hazeFields(m: MapTexels, voids: ReadonlyMap<string, Uint8Array>, p: RecolourParams = RECOLOUR): Map<string, Float32Array> {
  const out = new Map<string, Float32Array>();
  if (voids.size === 0) return out;
  const N = TEX * TEX;
  const keys: string[] = [];
  const indexOf = new Map<string, number>();
  const dist: Uint16Array[] = [];
  const tileOf = (k: string): number => {
    let n = indexOf.get(k);
    if (n === undefined) {
      n = keys.length;
      keys.push(k);
      indexOf.set(k, n);
      dist.push(new Uint16Array(N).fill(65535));
    }
    return n;
  };
  let frontier: number[] = [];
  for (const [k, vm] of voids) {
    const n = tileOf(k);
    const d = dist[n] as Uint16Array;
    for (let i = 0; i < N; i += 1) {
      if (vm[i] !== 1) continue;
      d[i] = 0;
      frontier.push(n * N + i);
    }
  }
  for (let step = 1; step <= p.hazeMax && frontier.length > 0; step += 1) {
    const next: number[] = [];
    for (const code of frontier) {
      const i = code % N;
      const [r, c] = parseTileKey(keys[(code - i) / N] ?? '0_0');
      const x = i % TEX;
      const y = (i - x) / TEX;
      const visit = (rr: number, cc: number, j: number): void => {
        const k = tileKey(rr, cc);
        const t = m.rgb.get(k);
        if (t === undefined) return;
        const n = tileOf(k);
        const d = dist[n] as Uint16Array;
        if ((d[j] ?? 0) <= step) return;
        if (luma(t[j * 3] ?? 0, t[j * 3 + 1] ?? 0, t[j * 3 + 2] ?? 0) >= p.hazeLuma) return;
        d[j] = step;
        next.push(n * N + j);
      };
      if (x > 0) visit(r, c, i - 1);
      else visit(r, c - 1, i + TEX - 1);
      if (x < TEX - 1) visit(r, c, i + 1);
      else visit(r, c + 1, i - TEX + 1);
      if (y > 0) visit(r, c, i - TEX);
      else visit(r - 1, c, i + (TEX - 1) * TEX);
      if (y < TEX - 1) visit(r, c, i + TEX);
      else visit(r + 1, c, i - (TEX - 1) * TEX);
    }
    frontier = next;
  }
  keys.forEach((k, n) => {
    const d = dist[n] as Uint16Array;
    const w = new Float32Array(N);
    let any = false;
    for (let i = 0; i < N; i += 1) {
      const v = d[i] ?? 65535;
      if (v > 0 && v < 65535) {
        w[i] = 1 - smooth(p.hazeMax - p.hazeFade, p.hazeMax, v);
        any = true;
      }
    }
    if (any) out.set(k, w);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// The whole rule

/**
 * Recolours one map (§19.2 steps 1-9). `m.tiles` must be row-major (the order the feathers' sums
 * are taken in). Returns new tiles; the source is not modified.
 */
export function recolourMap(m: MapTexels, l: LiquidGrid, p: RecolourParams = RECOLOUR): MapRecolour {
  const [nr, ng, nb] = p.navy;
  const [sr, sg, sb] = p.shallow;
  const Ln = luma(nr, ng, nb);
  const Ls = luma(sr, sg, sb);
  const gate = softGate(l, p.gateQuads[0], p.gateQuads[1] - p.gateQuads[0]);
  const bases = tileBases(m, l);
  const feathers = familyFeathers(smoothBases(bases), p.familyFeather);
  const v = voidMasks(m);
  const skirts = edgeSkirts(m, l, p);
  const voids = new Map(v.masks);
  let skirtTexels = 0;
  for (const [k, mk] of skirts.masks) {
    const into = voids.get(k) ?? new Uint8Array(TEX * TEX);
    for (let i = 0; i < TEX * TEX; i += 1) {
      if (mk[i] === 1 && into[i] !== 1) {
        into[i] = 1;
        skirtTexels += 1;
      }
    }
    voids.set(k, into);
  }
  const haze = hazeFields(m, voids, p);
  const stats: RecolourStats = { voidTexels: 0, skirtTexels, full: 0, partial: 0, hazeTexels: 0, dryCapped: 0, dryClamped: 0, floored: 0 };
  const rec = new Map<string, Uint8Array>();
  const weight = new Map<string, Uint8Array>();
  const refDark = p.darkLuma + p.darkDeadZone;
  const refNavy = p.navyFamilyLuma + p.navyDeadZone;
  for (const t of m.tiles) {
    const k = tileKey(t.row, t.col);
    const src = m.rgb.get(k);
    if (src === undefined) continue;
    const ff = feathers.get(k);
    const vm = voids.get(k) ?? null;
    const hz = haze.get(k) ?? null;
    let fam: Float32Array | null = null;
    const out = new Uint8Array(TEX * TEX * 3);
    const wv = new Uint8Array(TEX * TEX);
    for (let y = 0; y < TEX; y += 1) {
      for (let x = 0; x < TEX; x += 1) {
        const i = y * TEX + x;
        const q = i * 3;
        const r = src[q] ?? 0;
        const g = src[q + 1] ?? 0;
        const b = src[q + 2] ?? 0;
        if (vm !== null && vm[i] === 1) {
          out[q] = nr;
          out[q + 1] = ng;
          out[q + 2] = nb;
          wv[i] = 255;
          stats.voidTexels += 1;
          continue;
        }
        let R = r;
        let G = g;
        let B = b;
        let ww = 0;
        const L = luma(r, g, b);
        const gv = gateAt(gate, l, t.row, t.col, x, y);
        if (gv > 0) {
          const wc = colourWeight(r, g, b, p);
          if (wc > 0) {
            fam ??= familyField(src, l, t.row, t.col, p);
            const f = fam[i] ?? 0;
            const ref = refDark * (1 - f) + refNavy * f;
            let tt = smooth(0, p.rampSpan, L - ref) * (ff === undefined ? 1 : ff(x, y));
            if (!isWetTexel(l, t.row, t.col, x, y)) {
              const cap = Math.max(0, Math.min(1, (L - Ln) / (Ls - Ln)));
              if (tt > cap) {
                tt = cap;
                stats.dryCapped += 1;
              }
            }
            ww = wc * gv;
            R = r + (nr + (sr - nr) * tt - r) * ww;
            G = g + (ng + (sg - ng) * tt - g) * ww;
            B = b + (nb + (sb - nb) * tt - b) * ww;
            if (ww >= 0.999) stats.full += 1;
            else stats.partial += 1;
          }
        }
        const hw = hz === null ? 0 : (hz[i] ?? 0);
        if (hw > 0 && ww < 1) {
          const a = Math.min(1, L / p.hazeLuma);
          const h = (1 - a) * hw * (1 - ww);
          if (h > 0) {
            R += nr * h;
            G += ng * h;
            B += nb * h;
            stats.hazeTexels += 1;
          }
        }
        out[q] = clampByte(R);
        out[q + 1] = clampByte(G);
        out[q + 2] = clampByte(B);
        wv[i] = Math.round(ww * 255);
      }
    }
    rec.set(k, out);
    weight.set(k, wv);
  }
  const edgeFeathered = edgeFeather(rec, weight, p);
  stats.floored = navyFloor(rec, weight, voids, p);
  stats.dryClamped = dryClamp(m, l, rec, weight, voids, haze);
  return { rec, weight, voidMasks: voids, haze, stats, familyFeatheredTiles: feathers.size, edgeFeathered, skirts: skirts.sides, black: v.black };
}
