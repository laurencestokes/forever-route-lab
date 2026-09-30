import { CENSUS_GATES, NAVY, RECOLOUR, SEAM_MEASURE } from './minimap-params';
import { RELIEF_LAND, RELIEF_NONE, RELIEF_WATER, type ReliefClasses } from './minimap-liquid';
import { ADT_YD, isWetTexel, luma, ORIGIN_YD, QUADS, TEX, TEXEL_YD, tileKey, WATER_WET, type LiquidGrid, type MapTexels, type Rgb } from './minimap-texels';

/**
 * The recolour census and its gates (docs/research/map-atlas.md §19.5; revision 3.1, MM-01 to
 * MM-03), ported from the prototype's `build3.ts` (native texels) and `seams-levels.ts` (the built
 * pyramid), with the contrast of §19.3 and the sea-key check M9. The build fails when a gate fails
 * (`censusFailures`). Pure; no bitwise operators.
 */

// ---------------------------------------------------------------------------------------------
// Native texels (per map)

export interface SeamSummary {
  readonly waterEdges: number;
  readonly over3: number;
  readonly over6: number;
  readonly over10: number;
  readonly over20: number;
  readonly p99: number;
  readonly max: number;
}

export interface NativeCensus {
  readonly tiles: number;
  /** Revision 3's seam metric (4-texel bands across each ADT edge with 64+ rows of water), kept for continuity. */
  readonly seamsBefore: SeamSummary;
  readonly seamsAfter: SeamSummary;
  /** Wet 16 × 16 blocks whose luma SD more than doubles (`sd' > 2 sd + 2`). */
  readonly texture: {
    readonly wetBlocks: number;
    readonly amplified: number;
    readonly share: number;
    readonly amplified15: number;
    readonly meanSdBefore: number;
    readonly meanSdAfter: number;
    /** `[sd' − sd, row, col, x, y, sd, sd']`, largest first. */
    readonly worst: readonly (readonly number[])[];
  };
  /** Water-to-water pairs 4 texels apart (both weights ≥ 0.9, luma differing by 8+) reversed by 4+. */
  readonly order: { readonly pairs: number; readonly inversions: number; readonly share: number; readonly hotTiles: readonly (readonly [string, number])[] };
  readonly dry: { readonly recolouredHalf: number; readonly touched: number; readonly brightened: number; readonly maxBrighten: number };
  /** Agreement with the committed relief's cells (maps with committed terrain). */
  readonly relief: ReliefAgreement | null;
}

export interface ReliefAgreement {
  /** Cells holding void texels (the edge skirts): altered by rule, not counted. */
  readonly voidCells: number;
  readonly waterCells: number;
  readonly waterRecoloured: number;
  readonly waterUntouched: number;
  readonly landCells: number;
  readonly landRecoloured: number;
  readonly landPartly: number;
  readonly shoreLandCells: number;
  readonly shoreRecoloured: number;
  readonly shorePartly: number;
  readonly shoreBluer8: number;
  readonly inlandBluer8: number;
  readonly shoreDryCells: number;
  readonly shoreDryBluer8: number;
  readonly shoreDryBluer4: number;
  /** The ten bluest fully dry shore cells: `[blue, relief x, relief y]`. */
  readonly bluestDryShore: readonly (readonly number[])[];
}

const r2 = (v: number, places = 3): number => Math.round(v * 10 ** places) / 10 ** places;

function seamSummary(m: MapTexels, tiles: ReadonlyMap<string, Uint8Array>, weights: ReadonlyMap<string, Uint8Array>): SeamSummary {
  const steps: number[] = [];
  for (const t of m.tiles) {
    for (const [dr, dc] of [
      [0, 1],
      [1, 0],
    ] as const) {
      const a = tileKey(t.row, t.col);
      const b = tileKey(t.row + dr, t.col + dc);
      const A = tiles.get(a);
      const B = tiles.get(b);
      const WA = weights.get(a);
      const WB = weights.get(b);
      if (A === undefined || B === undefined || WA === undefined || WB === undefined) continue;
      let s = 0;
      let n = 0;
      for (let j = 0; j < TEX; j += 1) {
        const ia = dc === 1 ? j * TEX + TEX - 1 : (TEX - 1) * TEX + j;
        const ib = dc === 1 ? j * TEX : j;
        if ((WA[ia] ?? 0) < 230 || (WB[ib] ?? 0) < 230) continue;
        let d = 0;
        for (let c = 0; c < 3; c += 1) {
          let sa = 0;
          let sb = 0;
          for (let o = 0; o < 4; o += 1) {
            const pa = dc === 1 ? j * TEX + TEX - 1 - o : (TEX - 1 - o) * TEX + j;
            const pb = dc === 1 ? j * TEX + o : o * TEX + j;
            sa += A[pa * 3 + c] ?? 0;
            sb += B[pb * 3 + c] ?? 0;
          }
          d += Math.abs(sa - sb) / 4;
        }
        s += d / 3;
        n += 1;
      }
      if (n >= 64) steps.push(s / n);
    }
  }
  steps.sort((x, y) => x - y);
  const over = (th: number): number => steps.filter((x) => x > th).length;
  return { waterEdges: steps.length, over3: over(3), over6: over(6), over10: over(10), over20: over(20), p99: r2(steps[Math.floor(steps.length * 0.99)] ?? 0), max: r2(steps[steps.length - 1] ?? 0) };
}

