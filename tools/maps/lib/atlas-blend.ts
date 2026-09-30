import { bilin, cellOf, classAt, CLASS_LAND, polygonRaster, chamfer, signedDistance, type ReliefGrid, type Segment } from './atlas-mask';
import { ART_H, ART_W, ATLAS_PARAMS as PAR } from './atlas-params';
import type { AtlasBounds, AtlasSourceSpec, InsetSpec } from './atlas-plan';
import { boxMask, cardWeight, interiorWeight, sample, smooth, type MipChain, type Rgb } from './atlas-raster';

/**
 * The atlas composite (docs/research/map-atlas.md §6.2 and §6.4): one window of pixels at level
 * `z`, bottom to top: the sea by distance from kept land, the relief-shaded tint on kept land, the
 * zone paintings with the two-band blend restricted to their painted ground, the city filler, then
 * (fine levels) the blend into the nearest stored ancestor, the cities and cards, and the Zephras
 * Isle card. Pure and deterministic: every pixel depends only on its own position and the scene, so
 * the window partition never changes a byte; the arithmetic (and its Float32 storage) is the
 * revision-2 prototype's, operation for operation.
 */

/** One world map of the scene: its placement, relief grid and the prepared fields. */
export interface SceneMap {
  readonly mapId: number;
  readonly eOff: number;
  readonly sOff: number;
  /** The placement's world rectangle (its UiMap 947 row). */
  readonly rect: AtlasBounds;
  readonly grid: ReliefGrid;
  /** 1 on land and inland water the land test keeps (§6.2 step 2). */
  readonly keep: Uint8Array;
  /** Distance from kept land in yards, capped (the sea colour). */
  readonly dLand: Float32Array;
  /** The smooth tint field per relief cell (R, G, B). */
  readonly tint: readonly [Float32Array, Float32Array, Float32Array];
  /** Median relief grey of land, 0-1 (the shading's neutral point). */
  readonly gMed: number;
}

/** A hide rule on one painting (§6.5 rule 2): mirror-filled at every level, or at levels −1 and 0 only. */
export interface HideBox {
  readonly box: readonly [number, number, number, number];
  readonly fine: boolean;
}

export interface SceneSource {
  readonly spec: AtlasSourceSpec;
  readonly chain: MipChain;
  /** The low-pass painting (σ 64 yd) for the colour band; null for continents. */
  readonly lp: MipChain | null;
  /** The explored-overlay union (painted ground); null except for zones. */
  readonly paint: MipChain | null;
  /** The polygon boundary of its areas, or null (a card). */
  readonly segs: readonly Segment[] | null;
  readonly hides: readonly HideBox[];
}

/** A label drawn whole (§6.5 rule 1): its painting and box, and the box's atlas bounds widened by the margin. */
export interface WholeBox {
  readonly src: SceneSource;
  readonly box: readonly [number, number, number, number];
  readonly E0: number;
  readonly E1: number;
  readonly S0: number;
  readonly S1: number;
}

export interface SceneCard {
  readonly spec: InsetSpec;
  readonly chain: MipChain;
}

export interface Scene {
  readonly seamE: number;
  readonly westMapId: number;
  readonly eastMapId: number;
  /** Extent size in atlas units (the extent starts at the origin). */
  readonly extentW: number;
  readonly extentH: number;
  /** Placed world maps, ascending by map id (the sea distance's order). */
  readonly maps: readonly SceneMap[];
  readonly zones: readonly SceneSource[];
  readonly cities: readonly SceneSource[];
  readonly whole: readonly WholeBox[];
  readonly cards: readonly SceneCard[];
  readonly seaCoast: Rgb;
  readonly seaDeep: Rgb;
  readonly neutralTint: Rgb;
}

export function sceneMap(scene: Scene, mapId: number): SceneMap {
  const m = scene.maps.find((x) => x.mapId === mapId);
  if (m === undefined) throw new Error(`world map ${String(mapId)} is not placed in the scene`);
  return m;
}

