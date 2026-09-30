import { ART_H, ART_W } from './atlas-params';
import type { Rgba8 } from './atlas-raster';

/**
 * The lettering detector (docs/research/map-atlas.md §6.5; the revision-2 prototype's
 * `letters-detect.mjs`, with the Dun Morogh pass ATL.6 asks for). It finds label candidates in a zone
 * painting: small capitals, either cream letters with a dark outline or dark letters with a light
 * halo, on the painted (explored-overlay) ground.
 *
 * - Ink pixels of each polarity: light ink `L ≥ light` within 2 px of a dark pixel `L ≤ dark`, or
 *   dark ink `L ≤ darkInk` within 2 px of a light pixel `L ≥ lightHalo`, where the overlay alpha is at
 *   least one half.
 * - A horizontal closing (±4 px, ±1 row) groups ink into components, kept when they look like one or
 *   two lines of letters: height 7-34 px, width at least 26 px, aspect at least 1.8, at least 30 ink
 *   pixels, and a stroke rhythm (ink runs per pixel along the middle rows) of at least 0.13, which
 *   letters have and mountain hatching mostly lacks.
 * - `snow` (ATL.6): Dun Morogh's names are near-white letters with a thin mid-grey outline on
 *   snow (outline luminance about 90-140, snow about 170-200), which the light polarity's `L ≤ 80`
 *   outline test misses (the review's hand-checked sample). A third polarity takes near-white,
 *   unsaturated ink (`L ≥ snow.ink`, chroma ≤ `snow.maxChroma`) within 2 px of an outline
 *   `L ≤ snow.outline`, with the same shape tests.
 * - Overlapping boxes (within 3 px) are merged; the result is ordered by (y, x).
 *
 * Only painted ground is scanned. Names written on a painting's parchment margin (its neighbours'
 * names) also show where the terrain polygon reaches past the painted ground (Dun Morogh's WETLANDS);
 * a dark-on-parchment pass was measured in ATL.6 and not used: in all 43 paintings it found one
 * letter of that name and two runs of sea hatching in Teldrassil, because the names are widely
 * spaced capitals. Such names are found on the contact sheet and listed by hand.
 *
 * Pure and deterministic. The census (atlas-labels.ts) screens these candidates; the contact sheet
 * and the owner's review decide.
 */

export interface DetectorSettings {
  readonly light: number;
  readonly dark: number;
  readonly darkInk: number;
  readonly lightHalo: number;
  readonly runs: number;
  /** The grey-on-snow polarity (null: off). */
  readonly snow: { readonly ink: number; readonly outline: number; readonly maxChroma: number } | null;
}

/** The prototype's settings (LIGHT 175, DARK 80, DARK_D 105, LIGHT_D 195, RUNS 0.13), plus the snow pass. */
export const DETECTOR: DetectorSettings = { light: 175, dark: 80, darkInk: 105, lightHalo: 195, runs: 0.13, snow: { ink: 205, outline: 125, maxChroma: 40 } };

export type Polarity = 'light' | 'dark' | 'snow' | 'mixed';

export interface Candidate {
  /** Source pixels, edges included. */
  readonly box: readonly [number, number, number, number];
  readonly polarity: Polarity;
  readonly inkPixels: number;
  readonly rhythm: number;
}