/** The census of one map at native texels: source `m`, recoloured `rec` with weights, the liquid grid, and the relief (maps 0 and 1). */
/**
 * The census of one map at native texels: source `m`, recoloured `rec` with weights, the liquid grid, the relief (maps 0 and 1),
 * and the void (the edge skirts included) and haze, which the rule re-composites over the navy: their texels are exempt from the
 * dry-texel count, and relief cells holding void texels from the relief agreement (they are listed as `voidCells`).
 */
export function nativeCensus(m: MapTexels, rec: ReadonlyMap<string, Uint8Array>, weight: ReadonlyMap<string, Uint8Array>, l: LiquidGrid, relief: ReliefClasses | null, voids: ReadonlyMap<string, Uint8Array> = new Map(), haze: ReadonlyMap<string, Float32Array> = new Map()): NativeCensus {
  const seamsBefore = seamSummary(m, m.rgb, weight);
  const seamsAfter = seamSummary(m, rec, weight);
  let blocks = 0;
  let amp2 = 0;
  let amp15 = 0;
  let sdB = 0;
  let sdA = 0;
  const worst: number[][] = [];
  let pairs = 0;
  let inversions = 0;
  let dryTex = 0;
  let dryBright = 0;
  let dryBrightMax = 0;
  let dryW05 = 0;
  const invByTile = new Map<string, number>();
  const Ls = new Float32Array(TEX * TEX);
  const Lo = new Float32Array(TEX * TEX);
  const wet = new Uint8Array(TEX * TEX);
  for (const t of m.tiles) {
    const k = tileKey(t.row, t.col);
    const S = m.rgb.get(k);
    const O = rec.get(k);
    const Wk = weight.get(k);
    if (S === undefined || O === undefined || Wk === undefined) continue;
    const vm = voids.get(k);
    const hz = haze.get(k);
    for (let i = 0; i < TEX * TEX; i += 1) {
      Ls[i] = luma(S[i * 3] ?? 0, S[i * 3 + 1] ?? 0, S[i * 3 + 2] ?? 0);
      Lo[i] = luma(O[i * 3] ?? 0, O[i * 3 + 1] ?? 0, O[i * 3 + 2] ?? 0);
    }
    for (let y = 0; y < TEX; y += 1) for (let x = 0; x < TEX; x += 1) wet[y * TEX + x] = isWetTexel(l, t.row, t.col, x, y) ? 1 : 0;
    for (let by = 0; by < TEX; by += 16) {
      for (let bx = 0; bx < TEX; bx += 16) {
        let ok = true;
        let a = 0;
        let a2 = 0;
        let b = 0;
        let b2 = 0;
        for (let y = by; y < by + 16 && ok; y += 1) {
          for (let x = bx; x < bx + 16; x += 1) {
            const i = y * TEX + x;
            if (wet[i] !== 1) {
              ok = false;
              break;
            }
            const ls = Ls[i] ?? 0;
            const lo = Lo[i] ?? 0;
            a += ls;
            a2 += ls ** 2;
            b += lo;
            b2 += lo ** 2;
          }
        }
        if (!ok) continue;
        const s0 = Math.sqrt(Math.max(0, a2 / 256 - (a / 256) ** 2));
        const s1 = Math.sqrt(Math.max(0, b2 / 256 - (b / 256) ** 2));
        blocks += 1;
        sdB += s0;
        sdA += s1;
        if (s1 > 1.5 * s0 + 1) amp15 += 1;
        if (s1 > 2 * s0 + 2) {
          amp2 += 1;
          worst.push([r2(s1 - s0, 2), t.row, t.col, bx, by, r2(s0, 2), r2(s1, 2)]);
        }
      }
    }
    for (let y = 0; y < TEX; y += 1) {
      for (let x = 0; x < TEX; x += 1) {
        const i = y * TEX + x;
        const w = Wk[i] ?? 0;
        if (wet[i] !== 1) {
          if ((vm !== undefined && vm[i] === 1) || (hz !== undefined && (hz[i] ?? 0) > 0)) continue;
          if (w >= 128) dryW05 += 1;
          if (w > 0) {
            dryTex += 1;
            const d = (Lo[i] ?? 0) - (Ls[i] ?? 0);
            if (d > 1.5) {
              dryBright += 1;
              if (d > dryBrightMax) dryBrightMax = d;
            }
          }
          continue;
        }
        if (w < 230) continue;
        for (const j of [x + 4 < TEX ? i + 4 : -1, y + 4 < TEX ? i + 4 * TEX : -1]) {
          if (j < 0 || wet[j] !== 1 || (Wk[j] ?? 0) < 230) continue;
          const ds = (Ls[j] ?? 0) - (Ls[i] ?? 0);
          if (Math.abs(ds) < 8) continue;
          pairs += 1;
          const dd = (Lo[j] ?? 0) - (Lo[i] ?? 0);
          if (Math.sign(dd) === -Math.sign(ds) && Math.abs(dd) >= 4) {
            inversions += 1;
            invByTile.set(k, (invByTile.get(k) ?? 0) + 1);
          }
        }
      }
    }
  }
  worst.sort((x, y) => (y[0] ?? 0) - (x[0] ?? 0));
  return {
    tiles: m.tiles.length,
    seamsBefore,
    seamsAfter,
    texture: { wetBlocks: blocks, amplified: amp2, share: r2(amp2 / Math.max(1, blocks), 6), amplified15: amp15, meanSdBefore: r2(sdB / Math.max(1, blocks)), meanSdAfter: r2(sdA / Math.max(1, blocks)), worst: worst.slice(0, 10) },
    order: {
      pairs,
      inversions,
      share: r2(inversions / Math.max(1, pairs), 6),
      hotTiles: [...invByTile].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10),
    },
    dry: { recolouredHalf: dryW05, touched: dryTex, brightened: dryBright, maxBrighten: r2(dryBrightMax, 2) },
    relief: relief === null ? null : reliefAgreement(m, rec, weight, l, relief, voids),
  };
}