/** The placed map whose side of the seam an atlas point lies on (the partition without insets, §5.4). */
export function placedMapAt(scene: Scene, E: number): SceneMap {
  return sceneMap(scene, E <= scene.seamE ? scene.westMapId : scene.eastMapId);
}

/** Inside the extent and inside the 947 row rectangle of the map on its side of the seam. */
export function inWorld(scene: Scene, E: number, S: number): boolean {
  if (!(E >= 0 && S >= 0 && E < scene.extentW && S < scene.extentH)) return false;
  const m = placedMapAt(scene, E);
  const X = m.sOff - S;
  const Y = m.eOff - E;
  return X >= m.rect.xMin && X <= m.rect.xMax && Y >= m.rect.yMin && Y <= m.rect.yMax;
}

/** Distance in yards from the nearest kept land of any placed map (bilinear on each relief grid). */
export function seaDistance(scene: Scene, E: number, S: number): number {
  let d = 1e9;
  for (const m of scene.maps) {
    const X = m.sOff - S;
    const Y = m.eOff - E;
    if (cellOf(m.grid, X, Y) < 0) continue;
    d = Math.min(d, bilin(m.grid, X, Y, (k) => (k < 0 ? 1e4 : (m.dLand[k] ?? 1e4))));
  }
  return d;
}

