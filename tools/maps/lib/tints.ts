import type { RingPoint } from '../../../src/geo/zone-rings';
import { ciede2000, fromHex, hslToRgb, rgbToHsl, toHex, type Rgb } from './tint-colour';

/**
 * The fallback zone tint (docs/research/map-presentation.md §12.4; step MP.10), computed from the
 * committed painted art (D-033) and the committed terrain zone arcs (D-032): no client data, no new
 * decision. Pure and deterministic; `tools/maps/tints.ts` decodes the files and writes the result.
 *
 * - **Colour**: each zone's mean painted colour inside its terrain rings (pixels with alpha above
 *   200, even-odd, pixel centres), from its own zone image, else its continent's painting.
 * - **Bounded as picture**: HSL saturation capped at 0.29 and lightness kept between 0.38 and 0.72,
 *   so no tint reads as a signal (every chromatic reserved colour has a saturation of 0.498 or more).
 * - **Neighbours pushed apart**: where two zones sharing at least 300 yd of border differ by less
 *   than 10 (CIEDE2000), the less constrained one (a city first) moves: lightness by 0.05, hue by 6°
 *   within 12° of its art hue, or saturation down by 0.06, keeping the move that most raises its
 *   smallest difference, for up to 40 rounds.
 * - **Checks**: no tint above 0.30 saturation, none within 15 (CIEDE2000) of a chromatic reserved
 *   colour (the difficulty colours but grey, the provenance cyans); the neighbour differences are
 *   recorded.
 */

export const TINT_PARAMS = {
  alphaMin: 200,
  maxSaturation: 0.29,
  lightness: [0.38, 0.72] as const,
  threshold: 10,
  minSharedYards: 300,
  rounds: 40,
  lightnessStep: 0.05,
  hueStep: 6,
  hueReach: 12,
  saturationStep: 0.06,
  minSaturation: 0.05,
  /** The generated tints' own limits (the §12.4 test). */
  checkMaxSaturation: 0.3,
  checkMinReserved: 15,
} as const;

/** The chromatic reserved colours (UI.md §4: the difficulty colours but trivial grey, and both provenance cyans). */
export const RESERVED_COLOURS: Readonly<Record<string, string>> = {
  standard: '#40bf40',
  difficult: '#ffff00',
  verydifficult: '#ff8040',
  impossible: '#ff1a1a',
  foreverLight: '#006d7d',
  foreverDark: '#3ccfe0',
};

export interface TintImage {
  readonly uiMapId: number;
  readonly width: number;
  readonly height: number;
  /** RGBA, row by row. */
  readonly rgba: Uint8Array;
  /** The image's world rectangle (x north, y west). */
  readonly bounds: { readonly mapId: number; readonly xMin: number; readonly xMax: number; readonly yMin: number; readonly yMax: number };
}

export interface TintZone {
  readonly mapId: number;
  readonly areaId: number;
  /** The zone's UiMap (its own image), or null for an area no UiMap frames. */
  readonly uiMapId: number | null;
  readonly name: string;
  readonly city: boolean;
  readonly rings: readonly (readonly RingPoint[])[];
}

/** The mean colour of an image's opaque pixels whose centres lie inside the rings (even-odd), or null with too few. */
export function meanInRings(image: TintImage, rings: readonly (readonly RingPoint[])[]): { readonly rgb: Rgb; readonly samples: number } | null {
  const { width, height, bounds, rgba } = image;
  const spanY = bounds.yMax - bounds.yMin;
  const spanX = bounds.xMax - bounds.xMin;
  if (!(spanY > 0) || !(spanX > 0)) return null;
  // The rings in image pixels: east is decreasing world y, south decreasing world x.
  const edges: (readonly [number, number, number, number])[] = [];
  for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[i + 1];
      if (a === undefined || b === undefined) continue;
      edges.push([((bounds.yMax - a.y) / spanY) * width, ((bounds.xMax - a.x) / spanX) * height, ((bounds.yMax - b.y) / spanY) * width, ((bounds.xMax - b.x) / spanX) * height]);
    }
  }
  let r = 0;
  let g = 0;
  let bl = 0;
  let n = 0;
  const crossings: number[] = [];
  for (let py = 0; py < height; py += 1) {
    const cy = py + 0.5;
    crossings.length = 0;
    for (const [ax, ay, bx, by] of edges) if (ay > cy !== by > cy) crossings.push(ax + ((cy - ay) * (bx - ax)) / (by - ay));
    crossings.sort((p, q) => p - q);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil((crossings[k] ?? 0) - 0.5));
      const to = Math.min(width - 1, Math.floor((crossings[k + 1] ?? 0) - 0.5));
      for (let px = from; px <= to; px += 1) {
        const at = (py * width + px) * 4;
        if ((rgba[at + 3] ?? 0) <= TINT_PARAMS.alphaMin) continue;
        r += rgba[at] ?? 0;
        g += rgba[at + 1] ?? 0;
        bl += rgba[at + 2] ?? 0;
        n += 1;
      }
    }
  }
  return n === 0 ? null : { rgb: [r / n, g / n, bl / n], samples: n };
}