function reliefAgreement(m: MapTexels, rec: ReadonlyMap<string, Uint8Array>, weight: ReadonlyMap<string, Uint8Array>, l: LiquidGrid, R: ReliefClasses, voids: ReadonlyMap<string, Uint8Array>): ReliefAgreement {
  const c = { voidCells: 0, waterCells: 0, waterRecoloured: 0, waterUntouched: 0, landCells: 0, landRecoloured: 0, landPartly: 0, shoreLandCells: 0, shoreRecoloured: 0, shorePartly: 0, shoreBluer8: 0, inlandBluer8: 0, shoreDryCells: 0, shoreDryBluer8: 0, shoreDryBluer4: 0 };
  const bluest: number[][] = [];
  const isW = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < R.w && y < R.h && R.cls[y * R.w + x] === RELIEF_WATER;
  const cellTexels = TEX / 32;
  for (let y = 0; y < R.h; y += 1) {
    for (let x = 0; x < R.w; x += 1) {
      const cls = R.cls[y * R.w + x] ?? RELIEF_NONE;
      if (cls === RELIEF_NONE) continue;
      const tr = R.row0 + Math.floor(y / 32);
      const tc = R.col0 + Math.floor(x / 32);
      const k = tileKey(tr, tc);
      const wv = weight.get(k);
      const S = m.rgb.get(k);
      const O = rec.get(k);
      if (wv === undefined || S === undefined || O === undefined) continue;
      const ox = (x % 32) * cellTexels;
      const oy = (y % 32) * cellTexels;
      const vm = voids.get(k);
      let isVoid = false;
      for (let dy = 0; dy < cellTexels && vm !== undefined && !isVoid; dy += 1) for (let dx = 0; dx < cellTexels; dx += 1) if (vm[(oy + dy) * TEX + ox + dx] === 1) isVoid = true;
      if (isVoid) {
        c.voidCells += 1;
        continue;
      }
      let s = 0;
      let blue = 0;
      let anyWet = false;
      for (let dy = 0; dy < cellTexels; dy += 1) {
        for (let dx = 0; dx < cellTexels; dx += 1) {
          const i = (oy + dy) * TEX + ox + dx;
          if (isWetTexel(l, tr, tc, ox + dx, oy + dy)) anyWet = true;
          s += wv[i] ?? 0;
          blue += (O[i * 3 + 2] ?? 0) - (S[i * 3 + 2] ?? 0) - ((O[i * 3] ?? 0) - (S[i * 3] ?? 0));
        }
      }
      const mw = s / (cellTexels * cellTexels * 255);
      blue /= cellTexels * cellTexels;
      if (cls === RELIEF_WATER) {
        c.waterCells += 1;
        if (mw >= 0.5) c.waterRecoloured += 1;
        else if (mw < 0.1) c.waterUntouched += 1;
      } else if (cls >= RELIEF_LAND) {
        c.landCells += 1;
        if (mw >= 0.5) c.landRecoloured += 1;
        else if (mw >= 0.1) c.landPartly += 1;
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            if (isW(x + dx, y + dy)) {
              near = true;
              break;
            }
          }
        }
        if (near && !anyWet) {
          c.shoreDryCells += 1;
          if (blue >= 8) {
            c.shoreDryBluer8 += 1;
            bluest.push([r2(blue, 2), x, y]);
          }
          if (blue >= 4) c.shoreDryBluer4 += 1;
        }
        if (near) {
          c.shoreLandCells += 1;
          if (mw >= 0.5) c.shoreRecoloured += 1;
          else if (mw >= 0.1) c.shorePartly += 1;
          if (blue >= 8) c.shoreBluer8 += 1;
        } else if (blue >= 8) c.inlandBluer8 += 1;
      }
    }
  }
  bluest.sort((a, b) => (b[0] ?? 0) - (a[0] ?? 0));
  return { ...c, bluestDryShore: bluest.slice(0, 10) };
}