/** The sea colour at a distance from kept land: painted water to the deep colour by smoothstep (§6.2 step 1). */
export function seaColour(scene: Scene, d: number): [number, number, number] {
  const t = smooth(PAR.deepSeaYd[0], PAR.deepSeaYd[1], d);
  const a = scene.seaCoast;
  const b = scene.seaDeep;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Source position (u, v) of an atlas point on a painting. */
export function uvOf(spec: AtlasSourceSpec, E: number, S: number): [number, number] {
  const b = spec.bounds;
  const X = spec.sOff - S;
  const Y = spec.eOff - E;
  return [((b.yMax - Y) / (b.yMax - b.yMin)) * ART_W, ((b.xMax - X) / (b.xMax - b.xMin)) * ART_H];
}

/** Source position of a world point of the painting's own map. */
export function uvOfWorld(bounds: AtlasBounds, X: number, Y: number): [number, number] {
  return [((bounds.yMax - Y) / (bounds.yMax - bounds.yMin)) * ART_W, ((bounds.xMax - X) / (bounds.xMax - bounds.xMin)) * ART_H];
}

/**
 * A hidden label's mirror fill (§6.5 rule 2): the painting's rows above the box reflected downwards
 * and the rows below reflected upwards, blended across the middle; a side is used only when its
 * reflected rows stay inside the painting's interior.
 */
export function mirrorSample(src: SceneSource, u: number, v: number, box: readonly [number, number, number, number], scale: number, px: number[], lpx: number[]): void {
  const y0 = box[1];
  const y1 = box[3];
  const h = y1 - y0;
  const above = y0 - h >= PAR.framePx[1] + 2;
  const below = y1 + h <= ART_H - PAR.framePx[1] - 2;
  const t = (v - y0) / h;
  const wa = above && below ? 1 - smooth(0.35, 0.65, t) : above ? 1 : 0;
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const la = [0, 0, 0];
  const lb = [0, 0, 0];
  const lp = src.lp ?? src.chain;
  if (wa > 0) {
    sample(src.chain, u, 2 * y0 - v, scale, a);
    sample(lp, u, 2 * y0 - v, scale, la);
  }
  if (wa < 1) {
    sample(src.chain, u, 2 * y1 - v, scale, b);
    sample(lp, u, 2 * y1 - v, scale, lb);
  }
  for (let c = 0; c < 3; c += 1) {
    px[c] = (a[c] ?? 0) * wa + (b[c] ?? 0) * (1 - wa);
    lpx[c] = (la[c] ?? 0) * wa + (lb[c] ?? 0) * (1 - wa);
  }
}

/** Coverage census of level −2 (§6.6): per world map and per `map:area`, lattice points by category. */
export interface CoverageCounts {
  land: number;
  own: number;
  neighbour: number;
  tint: number;
  dropped: number;
}
export interface CoverageCensus {
  readonly byMap: Map<number, CoverageCounts>;
  readonly byArea: Map<string, CoverageCounts>;
}
export const emptyCounts = (): CoverageCounts => ({ land: 0, own: 0, neighbour: 0, tint: 0, dropped: 0 });

/** Bilinear colour of the upscaled nearest stored ancestor at a global pixel of the level being composed (§6.4). */
export type AncestorSampler = (i: number, j: number, col: number[]) => void;

export interface Composed {
  /** RGB bytes, `ow × oh`. */
  readonly out: Uint8Array;
  /** The top level of what shows in each pixel (§7.1's sparse rule), −99 for nothing. */
  readonly domT: Int8Array;
}

interface LayerWindow {
  readonly i0: number;
  readonly j0: number;
  readonly w: number;
  readonly h: number;
  readonly sd: Float32Array | null;
  readonly land: Uint8Array | null;
  readonly dland: Float32Array | null;
}

/**
 * Composes pixels `[oi, oi + ow) × [oj, oj + oh)` of level `z`. `census` (level −2 only) counts the
 * lattice points of §6.6; `up` (levels −1 and 0) is the ancestor the recomposed tile blends into.
 */
export function composeWindow(scene: Scene, z: number, oi: number, oj: number, ow: number, oh: number, census: CoverageCensus | null, up: AncestorSampler | null): Composed {
  const p = 2 ** -z;
  const N = ow * oh;
  const out = new Uint8Array(N * 3);
  const domT = new Int8Array(N).fill(-99);
  const aL = new Float32Array(N * 3);
  const sL = new Float32Array(N);
  const aH = new Float32Array(N * 3);
  const sH = new Float32Array(N);
  const mFine = new Float32Array(N);
  const alpha = new Float32Array(N);
  const own = new Float32Array(N);
  const domW = new Float32Array(N);
  const base = new Float32Array(N * 3);
  const landSoft = new Float32Array(N);
  const gradSea = new Uint8Array(N);
  const deep = scene.seaDeep;

  // 1-3: sea, kept land's tint
  for (let j = 0; j < oh; j += 1) {
    for (let i = 0; i < ow; i += 1) {
      const q = j * ow + i;
      const E = (oi + i + 0.5) * p;
      const S = (oj + j + 0.5) * p;
      const sc = seaColour(scene, seaDistance(scene, E, S));
      if (sc[0] !== deep[0] || sc[1] !== deep[1] || sc[2] !== deep[2]) gradSea[q] = 1;
      let col: readonly number[] = sc;
      let ls = 0;
      if (inWorld(scene, E, S)) {
        const m = placedMapAt(scene, E);
        const g = m.grid;
        const X = m.sOff - S;
        const Y = m.eOff - E;
        ls = bilin(g, X, Y, (k) => (k >= 0 && g.cls[k] === CLASS_LAND && m.keep[k] === 1 ? 1 : 0));
        if (ls > 0) {
          const grey = bilin(g, X, Y, (k) => (k >= 0 ? (g.grey[k] ?? 128) : 128)) / 255;
          const tint = [0, 1, 2].map((c) => bilin(g, X, Y, (k) => (k >= 0 ? (m.tint[c as 0 | 1 | 2][k] ?? 0) : (scene.neutralTint[c] ?? 0))));
          const f = Math.min(PAR.reliefClamp[1], Math.max(PAR.reliefClamp[0], 1 + PAR.reliefK * (grey - m.gMed)));
          const tf = [(tint[0] ?? 0) * f, (tint[1] ?? 0) * f, (tint[2] ?? 0) * f];
          col = [0, 1, 2].map((c) => (sc[c] ?? 0) + ((tf[c] ?? 0) - (sc[c] ?? 0)) * ls);
        }
      }
      landSoft[q] = ls;
      for (let c = 0; c < 3; c += 1) base[q * 3 + c] = col[c] ?? 0;
    }
  }

  const FHp = PAR.detailBandYd / p;
  const FLp = PAR.colourBandYd / p;
  const C0p = PAR.coastYd[0] / p;
  const C1p = PAR.coastYd[1] / p;
  const cap = Math.max(FLp, C1p) + 2;
  const cityCap = PAR.cityBandYd / p + 2;
  const px = [0, 0, 0];
  const lpx = [0, 0, 0];
  const pa1 = [0];

  const layer = (s: SceneSource, isCity: boolean): LayerWindow | null => {
    const spec = s.spec;
    const fi0 = Math.floor(spec.E0 / p);
    const fi1 = Math.ceil(spec.E1 / p);
    const fj0 = Math.floor(spec.S0 / p);
    const fj1 = Math.ceil(spec.S1 / p);
    if (fi1 <= oi || fi0 >= oi + ow || fj1 <= oj || fj0 >= oj + oh) return null;
    const mg = Math.ceil(isCity ? cityCap : cap);
    const i0 = Math.max(fi0, oi) - mg;
    const i1 = Math.min(fi1, oi + ow) + mg;
    const j0 = Math.max(fj0, oj) - mg;
    const j1 = Math.min(fj1, oj + oh) + mg;
    const w = i1 - i0;
    const h = j1 - j0;
    let sd: Float32Array | null = null;
    if (s.segs !== null) sd = signedDistance(polygonRaster(s.segs, spec.eOff, spec.sOff, p, i0, j0, w, h), w, h, isCity ? cityCap : cap);
    let land: Uint8Array | null = null;
    let dland: Float32Array | null = null;
    if (!isCity) {
      const g = sceneMap(scene, spec.mapId).grid;
      land = new Uint8Array(w * h);
      for (let j = 0; j < h; j += 1) {
        for (let i = 0; i < w; i += 1) land[j * w + i] = classAt(g, spec.sOff - (j0 + j + 0.5) * p, spec.eOff - (i0 + i + 0.5) * p) >= CLASS_LAND ? 1 : 0;
      }
      dland = chamfer(land, w, h, 1, C1p + 2);
    }
    return { i0, j0, w, h, sd, land, dland };
  };

  // 4: zone paintings
  const hidesAtLevel = z >= -1;
  for (const s of scene.zones) {
    const L = layer(s, false);
    if (L === null || L.land === null || L.dland === null) continue;
    const spec = s.spec;
    const scale = p / spec.ydpx;
    for (let j = Math.max(oj, L.j0); j < Math.min(oj + oh, L.j0 + L.h); j += 1) {
      for (let i = Math.max(oi, L.i0); i < Math.min(oi + ow, L.i0 + L.w); i += 1) {
        const k = (j - L.j0) * L.w + (i - L.i0);
        const E = (i + 0.5) * p;
        const S = (j + 0.5) * p;
        const [u, v] = uvOf(spec, E, S);
        if (u <= 0 || v <= 0 || u >= ART_W || v >= ART_H) continue;
        let lmOwn = 0;
        let lmOther = 0;
        for (const f of scene.whole) {
          if (E < f.E0 || E > f.E1 || S < f.S0 || S > f.S1) continue;
          if (f.src === s) lmOwn = Math.max(lmOwn, boxMask(u, v, f.box, PAR.wholeFeatherPx));
          else {
            const [fu, fv] = uvOf(f.src.spec, E, S);
            lmOther = Math.max(lmOther, boxMask(fu, fv, f.box, PAR.wholeFeatherPx));
          }
        }
        const inner = interiorWeight(u, v, PAR.framePx[0], PAR.framePx[1], PAR.cornerPx);
        if (inner <= 0 && lmOwn <= 0) continue;
        const sea = L.land[k] === 1 ? 1 : 1 - smooth(C0p, C1p, L.dland[k] ?? 0);
        const c = Math.max(sea * inner, lmOwn * interiorWeight(u, v, PAR.labelFramePx[0], PAR.labelFramePx[1], PAR.labelCornerPx));
        if (c <= 0) continue;
        const sd = L.sd === null ? -cap : (L.sd[k] ?? 0);
        const oH = Math.max(lmOwn, FHp < 0.75 ? (sd > 0 ? 1 : 0) : smooth(-FHp, FHp, sd));
        const oL = smooth(-FLp, FLp, sd);
        let pa = 1;
        if (s.paint !== null) {
          sample(s.paint, u, v, scale, pa1, 3, 1);
          pa = smooth(PAR.paintedAlpha[0], PAR.paintedAlpha[1], (pa1[0] ?? 0) / 255);
        }
        const wh = c * Math.max(PAR.fallbackWeight * pa, oH) * (1 - lmOther);
        const wl = c * Math.max(PAR.fallbackWeight * pa, oL);
        const cov = c * Math.max(oH, pa);
        if (cov <= 0 && wl <= 0) continue;
        sample(s.chain, u, v, scale, px);
        sample(s.lp ?? s.chain, u, v, scale, lpx);
        for (const lb of s.hides) {
          if (lb.fine && !hidesAtLevel) continue;
          const F = PAR.hideFeatherPx;
          const [x0, y0, x1, y1] = lb.box;
          const bm = boxMask(u, v, [x0 + F, y0 + F, x1 - F, y1 - F], F);
          if (bm <= 0) continue;
          const mp = [0, 0, 0];
          const ml = [0, 0, 0];
          mirrorSample(s, u, v, lb.box, scale, mp, ml);
          for (let ch = 0; ch < 3; ch += 1) {
            px[ch] = (px[ch] ?? 0) + ((mp[ch] ?? 0) - (px[ch] ?? 0)) * bm;
            lpx[ch] = (lpx[ch] ?? 0) + ((ml[ch] ?? 0) - (lpx[ch] ?? 0)) * bm;
          }
        }
        const q = (j - oj) * ow + (i - oi);
        if (cov > (alpha[q] ?? 0)) alpha[q] = cov;
        own[q] = (own[q] ?? 0) + c * oH;
        sL[q] = (sL[q] ?? 0) + wl;
        sH[q] = (sH[q] ?? 0) + wh;
        for (let ch = 0; ch < 3; ch += 1) {
          aL[q * 3 + ch] = (aL[q * 3 + ch] ?? 0) + (lpx[ch] ?? 0) * wl;
          aH[q * 3 + ch] = (aH[q * 3 + ch] ?? 0) + ((px[ch] ?? 0) - (lpx[ch] ?? 0)) * wh;
        }
        if (wh > (domW[q] ?? 0)) {
          domW[q] = wh;
          domT[q] = spec.t;
        }
        if (spec.t >= z) {
          const mf = c * smooth(0, FLp, sd);
          if (mf > (mFine[q] ?? 0)) mFine[q] = mf;
        }
      }
    }
  }

  // 5: city filler on land, at level −2 and coarser
  if (z <= -2) {
    for (const s of scene.cities) {
      if (s.segs === null) continue;
      const L = layer(s, true);
      if (L === null || L.sd === null) continue;
      const spec = s.spec;
      const scale = p / spec.ydpx;
      const m = sceneMap(scene, spec.mapId);
      for (let j = Math.max(oj, L.j0); j < Math.min(oj + oh, L.j0 + L.h); j += 1) {
        for (let i = Math.max(oi, L.i0); i < Math.min(oi + ow, L.i0 + L.w); i += 1) {
          const k = (j - L.j0) * L.w + (i - L.i0);
          const [u, v] = uvOf(spec, (i + 0.5) * p, (j + 0.5) * p);
          if (u <= 0 || v <= 0 || u >= ART_W || v >= ART_H) continue;
          let c = interiorWeight(u, v, PAR.framePx[0], PAR.framePx[1], PAR.cornerPx) * smooth(-PAR.cityBandYd / p, PAR.cityBandYd / p, L.sd[k] ?? 0);
          if (c <= 0) continue;
          const E = (i + 0.5) * p;
          const S = (j + 0.5) * p;
          c *= bilin(m.grid, m.sOff - S, m.eOff - E, (kk) => (kk >= 0 && (m.grid.cls[kk] ?? 0) >= CLASS_LAND ? 1 : 0));
          if (c <= 0.001) continue;
          const w = c * 10 * PAR.fallbackWeight;
          sample(s.chain, u, v, scale, px);
          sample(s.lp ?? s.chain, u, v, scale, lpx);
          const q = (j - oj) * ow + (i - oi);
          if (c > (alpha[q] ?? 0)) alpha[q] = c;
          sL[q] = (sL[q] ?? 0) + w;
          sH[q] = (sH[q] ?? 0) + w;
          for (let ch = 0; ch < 3; ch += 1) {
            aL[q * 3 + ch] = (aL[q * 3 + ch] ?? 0) + (lpx[ch] ?? 0) * w;
            aH[q * 3 + ch] = (aH[q * 3 + ch] ?? 0) + ((px[ch] ?? 0) - (lpx[ch] ?? 0)) * w;
          }
          if (w > (domW[q] ?? 0)) {
            domW[q] = w;
            domT[q] = Math.min(spec.t, -2);
          }
        }
      }
    }
  }

  // 6: out = Z·α + backdrop·(1 − α); the sparse rule's top levels
  for (let q = 0; q < N; q += 1) {
    const aq = alpha[q] ?? 0;
    const a = aq > 1 ? 1 : aq;
    const sl = sL[q] ?? 0;
    const sh = sH[q] ?? 0;
    for (let ch = 0; ch < 3; ch += 1) {
      const b = base[q * 3 + ch] ?? 0;
      let zc = b;
      if (a > 0 && sl > 0) zc = Math.max(0, Math.min(255, (aL[q * 3 + ch] ?? 0) / sl + (sh > 0 ? (aH[q * 3 + ch] ?? 0) / sh : 0)));
      out[q * 3 + ch] = Math.round(zc * a + b * (1 - a));
    }
    if (a <= PAR.presenceAlpha) domT[q] = -99;
    if ((1 - a) * (landSoft[q] ?? 0) > PAR.presenceAlpha && (domT[q] ?? -99) < PAR.tintTopLevel) domT[q] = PAR.tintTopLevel;
    if (gradSea[q] === 1 && (domT[q] ?? -99) < PAR.seaGradientTopLevel) domT[q] = PAR.seaGradientTopLevel;
  }

  // fine levels: outside the fine sources the tile equals the upscaled nearest stored ancestor
  if (up !== null) {
    if (z === -1) {
      for (const s of scene.zones) {
        for (const lb of s.hides) {
          if (!lb.fine) continue;
          for (let j = 0; j < oh; j += 1) {
            for (let i = 0; i < ow; i += 1) {
              const [u, v] = uvOf(s.spec, (oi + i + 0.5) * p, (oj + j + 0.5) * p);
              const bm = boxMask(u, v, lb.box, PAR.hideFeatherPx * 3);
              if (bm > 0) {
                const q = j * ow + i;
                if (bm > (mFine[q] ?? 0)) mFine[q] = bm;
                if (bm > PAR.presenceAlpha) domT[q] = Math.max(domT[q] ?? -99, z);
              }
            }
          }
        }
      }
    }
    const col = [0, 0, 0];
    for (let j = 0; j < oh; j += 1) {
      for (let i = 0; i < ow; i += 1) {
        const q = j * ow + i;
        const m = mFine[q] ?? 0;
        if (m >= 1) continue;
        up(oi + i, oj + j, col);
        for (let ch = 0; ch < 3; ch += 1) out[q * 3 + ch] = Math.round((col[ch] ?? 0) + ((out[q * 3 + ch] ?? 0) - (col[ch] ?? 0)) * m);
      }
    }
  }

  // cities and cards at levels −1 and 0
  if (z >= -1) {
    for (const s of scene.cities) {
      if (s.spec.t < z) continue;
      const L = layer(s, true);
      if (L === null) continue;
      const spec = s.spec;
      const scale = p / spec.ydpx;
      for (let j = Math.max(oj, L.j0); j < Math.min(oj + oh, L.j0 + L.h); j += 1) {
        for (let i = Math.max(oi, L.i0); i < Math.min(oi + ow, L.i0 + L.w); i += 1) {
          const k = (j - L.j0) * L.w + (i - L.i0);
          const [u, v] = uvOf(spec, (i + 0.5) * p, (j + 0.5) * p);
          if (u <= 0 || v <= 0 || u >= ART_W || v >= ART_H) continue;
          const cc =
            L.sd !== null
              ? interiorWeight(u, v, PAR.framePx[0], PAR.framePx[1], PAR.cornerPx) * smooth(-PAR.cityBandYd / p, PAR.cityBandYd / p, L.sd[k] ?? 0)
              : cardWeight(u, v, PAR.cardTornPx, PAR.cardRampPx, PAR.cardCornerPx);
          if (cc <= 0) continue;
          sample(s.chain, u, v, scale, px);
          const q = (j - oj) * ow + (i - oi);
          for (let ch = 0; ch < 3; ch += 1) out[q * 3 + ch] = Math.round((out[q * 3 + ch] ?? 0) + ((px[ch] ?? 0) - (out[q * 3 + ch] ?? 0)) * cc);
          if (cc > PAR.presenceAlpha && (domT[q] ?? -99) < spec.t) domT[q] = spec.t;
        }
      }
    }
  }

  // 7: the inset cards (the whole painting with its own frame; not a position)
  for (const card of scene.cards) {
    const sp = card.spec;
    const si0 = Math.floor(sp.e0 / p);
    const si1 = Math.ceil((sp.e0 + sp.w) / p);
    const sj0 = Math.floor(sp.s0 / p);
    const sj1 = Math.ceil((sp.s0 + sp.h) / p);
    for (let j = Math.max(oj, sj0); j < Math.min(oj + oh, sj1); j += 1) {
      for (let i = Math.max(oi, si0); i < Math.min(oi + ow, si1); i += 1) {
        const u = (((i + 0.5) * p - sp.e0) / sp.w) * ART_W;
        const v = (((j + 0.5) * p - sp.s0) / sp.h) * ART_H;
        if (u < 0 || v < 0 || u > ART_W || v > ART_H) continue;
        sample(card.chain, u, v, p / sp.ydpx, px);
        const q = (j - oj) * ow + (i - oi);
        for (let ch = 0; ch < 3; ch += 1) out[q * 3 + ch] = Math.round(px[ch] ?? 0);
        if ((domT[q] ?? -99) < sp.top) domT[q] = sp.top;
      }
    }
  }

  // §6.6 coverage census on a 16-yd lattice of level −2
  if (census !== null) {
    for (let j = 0; j < oh; j += 1) {
      for (let i = 0; i < ow; i += 1) {
        if ((oi + i) % 4 !== 0 || (oj + j) % 4 !== 0) continue;
        const E = (oi + i + 0.5) * p;
        const S = (oj + j + 0.5) * p;
        if (!inWorld(scene, E, S)) continue;
        const m = placedMapAt(scene, E);
        const k = cellOf(m.grid, m.sOff - S, m.eOff - E);
        if (k < 0 || m.grid.cls[k] !== CLASS_LAND) continue;
        const q = j * ow + i;
        const kept = m.keep[k] === 1;
        const cat: keyof CoverageCounts = (own[q] ?? 0) >= 0.5 ? 'own' : (alpha[q] ?? 0) >= 0.5 ? 'neighbour' : kept ? 'tint' : 'dropped';
        const key = `${String(m.mapId)}:${String(m.grid.area[k] ?? -1)}`;
        let cm = census.byMap.get(m.mapId);
        if (cm === undefined) census.byMap.set(m.mapId, (cm = emptyCounts()));
        cm.land += 1;
        cm[cat] += 1;
        let ca = census.byArea.get(key);
        if (ca === undefined) census.byArea.set(key, (ca = emptyCounts()));
        ca.land += 1;
        ca[cat] += 1;
      }
    }
  }
  return { out, domT };
}