export function detectLabels(full: Rgba8, overlays: Rgba8, settings: DetectorSettings = DETECTOR): readonly Candidate[] {
  const W = ART_W;
  const H = ART_H;
  if (full.w !== W || full.h !== H || overlays.w !== W || overlays.h !== H) throw new Error(`the detector reads ${String(W)} × ${String(H)} paintings`);
  const L = new Uint8Array(W * H);
  const chroma = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) {
    const r = full.d[i * 4] ?? 0;
    const g = full.d[i * 4 + 1] ?? 0;
    const b = full.d[i * 4 + 2] ?? 0;
    L[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    chroma[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  const painted = (i: number): boolean => (overlays.d[i * 4 + 3] ?? 0) >= 128;
  const found: Candidate[] = [];
  const polarities: Exclude<Polarity, 'mixed'>[] = ['light', 'dark'];
  if (settings.snow !== null) polarities.push('snow');
  for (const pol of polarities) {
    const isInk = (i: number): boolean => {
      const l = L[i] ?? 0;
      if (pol === 'light') return l >= settings.light;
      if (pol === 'dark') return l <= settings.darkInk;
      return settings.snow !== null && l >= settings.snow.ink && (chroma[i] ?? 0) <= settings.snow.maxChroma;
    };
    const isOpposite = (j: number): boolean => {
      const v = L[j] ?? 0;
      if (pol === 'light') return v <= settings.dark;
      if (pol === 'dark') return v >= settings.lightHalo;
      return settings.snow !== null && v <= settings.snow.outline;
    };
    const ink = new Uint8Array(W * H);
    for (let y = 2; y < H - 2; y += 1) {
      for (let x = 2; x < W - 2; x += 1) {
        const i = y * W + x;
        if (!painted(i) || !isInk(i)) continue;
        let opp = false;
        for (let dy = -2; dy <= 2 && !opp; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            if (isOpposite(i + dy * W + dx)) {
              opp = true;
              break;
            }
          }
        }
        if (opp) ink[i] = 1;
      }
    }
    const dil = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y += 1) {
      for (let x = 4; x < W - 4; x += 1) {
        let on = 0;
        for (let dy = -1; dy <= 1 && on === 0; dy += 1) {
          for (let dx = -4; dx <= 4; dx += 1) {
            if (ink[(y + dy) * W + x + dx] === 1) {
              on = 1;
              break;
            }
          }
        }
        dil[y * W + x] = on;
      }
    }
    const seen = new Uint8Array(W * H);
    for (let s = 0; s < W * H; s += 1) {
      if (dil[s] !== 1 || seen[s] === 1) continue;
      const q = [s];
      seen[s] = 1;
      let x0 = W;
      let y0 = H;
      let x1 = 0;
      let y1 = 0;
      let n = 0;
      for (let k = 0; k < q.length; k += 1) {
        const i = q[k] ?? 0;
        const x = i % W;
        const y = Math.floor(i / W);
        if (ink[i] === 1) n += 1;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        for (const j of [i - 1, i + 1, i - W, i + W]) {
          if (j >= 0 && j < W * H && dil[j] === 1 && seen[j] === 0) {
            seen[j] = 1;
            q.push(j);
          }
        }
      }
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      if (h < 7 || h > 34 || w < 26 || w / h < 1.8 || n < 30) continue;
      let best = 0;
      for (let y = y0 + Math.floor(h / 3); y <= y1 - Math.floor(h / 3); y += 1) {
        let runs = 0;
        let prev = 0;
        for (let x = x0; x <= x1; x += 1) {
          const v = ink[y * W + x] ?? 0;
          if (v === 1 && prev === 0) runs += 1;
          prev = v;
        }
        best = Math.max(best, runs / w);
      }
      if (best >= settings.runs) found.push({ box: [x0, y0, x1, y1], polarity: pol, inkPixels: n, rhythm: Math.round(best * 1000) / 1000 });
    }
  }
  const merged: { box: [number, number, number, number]; polarity: Polarity; inkPixels: number; rhythm: number }[] = [];
  for (const c of [...found].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])) {
    const m = merged.find((o) => !(c.box[0] > o.box[2] + 3 || c.box[2] < o.box[0] - 3 || c.box[1] > o.box[3] + 3 || c.box[3] < o.box[1] - 3));
    if (m !== undefined) {
      m.box = [Math.min(m.box[0], c.box[0]), Math.min(m.box[1], c.box[1]), Math.max(m.box[2], c.box[2]), Math.max(m.box[3], c.box[3])];
      m.polarity = m.polarity === c.polarity ? m.polarity : 'mixed';
      m.inkPixels += c.inkPixels;
    } else merged.push({ ...c, box: [c.box[0], c.box[1], c.box[2], c.box[3]] });
  }
  return merged;
}