// ---------------------------------------------------------------------------------------------
// The independent seam measure (MM-03), on the built pyramid

/** A level of the built pyramid: the raw RGB of a stored tile, or undefined (a sea key: the navy). */
export type LevelTiles = (x: number, y: number) => Uint8Array | undefined;

/** The map a wet level pixel belongs to at atlas (E, S), or −1 when it is not over water. */
export type WetMask = (e: number, s: number) => number;

export interface SeamMap {
  readonly mapId: number;
  readonly eOff: number;
  readonly sOff: number;
  readonly tiles: readonly { readonly row: number; readonly col: number }[];
}

export interface SeamLineSummary {
  readonly lines: number;
  readonly over2: number;
  readonly over4: number;
  readonly over8: number;
  readonly max: number;
}

export interface SeamRecord {
  readonly mapId: number;
  readonly a: string;
  readonly b: string;
  readonly kind: 'edge' | 'control';
  readonly rows: number;
  readonly seam: number;
  readonly e: number;
  readonly s: number;
}

export interface SeamLevelCensus {
  readonly perMap: Readonly<Record<string, { readonly edges: SeamLineSummary; readonly edgesLong: SeamLineSummary; readonly controls: SeamLineSummary; readonly controlsLong: SeamLineSummary }>>;
  readonly worstEdges: readonly SeamRecord[];
  readonly worstControls: readonly SeamRecord[];
}

/** The wet mask of the liquid grids: the pixel's map by `owner`, wet when its quad is. */
export function liquidWetMask(maps: readonly SeamMap[], grids: ReadonlyMap<number, LiquidGrid>, owner: (e: number, s: number) => number): WetMask {
  return (E, S) => {
    const id = owner(E, S);
    const p = maps.find((m) => m.mapId === id);
    const l = grids.get(id);
    if (p === undefined || l === undefined) return -1;
    const u = Math.floor((E - p.eOff + ORIGIN_YD) / TEXEL_YD);
    const v = Math.floor((S - p.sOff + ORIGIN_YD) / TEXEL_YD);
    const qx = Math.floor(u / 4) - l.col0 * QUADS;
    const qy = Math.floor(v / 4) - l.row0 * QUADS;
    if (qx < 0 || qy < 0 || qx >= l.quadCols || qy >= l.quadRows) return -1;
    return l.water[qy * l.quadCols + qx] === WATER_WET ? id : -1;
  };
}

/** The wet mask of the committed reliefs (maps with committed terrain): water where the pixel's 16.7-yd cell is water. */
export function reliefWetMask(maps: readonly SeamMap[], reliefs: ReadonlyMap<number, ReliefClasses>, owner: (e: number, s: number) => number): WetMask {
  return (E, S) => {
    const id = owner(E, S);
    const p = maps.find((m) => m.mapId === id);
    const R = reliefs.get(id);
    if (p === undefined || R === undefined) return -1;
    const u = Math.floor((E - p.eOff + ORIGIN_YD) / TEXEL_YD);
    const v = Math.floor((S - p.sOff + ORIGIN_YD) / TEXEL_YD);
    const rx = Math.floor(u / 16) - R.col0 * 32;
    const ry = Math.floor(v / 16) - R.row0 * 32;
    if (rx < 0 || ry < 0 || rx >= R.w || ry >= R.h) return -1;
    return R.cls[ry * R.w + rx] === RELIEF_WATER ? id : -1;
  };
}