/** The shared border lengths between areas (both sides above 0), yards, keyed `a:b` with a < b. */
export function sharedBorders(lines: readonly (readonly RingPoint[])[], sides: readonly (readonly [number, number])[]): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  lines.forEach((line, index) => {
    const [a, b] = sides[index] ?? [0, 0];
    if (a <= 0 || b <= 0 || a === b) return;
    let length = 0;
    for (let i = 0; i + 1 < line.length; i += 1) {
      const p = line[i];
      const q = line[i + 1];
      if (p !== undefined && q !== undefined) length += Math.hypot(q.x - p.x, q.y - p.y);
    }
    const key = a < b ? `${String(a)}:${String(b)}` : `${String(b)}:${String(a)}`;
    out.set(key, (out.get(key) ?? 0) + length);
  });
  return out;
}

export interface PairStats {
  readonly pairs: number;
  readonly min: number;
  readonly p10: number;
  readonly median: number;
  /** Pairs below the threshold, "A / B 9.1", in ascending difference. */
  readonly below: readonly string[];
}

export interface DerivedTint {
  readonly zone: TintZone;
  /** The UiMap whose painting gave the colour (the zone's own, or its continent's). */
  readonly from: number;
  readonly samples: number;
  readonly art: Rgb;
  readonly tint: Rgb;
}

export interface TintResult {
  readonly tints: readonly DerivedTint[];
  readonly before: PairStats;
  readonly after: PairStats;
  readonly maxSaturation: number;
  readonly nearestReserved: { readonly distance: number; readonly zone: string; readonly reserved: string };
  /** Zones with no painted pixel in any image: no tint (never guessed). */
  readonly unsampled: readonly string[];
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;
const round1 = (value: number): number => Math.round(value * 10) / 10;

function pairStats(tints: ReadonlyMap<number, { readonly zone: TintZone; tint: Rgb }>, pairs: readonly (readonly [number, number])[]): PairStats {
  const values: { readonly d: number; readonly text: string }[] = [];
  for (const [a, b] of pairs) {
    const one = tints.get(a);
    const two = tints.get(b);
    if (one === undefined || two === undefined) continue;
    const d = ciede2000(one.tint, two.tint);
    values.push({ d, text: `${one.zone.name} / ${two.zone.name} ${round1(d).toFixed(1)}` });
  }
  const sorted = [...values].sort((p, q) => p.d - q.d || (p.text < q.text ? -1 : 1));
  const at = (p: number): number => round1(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]?.d ?? 0);
  return {
    pairs: sorted.length,
    min: round1(sorted[0]?.d ?? 0),
    p10: at(0.1),
    median: at(0.5),
    below: sorted.filter((entry) => entry.d < TINT_PARAMS.threshold).map((entry) => entry.text),
  };
}

/**
 * The tints of `zones` from their paintings (`imageOf`: the zone's own image, else its continent's),
 * bounded, then pushed apart where neighbours (`borders`) are too close.
 */