/**
 * The seam of every ADT edge between two present tiles of each map at level `z`: per pixel row
 * along the edge whose four bands (A2 A1 | B1 B2) all lie over wet pixels of that map, the step
 * B1 − A1 less the local gradient; the edge's seam is the median over its wet rows, averaged over
 * R, G and B. Controls: the same statistic on the lines through the middle of each tile (§19.5).
 */
export function independentSeams(z: number, tiles: LevelTiles, maps: readonly SeamMap[], wetAt: WetMask, navy: Rgb = NAVY): SeamLevelCensus {
  const BAND = SEAM_MEASURE.band;
  const f = 2 ** z;
  const T = 256;
  let cacheKey = '';
  let cacheTile: Uint8Array | undefined;
  const px = (X: number, Y: number, c: number): number => {
    const tx = Math.floor(X / T);
    const ty = Math.floor(Y / T);
    const key = `${String(tx)},${String(ty)}`;
    if (key !== cacheKey) {
      cacheKey = key;
      cacheTile = tiles(tx, ty);
    }
    if (cacheTile === undefined) return navy[c] ?? 0;
    return cacheTile[((Y - ty * T) * T + (X - tx * T)) * 3 + c] ?? 0;
  };
  const recs: SeamRecord[] = [];
  const median = (v: number[]): number => {
    const w = [...v].sort((x, y) => x - y);
    const n = w.length;
    return n % 2 === 1 ? (w[(n - 1) / 2] ?? 0) : ((w[n / 2 - 1] ?? 0) + (w[n / 2] ?? 0)) / 2;
  };
  const stat = (id: number, vertical: boolean, line: number, a0: number, len: number): { n: number; seam: number; mid: number } | null => {
    const lp = line * f;
    const fl = Math.floor(lp);
    const frac = lp - fl > 1e-9;
    const A1s = fl - BAND;
    const B1s = frac ? fl + 1 : fl;
    const j0 = Math.ceil(a0 * f);
    const j1 = Math.floor((a0 + len) * f) - 1;
    const ex: number[][] = [[], [], []];
    let se = 0;
    for (let j = j0; j <= j1; j += 1) {
      let ok = true;
      for (let o = -2 * BAND; o < 2 * BAND && ok; o += 1) {
        const q = o < 0 ? A1s + BAND + o : B1s + o;
        const X = vertical ? q : j;
        const Y = vertical ? j : q;
        if (X < 0 || Y < 0) {
          ok = false;
          break;
        }
        if (wetAt((X + 0.5) / f, (Y + 0.5) / f) !== id) ok = false;
      }
      if (!ok) continue;
      for (let ch = 0; ch < 3; ch += 1) {
        const band = (start: number): number => {
          let t = 0;
          for (let o = 0; o < BAND; o += 1) {
            const q = start + o;
            t += vertical ? px(q, j, ch) : px(j, q, ch);
          }
          return t / BAND;
        };
        const A2 = band(A1s - BAND);
        const A1 = band(A1s);
        const B1 = band(B1s);
        const B2 = band(B1s + BAND);
        ex[ch]?.push(B1 - A1 - (A1 - A2 + (B2 - B1)) / 2);
      }
      se += j;
    }
    const n = ex[0]?.length ?? 0;
    if (n < SEAM_MEASURE.minRows) return null;
    return { n, seam: (Math.abs(median(ex[0] ?? [])) + Math.abs(median(ex[1] ?? [])) + Math.abs(median(ex[2] ?? []))) / 3, mid: se / n / f };
  };
  for (const m of maps) {
    const present = new Set(m.tiles.map((t) => tileKey(t.row, t.col)));
    for (const t of m.tiles) {
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
      ] as const) {
        const k2 = tileKey(t.row + dr, t.col + dc);
        if (!present.has(k2)) continue;
        const vertical = dc === 1;
        const line = vertical ? m.eOff - ORIGIN_YD + (t.col + 1) * ADT_YD : m.sOff - ORIGIN_YD + (t.row + 1) * ADT_YD;
        const a0 = vertical ? m.sOff - ORIGIN_YD + t.row * ADT_YD : m.eOff - ORIGIN_YD + t.col * ADT_YD;
        for (const [kind, ln] of [
          ['edge', line],
          ['control', line - ADT_YD / 2],
          ['control', line + ADT_YD / 2],
        ] as const) {
          const st = stat(m.mapId, vertical, ln, a0, ADT_YD);
          if (st === null) continue;
          recs.push({ mapId: m.mapId, a: tileKey(t.row, t.col), b: k2, kind, rows: st.n, seam: r2(st.seam, 2), e: Math.round(vertical ? ln : st.mid), s: Math.round(vertical ? st.mid : ln) });
        }
      }
    }
  }
  recs.sort((x, y) => y.seam - x.seam);
  const perMap: Record<string, { edges: SeamLineSummary; edgesLong: SeamLineSummary; controls: SeamLineSummary; controlsLong: SeamLineSummary }> = {};
  for (const m of maps) {
    const sum = (kind: string, minRows: number): SeamLineSummary => {
      const E = recs.filter((e) => e.mapId === m.mapId && e.kind === kind && e.rows >= minRows);
      const over = (t: number): number => E.filter((e) => e.seam > t).length;
      return { lines: E.length, over2: over(2), over4: over(4), over8: over(8), max: E[0]?.seam ?? 0 };
    };
    perMap[String(m.mapId)] = { edges: sum('edge', SEAM_MEASURE.minRows), edgesLong: sum('edge', SEAM_MEASURE.longRows), controls: sum('control', SEAM_MEASURE.minRows), controlsLong: sum('control', SEAM_MEASURE.longRows) };
  }
  return { perMap, worstEdges: recs.filter((e) => e.kind === 'edge').slice(0, 10), worstControls: recs.filter((e) => e.kind === 'control').slice(0, 5) };
}

// ---------------------------------------------------------------------------------------------
// Contrast (§19.3, O17) and sea keys over land (M9)

const linear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export const relativeLuminance = (r: number, g: number, b: number): number => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

export interface Contrast {
  readonly level: number;
  /** Part I's method: land is every pixel farther than 48 (RGB, Euclidean) from the sea. */
  readonly partI: { readonly landMedianLuminance: number; readonly ratio: number };
  /** Revision 3's O17 method: farther than 24 by the sum of absolute differences (recorded alongside). */
  readonly o17: { readonly landMedianLuminance: number; readonly ratio: number };
}

/** Median land relative luminance against the sea's, as a ratio, over the given tiles' pixels. */
export function contrastOf(level: number, tiles: readonly Uint8Array[], sea: Rgb = NAVY): Contrast {
  const seaL = relativeLuminance(sea[0], sea[1], sea[2]);
  const land = (method: 'partI' | 'o17'): number => {
    const L: number[] = [];
    for (const t of tiles) {
      for (let p = 0; p < t.length; p += 3) {
        const r = t[p] ?? 0;
        const g = t[p + 1] ?? 0;
        const b = t[p + 2] ?? 0;
        const d = method === 'partI' ? Math.hypot(r - sea[0], g - sea[1], b - sea[2]) : Math.abs(r - sea[0]) + Math.abs(g - sea[1]) + Math.abs(b - sea[2]);
        if (d > (method === 'partI' ? 48 : 24)) L.push(relativeLuminance(r, g, b));
      }
    }
    L.sort((a, b) => a - b);
    return L[Math.floor(L.length / 2)] ?? 0;
  };
  const a = land('partI');
  const b = land('o17');
  return {
    level,
    partI: { landMedianLuminance: r2(a, 4), ratio: r2((a + 0.05) / (seaL + 0.05), 2) },
    o17: { landMedianLuminance: r2(b, 4), ratio: r2((b + 0.05) / (seaL + 0.05), 2) },
  };
}

/**
 * M9: sea keys covering a committed relief land cell (the cell's centre), per map and level. A
 * misplacement or a mask error would put land under a sea key.
 */