export function deriveTints(
  zones: readonly TintZone[],
  imageOf: (zone: TintZone) => readonly TintImage[],
  borders: ReadonlyMap<string, number>,
): TintResult {
  const [lMin, lMax] = TINT_PARAMS.lightness;
  const entries = new Map<number, { readonly zone: TintZone; readonly from: number; readonly samples: number; readonly art: Rgb; hsl: [number, number, number]; readonly baseHue: number; tint: Rgb }>();
  const unsampled: string[] = [];
  for (const zone of zones) {
    let sampled: { readonly from: number; readonly rgb: Rgb; readonly samples: number } | null = null;
    for (const image of imageOf(zone)) {
      const mean = meanInRings(image, zone.rings);
      if (mean !== null) {
        sampled = { from: image.uiMapId, rgb: mean.rgb, samples: mean.samples };
        break;
      }
    }
    if (sampled === null) {
      unsampled.push(zone.name);
      continue;
    }
    const art: Rgb = [Math.round(sampled.rgb[0]), Math.round(sampled.rgb[1]), Math.round(sampled.rgb[2])];
    const [h, s, l] = rgbToHsl(art);
    const hsl: [number, number, number] = [h, Math.min(s, TINT_PARAMS.maxSaturation), Math.max(lMin, Math.min(lMax, l))];
    entries.set(zone.areaId, { zone, from: sampled.from, samples: sampled.samples, art, hsl, baseHue: h, tint: hslToRgb(hsl) });
  }
  const pairs = [...borders]
    .filter(([, yards]) => yards >= TINT_PARAMS.minSharedYards)
    .map(([key]) => key.split(':').map(Number) as unknown as readonly [number, number])
    .filter(([a, b]) => entries.has(a) && entries.has(b))
    .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const before = pairStats(entries, pairs);
  const worst = (area: number): number => {
    const own = entries.get(area);
    if (own === undefined) return Infinity;
    let min = Infinity;
    for (const [a, b] of pairs) {
      if (a !== area && b !== area) continue;
      const other = entries.get(a === area ? b : a);
      if (other !== undefined) min = Math.min(min, ciede2000(own.tint, other.tint));
    }
    return min;
  };
  for (let round = 0; round < TINT_PARAMS.rounds; round += 1) {
    let changed = 0;
    for (const [a, b] of pairs) {
      const one = entries.get(a);
      const two = entries.get(b);
      if (one === undefined || two === undefined || ciede2000(one.tint, two.tint) >= TINT_PARAMS.threshold) continue;
      const mover = one.zone.city ? one : two.zone.city ? two : worst(a) > worst(b) ? one : two;
      const area = mover.zone.areaId;
      const [h, s, l] = mover.hsl;
      const candidates: [number, number, number][] = [];
      for (const dl of [-TINT_PARAMS.lightnessStep, TINT_PARAMS.lightnessStep]) candidates.push([h, s, Math.max(lMin, Math.min(lMax, l + dl))]);
      for (const dh of [-TINT_PARAMS.hueStep, TINT_PARAMS.hueStep]) {
        const next = h + dh;
        const reach = Math.abs(((next - mover.baseHue + 540) % 360) - 180);
        if (reach <= TINT_PARAMS.hueReach) candidates.push([(next + 360) % 360, s, l]);
      }
      candidates.push([h, Math.max(TINT_PARAMS.minSaturation, s - TINT_PARAMS.saturationStep), l]);
      const keep = mover.hsl;
      const keepTint = mover.tint;
      let best: [number, number, number] | null = null;
      let bestValue = worst(area);
      for (const candidate of candidates) {
        mover.hsl = candidate;
        mover.tint = hslToRgb(candidate);
        const value = worst(area);
        if (value > bestValue + 0.1) {
          bestValue = value;
          best = candidate;
        }
      }
      mover.hsl = best ?? keep;
      mover.tint = best === null ? keepTint : hslToRgb(best);
      if (best !== null) changed += 1;
    }
    if (changed === 0) break;
  }
  const after = pairStats(entries, pairs);
  let maxSaturation = 0;
  let nearest = { distance: Infinity, zone: '', reserved: '' };
  for (const entry of entries.values()) {
    maxSaturation = Math.max(maxSaturation, rgbToHsl(entry.tint)[1]);
    for (const [key, hex] of Object.entries(RESERVED_COLOURS)) {
      const d = ciede2000(entry.tint, fromHex(hex));
      if (d < nearest.distance) nearest = { distance: d, zone: entry.zone.name, reserved: key };
    }
  }
  return {
    tints: [...entries.values()]
      .sort((p, q) => p.zone.mapId - q.zone.mapId || p.zone.areaId - q.zone.areaId)
      .map((entry) => ({ zone: entry.zone, from: entry.from, samples: entry.samples, art: entry.art, tint: entry.tint })),
    before,
    after,
    maxSaturation: round3(maxSaturation),
    nearestReserved: { ...nearest, distance: round1(nearest.distance) },
    unsampled,
  };
}

export { toHex };