export function landUnderSea(
  reliefs: ReadonlyMap<number, ReliefClasses>,
  maps: readonly SeamMap[],
  owner: (e: number, s: number) => number,
  sea: ReadonlyMap<number, { readonly nx: number; readonly keys: ReadonlySet<number> }>,
  exempt: ReadonlyMap<number, ReadonlySet<number>> = new Map(),
): Record<string, number> {
  const out: Record<string, number> = {};
  const cell = ADT_YD / 32;
  for (const [mapId, R] of reliefs) {
    const p = maps.find((m) => m.mapId === mapId);
    if (p === undefined) continue;
    for (const [z, L] of sea) {
      const T = 256 * 2 ** -z;
      let n = 0;
      for (let i = 0; i < R.h; i += 1) {
        for (let j = 0; j < R.w; j += 1) {
          if ((R.cls[i * R.w + j] ?? 0) < RELIEF_LAND || exempt.get(mapId)?.has(i * R.w + j) === true) continue;
          const X = ORIGIN_YD - R.row0 * ADT_YD - (i + 0.5) * cell;
          const Y = ORIGIN_YD - R.col0 * ADT_YD - (j + 0.5) * cell;
          const E = p.eOff - Y;
          const S = p.sOff - X;
          if (E < 0 || S < 0 || owner(E, S) !== mapId) continue;
          if (L.keys.has(Math.floor(S / T) * L.nx + Math.floor(E / T))) n += 1;
        }
      }
      out[`${String(mapId)}:${String(z)}`] = n;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Relief agreement at the zone band (M8)

/**
 * Whether a pixel lies on the navy ramp: blue is its largest channel, its hue is within the ramp's
 * 212.6°–216° widened by `slack` degrees, and its luma lies between the navy's and the shallow end's
 * (± 1). `slack` absorbs the rounding of dark colours' hue.
 */
export function onNavyRamp(r: number, g: number, b: number, slack = 3): boolean {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx === mn || b !== mx) return false;
  const hue = 240 + (60 * (r - g)) / (mx - mn);
  const L = luma(r, g, b);
  return hue >= 212.6 - slack && hue <= 216 + slack && L >= luma(NAVY[0], NAVY[1], NAVY[2]) - 1 && L <= luma(60, 92, 130) + 1;
}

export interface RampAgreement {
  readonly level: number;
  /** Pixels over relief water, land and shore land (land within 2 cells of water), and those on the navy ramp. */
  readonly waterPx: number;
  readonly waterOnRamp: number;
  readonly landPx: number;
  readonly landOnRamp: number;
  readonly shorePx: number;
  readonly shoreOnRamp: number;
}

/** M8's measure on one level of the pyramid, per map with committed terrain. */
export function rampAgreement(z: number, tiles: LevelTiles, nx: number, ny: number, maps: readonly SeamMap[], reliefs: ReadonlyMap<number, ReliefClasses>, owner: (e: number, s: number) => number): Record<string, RampAgreement> {
  const out: Record<string, RampAgreement> = {};
  const p = 2 ** -z;
  const shoreMasks = new Map<number, Uint8Array>();
  for (const [mapId, R] of reliefs) {
    const shore = new Uint8Array(R.w * R.h);
    for (let y = 0; y < R.h; y += 1) {
      for (let x = 0; x < R.w; x += 1) {
        if ((R.cls[y * R.w + x] ?? 0) < RELIEF_LAND) continue;
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy += 1) {
          for (let dx = -2; dx <= 2 && !near; dx += 1) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < R.w && yy < R.h && R.cls[yy * R.w + xx] === RELIEF_WATER) near = true;
          }
        }
        if (near) shore[y * R.w + x] = 1;
      }
    }
    shoreMasks.set(mapId, shore);
    out[String(mapId)] = { level: z, waterPx: 0, waterOnRamp: 0, landPx: 0, landOnRamp: 0, shorePx: 0, shoreOnRamp: 0 };
  }
  for (let ty = 0; ty < ny; ty += 1) {
    for (let tx = 0; tx < nx; tx += 1) {
      const t = tiles(tx, ty);
      for (let j = 0; j < 256; j += 1) {
        for (let i = 0; i < 256; i += 1) {
          const E = (tx * 256 + i + 0.5) * p;
          const S = (ty * 256 + j + 0.5) * p;
          const id = owner(E, S);
          const R = reliefs.get(id);
          const m = maps.find((x) => x.mapId === id);
          const rec = out[String(id)] as { -readonly [K in keyof RampAgreement]: RampAgreement[K] } | undefined;
          if (R === undefined || m === undefined || rec === undefined) continue;
          const u = Math.floor((E - m.eOff + ORIGIN_YD) / TEXEL_YD);
          const v = Math.floor((S - m.sOff + ORIGIN_YD) / TEXEL_YD);
          const rx = Math.floor(u / 16) - R.col0 * 32;
          const ry = Math.floor(v / 16) - R.row0 * 32;
          if (rx < 0 || ry < 0 || rx >= R.w || ry >= R.h) continue;
          const cls = R.cls[ry * R.w + rx] ?? 0;
          if (cls === RELIEF_NONE) continue;
          const q = (j * 256 + i) * 3;
          const on = t === undefined ? true : onNavyRamp(t[q] ?? 0, t[q + 1] ?? 0, t[q + 2] ?? 0);
          if (cls === RELIEF_WATER) {
            rec.waterPx += 1;
            if (on) rec.waterOnRamp += 1;
          } else {
            rec.landPx += 1;
            if (on) rec.landOnRamp += 1;
            if (shoreMasks.get(id)?.[ry * R.w + rx] === 1) {
              rec.shorePx += 1;
              if (on) rec.shoreOnRamp += 1;
            }
          }
        }
      }
    }
  }
  return out;
}

/**
 * The relief cells of the edge skirts (§18.6): the strip along each listed side, `depth` texels deep
 * (two 16-texel cells for the 32-texel strip). The rule makes them void, so M9 exempts them.
 */
export function skirtReliefCells(sides: readonly { readonly tile: string; readonly side: 'N' | 'S' | 'W' | 'E' }[], R: ReliefClasses, depth: number = RECOLOUR.skirtDepth): Set<number> {
  const out = new Set<number>();
  const cells = Math.ceil(depth / 16);
  for (const s of sides) {
    const [row, col] = s.tile.split('_').map(Number) as [number, number];
    const y0 = (row - R.row0) * 32;
    const x0 = (col - R.col0) * 32;
    for (let a = 0; a < 32; a += 1) {
      for (let d = 0; d < cells; d += 1) {
        const [x, y] = s.side === 'N' ? [x0 + a, y0 + d] : s.side === 'S' ? [x0 + a, y0 + 31 - d] : s.side === 'W' ? [x0 + d, y0 + a] : [x0 + 31 - d, y0 + a];
        if (x >= 0 && y >= 0 && x < R.w && y < R.h) out.add(y * R.w + x);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Gates

export interface CensusRecord {
  readonly maps: Readonly<Record<string, NativeCensus>>;
  readonly seams: Readonly<Record<string, SeamLevelCensus>>;
  readonly contrast: Contrast;
  readonly landUnderSea: Readonly<Record<string, number>>;
}

/** Every §19.5 gate a census fails, as sentences; empty when it passes. */
export function censusFailures(c: CensusRecord): string[] {
  const out: string[] = [];
  const g = CENSUS_GATES;
  const pct = (v: number): string => `${(100 * v).toFixed(3)} %`;
  for (const [id, m] of Object.entries(c.maps)) {
    if (m.texture.share > g.amplifiedShareMax) out.push(`map ${id}: ${pct(m.texture.share)} of wet blocks amplified, over ${pct(g.amplifiedShareMax)}`);
    if (m.order.share > g.inversionShareMax) out.push(`map ${id}: ${pct(m.order.share)} of water pairs inverted, over ${pct(g.inversionShareMax)}`);
    if (m.dry.brightened > g.dryBrightenedMax) out.push(`map ${id}: ${String(m.dry.brightened)} dry-quad texels brightened by more than 1.5 luma (up to ${String(m.dry.maxBrighten)})`);
    const r = m.relief;
    if (r !== null) {
      const dryShare = r.shoreDryBluer8 / Math.max(1, r.shoreDryCells);
      if (dryShare > g.dryShoreBluerShareMax) out.push(`map ${id}: ${pct(dryShare)} of fully dry shore cells 8+ levels bluer, over ${pct(g.dryShoreBluerShareMax)}`);
      const water = r.waterRecoloured / Math.max(1, r.waterCells);
      if (water < g.waterRecolouredMin) out.push(`map ${id}: ${pct(water)} of relief water cells recoloured, under ${pct(g.waterRecolouredMin)}`);
      const land = r.landRecoloured / Math.max(1, r.landCells);
      if (land > g.landRecolouredMax) out.push(`map ${id}: ${pct(land)} of relief land cells recoloured, over ${pct(g.landRecolouredMax)}`);
    }
  }
  for (const [z, level] of Object.entries(c.seams)) {
    for (const [id, s] of Object.entries(level.perMap)) {
      if (s.edgesLong.over8 > g.longSeamsOver8Max) out.push(`map ${id}, level ${z}: ${String(s.edgesLong.over8)} long ADT edges with a seam over 8 levels, over ${String(g.longSeamsOver8Max)}`);
    }
  }
  if (c.contrast.partI.ratio < g.contrastMin) out.push(`world-band contrast ${String(c.contrast.partI.ratio)}:1 at level ${String(c.contrast.level)}, under ${String(g.contrastMin)}:1 (O17)`);
  for (const [k, n] of Object.entries(c.landUnderSea)) if (n > 0) out.push(`M9: ${String(n)} relief land cells under sea keys (map:level ${k})`);
  return out;
}
