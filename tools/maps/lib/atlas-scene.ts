import type { HideBox, Scene, SceneCard, SceneMap, SceneSource, WholeBox } from './atlas-blend';
import { uvOfWorld } from './atlas-blend';
import { boundaryOf, cellOf, chamfer, CLASS_LAND, CLASS_SEA, classAt, type ReliefGrid, type ZoneArc } from './atlas-mask';
import { ART_H, ART_W, ATLAS_PARAMS as PAR } from './atlas-params';
import type { AtlasBounds, AtlasSourceSpec, InsetSpec } from './atlas-plan';
import { interiorWeight, mipChain, sample, tintOf, type MipChain, type Rgb, type Rgba8 } from './atlas-raster';

/**
 * Prepares the composition scene (docs/research/map-atlas.md §6.2 steps 1-3): the land test and
 * the dropped-land list, the distance from kept land, the area tints and their smooth field, the
 * relief's median grey, the measured sea colour, and the painting records with their label rules.
 * Pure and synchronous: the decoded rasters and the low-pass images come in ready (atlas-build.ts
 * makes them with sharp). The arithmetic is the revision-2 prototype's.
 */

/** One world map's inputs: its placement and relief grid, and the terrain zone arcs. */
export interface MapInput {
  readonly mapId: number;
  readonly eOff: number;
  readonly sOff: number;
  readonly rect: AtlasBounds;
  readonly grid: ReliefGrid;
  readonly arcs: readonly ZoneArc[];
  /** `zones.json` `zones`: the terrain areas with a polygon. */
  readonly zoneIds: readonly number[];
}

/** One painting's decoded rasters. */
export interface SourceInput {
  readonly spec: AtlasSourceSpec;
  readonly full: Rgba8;
  /** Low-pass (σ 64 yd) of `full`, for zones and cities. */
  readonly lowPass: Rgba8 | null;
  /** Explored-overlay union, for zones. */
  readonly overlays: Rgba8 | null;
}

/** A reviewed label rule on a painting (atlas-labels.json, §6.5). */
export interface LabelRuleInput {
  readonly uiMapId: number;
  readonly box: readonly [number, number, number, number];
  readonly rule: 'whole' | 'hide';
  /** `fine`: levels −1 and 0 only (the capital banners); `all`: every level. */
  readonly levels: 'all' | 'fine';
}

export interface SceneInputs {
  readonly seamE: number;
  readonly westMapId: number;
  readonly eastMapId: number;
  readonly extentW: number;
  readonly extentH: number;
  readonly maps: readonly MapInput[];
  /** Every source of the plan, in plan order (continents included). */
  readonly sources: readonly SourceInput[];
  readonly insets: readonly { readonly spec: InsetSpec; readonly full: Rgba8 }[];
  readonly labels: readonly LabelRuleInput[];
  readonly seaCoast: Rgb;
  readonly seaDeep: Rgb;
}

export interface SceneFacts {
  /** Dropped land per map, cells of the relief grid by terrain area (−1: outside every polygon). */
  readonly dropped: ReadonlyMap<number, ReadonlyMap<number, number>>;
  /** The per-channel median of the zone paintings over terrain sea (MEASURED; §6.2 step 1). */
  readonly measuredSeaCoast: Rgb;
  /** The fallback tint per map and area, and where it came from. */
  readonly areaTints: ReadonlyMap<number, ReadonlyMap<number, { readonly rgb: Rgb; readonly from: number }>>;
  readonly inlandWaterCells: ReadonlyMap<number, number>;
}

/** Continent-painting land: R − B above the threshold, dilated (chamfer) by `dilate` source pixels. */
export function continentLand(img: Rgba8, rMinusB: number, dilate: number): Uint8Array {
  const n = img.w * img.h;
  const landPx = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) landPx[i] = (img.d[i * 4] ?? 0) - (img.d[i * 4 + 2] ?? 0) > rMinusB ? 1 : 0;
  const d = chamfer(landPx, img.w, img.h, 1, 64);
  const land = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) land[i] = (d[i] ?? 64) <= dilate ? 1 : 0;
  return land;
}

/**
 * The land test (§6.2 step 2): a relief cell of land or inland water is kept when the continent
 * painting shows land there, or when it lies inside its own area's zone painting's frame interior
 * (> 0.5). Returns the kept cells and the dropped cells counted by area.
 */
export function landTest(
  grid: ReliefGrid,
  continent: { readonly bounds: AtlasBounds; readonly land: Uint8Array } | null,
  owners: ReadonlyMap<number, AtlasBounds>,
): { readonly keep: Uint8Array; readonly dropped: Map<number, number> } {
  const keep = new Uint8Array(grid.w * grid.h);
  const dropped = new Map<number, number>();
  for (let r = 0; r < grid.h; r += 1) {
    for (let c = 0; c < grid.w; c += 1) {
      const i = r * grid.w + c;
      if ((grid.cls[i] ?? 0) < CLASS_LAND) continue;
      const X = grid.r.xMax - (r + 0.5) * grid.s;
      const Y = grid.r.yMax - (c + 0.5) * grid.s;
      let ok = false;
      if (continent !== null) {
        const [cu, cv] = uvOfWorld(continent.bounds, X, Y);
        if (cu >= 0 && cv >= 0 && cu < ART_W && cv < ART_H) ok = continent.land[Math.floor(cv) * ART_W + Math.floor(cu)] === 1;
      }
      if (!ok) {
        const owner = owners.get(grid.area[i] ?? -1);
        if (owner !== undefined) {
          const [u, v] = uvOfWorld(owner, X, Y);
          if (u > 0 && v > 0 && u < ART_W && v < ART_H && interiorWeight(u, v, PAR.framePx[0], PAR.framePx[1], PAR.cornerPx) > 0.5) ok = true;
        }
      }
      if (ok) keep[i] = 1;
      else {
        const a = grid.area[i] ?? -1;
        dropped.set(a, (dropped.get(a) ?? 0) + 1);
      }
    }
  }
  return { keep, dropped };
}

/** Distance from kept cells in yards, capped at the deep-sea distance plus four cells. */
export function keptLandDistance(grid: ReliefGrid, keep: Uint8Array): Float32Array {
  const d = chamfer(keep, grid.w, grid.h, 1, PAR.deepSeaYd[1] / grid.s + 4);
  for (let i = 0; i < d.length; i += 1) d[i] = (d[i] ?? 0) * grid.s;
  return d;
}

/** The mean painted colour of a painting over land cells of `areas` (4-px sampling), or null with 50 samples or fewer. */
export function meanInArea(chain: MipChain, bounds: AtlasBounds, grid: ReliefGrid, areas: ReadonlySet<number>): [number, number, number] | null {
  const sum = [0, 0, 0];
  const px = [0, 0, 0];
  let n = 0;
  for (let v = 20; v < 648; v += 4) {
    for (let u = 20; u < 982; u += 4) {
      const Y = bounds.yMax - (u / ART_W) * (bounds.yMax - bounds.yMin);
      const X = bounds.xMax - (v / ART_H) * (bounds.xMax - bounds.xMin);
      const i = cellOf(grid, X, Y);
      if (i < 0 || grid.cls[i] !== CLASS_LAND || !areas.has(grid.area[i] ?? -1)) continue;
      sample(chain, u, v, 1, px);
      sum[0] = (sum[0] ?? 0) + (px[0] ?? 0);
      sum[1] = (sum[1] ?? 0) + (px[1] ?? 0);
      sum[2] = (sum[2] ?? 0) + (px[2] ?? 0);
      n += 1;
    }
  }
  return n > PAR.tintMinSamples ? [(sum[0] ?? 0) / n, (sum[1] ?? 0) / n, (sum[2] ?? 0) / n] : null;
}

/** Normalised box blur in place: `passes` passes of radius `r`, rows then columns (Float32 storage). */
function boxBlur(a: Float32Array, w: number, h: number, r: number, passes: number): void {
  const n = w * h;
  const tmp = new Float32Array(n);
  for (let pass = 0; pass < passes; pass += 1) {
    for (let y = 0; y < h; y += 1) {
      let s = 0;
      for (let x = -r; x < w + r; x += 1) {
        if (x + r < w && x + r >= 0) s += a[y * w + x + r] ?? 0;
        if (x - r - 1 >= 0 && x - r - 1 < w) s -= a[y * w + x - r - 1] ?? 0;
        if (x >= 0 && x < w) tmp[y * w + x] = s;
      }
    }
    for (let x = 0; x < w; x += 1) {
      let s = 0;
      for (let y = -r; y < h + r; y += 1) {
        if (y + r < h && y + r >= 0) s += tmp[(y + r) * w + x] ?? 0;
        if (y - r - 1 >= 0 && y - r - 1 < h) s -= tmp[(y - r - 1) * w + x] ?? 0;
        if (y >= 0 && y < h) a[y * w + x] = s;
      }
    }
  }
}

/** The tint as a smooth field over land (normalised box blur of the per-cell area tint), so area edges are gradients. */
export function tintField(grid: ReliefGrid, tintOfArea: (area: number) => Rgb | undefined, neutral: Rgb): [Float32Array, Float32Array, Float32Array] {
  const n = grid.w * grid.h;
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)] as const;
  const wt = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    if ((grid.cls[i] ?? 0) < CLASS_LAND) continue;
    const t = tintOfArea(grid.area[i] ?? -1) ?? neutral;
    wt[i] = 1;
    for (let c = 0; c < 3; c += 1) ch[c as 0 | 1 | 2][i] = t[c] ?? 0;
  }
  for (let c = 0; c < 3; c += 1) {
    const a = ch[c as 0 | 1 | 2];
    for (let i = 0; i < n; i += 1) a[i] = (a[i] ?? 0) * (wt[i] ?? 0);
  }
  boxBlur(wt, grid.w, grid.h, PAR.tintBlurRadiusCells, PAR.tintBlurPasses);
  for (let c = 0; c < 3; c += 1) boxBlur(ch[c as 0 | 1 | 2], grid.w, grid.h, PAR.tintBlurRadiusCells, PAR.tintBlurPasses);
  const out = ch.map((a) => {
    const o = new Float32Array(n);
    for (let i = 0; i < n; i += 1) o[i] = (wt[i] ?? 0) > 1e-6 ? (a[i] ?? 0) / (wt[i] ?? 1) : neutral[0];
    return o;
  }) as [Float32Array, Float32Array, Float32Array];
  for (let i = 0; i < n; i += 1) {
    if ((wt[i] ?? 0) <= 1e-6) {
      out[1][i] = neutral[1];
      out[2][i] = neutral[2];
    }
  }
  return out;
}

/** The median relief grey of land (every 7th cell), 0-1. */
export function medianGrey(grid: ReliefGrid): number {
  const g: number[] = [];
  for (let i = 0; i < grid.cls.length; i += 7) if (grid.cls[i] === CLASS_LAND) g.push(grid.grey[i] ?? 0);
  g.sort((a, b) => a - b);
  return (g[Math.floor(g.length / 2)] ?? 128) / 255;
}

/** The per-channel median of the zone paintings over terrain sea (6-px sampling inside a 100-px margin). */
export function measureSeaColour(zones: readonly { readonly spec: AtlasSourceSpec; readonly chain: MipChain }[], gridOf: (mapId: number) => ReliefGrid): Rgb {
  const vals: [number[], number[], number[]] = [[], [], []];
  const px = [0, 0, 0];
  for (const s of zones) {
    const b = s.spec.bounds;
    const grid = gridOf(s.spec.mapId);
    for (let v = 100; v < 568; v += 6) {
      for (let u = 100; u < 902; u += 6) {
        const Y = b.yMax - (u / ART_W) * (b.yMax - b.yMin);
        const X = b.xMax - (v / ART_H) * (b.xMax - b.xMin);
        if (classAt(grid, X, Y) !== CLASS_SEA) continue;
        sample(s.chain, u, v, 1, px);
        for (let c = 0; c < 3; c += 1) vals[c as 0 | 1 | 2].push(Math.round(px[c] ?? 0));
      }
    }
  }
  const med = (a: number[]): number => a.sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
  return [med(vals[0]), med(vals[1]), med(vals[2])];
}

/** Builds the composition scene and the facts the manifest records about it. */
export function buildScene(inputs: SceneInputs): { readonly scene: Scene; readonly facts: SceneFacts } {
  const grids = new Map(inputs.maps.map((m) => [m.mapId, m.grid]));
  const gridOf = (mapId: number): ReliefGrid => {
    const g = grids.get(mapId);
    if (g === undefined) throw new Error(`no relief for world map ${String(mapId)}`);
    return g;
  };
  const chains = new Map<number, MipChain>();
  const sources: SceneSource[] = [];
  const continents = new Map<number, { spec: AtlasSourceSpec; chain: MipChain; land: Uint8Array }>();
  for (const s of inputs.sources) {
    const chain = mipChain(s.full);
    chains.set(s.spec.uiMapId, chain);
    if (s.spec.cls === 'continent') {
      continents.set(s.spec.mapId, { spec: s.spec, chain, land: continentLand(s.full, PAR.continentLandRMinusB, PAR.continentLandDilatePx) });
      continue;
    }
    const map = inputs.maps.find((m) => m.mapId === s.spec.mapId);
    if (map === undefined) throw new Error(`${s.spec.name}: world map ${String(s.spec.mapId)} is not placed`);
    const hides: HideBox[] = inputs.labels.filter((l) => l.uiMapId === s.spec.uiMapId && l.rule === 'hide').map((l) => ({ box: l.box, fine: l.levels === 'fine' }));
    sources.push({
      spec: s.spec,
      chain,
      lp: s.lowPass === null ? null : mipChain(s.lowPass),
      paint: s.spec.cls === 'zone' && s.overlays !== null ? mipChain(s.overlays) : null,
      segs: s.spec.areas === null ? null : boundaryOf(map.arcs, new Set(s.spec.areas)),
      hides,
    });
  }
  const zones = sources.filter((s) => s.spec.cls === 'zone');
  const cities = sources.filter((s) => s.spec.cls === 'city');

  // land test, distances
  const dropped = new Map<number, Map<number, number>>();
  const keeps = new Map<number, { keep: Uint8Array; dLand: Float32Array }>();
  for (const m of inputs.maps) {
    const owners = new Map<number, AtlasBounds>();
    for (const s of zones) if (s.spec.mapId === m.mapId && s.spec.areas !== null) for (const a of s.spec.areas) owners.set(a, s.spec.bounds);
    const cont = continents.get(m.mapId);
    const t = landTest(m.grid, cont === undefined ? null : { bounds: cont.spec.bounds, land: cont.land }, owners);
    dropped.set(m.mapId, t.dropped);
    keeps.set(m.mapId, { keep: t.keep, dLand: keptLandDistance(m.grid, t.keep) });
  }

  const measuredSeaCoast = measureSeaColour(zones, gridOf);

  // area tints: each zone's own mean, then the continent painting's for areas without a zone
  const neutral = tintOf(PAR.neutralTintSource, PAR.tintMaxSaturation, PAR.tintLightness);
  const areaTints = new Map<number, Map<number, { rgb: Rgb; from: number }>>();
  for (const m of inputs.maps) areaTints.set(m.mapId, new Map());
  for (const s of zones) {
    const set = new Set(s.spec.areas ?? []);
    const c = meanInArea(s.chain, s.spec.bounds, gridOf(s.spec.mapId), set);
    if (c !== null) for (const a of s.spec.areas ?? []) areaTints.get(s.spec.mapId)?.set(a, { rgb: tintOf(c, PAR.tintMaxSaturation, PAR.tintLightness), from: s.spec.uiMapId });
  }
  for (const m of inputs.maps) {
    const cont = continents.get(m.mapId);
    const tints = areaTints.get(m.mapId);
    if (cont === undefined || tints === undefined) continue;
    for (const a of m.zoneIds) {
      if (tints.has(a)) continue;
      const c = meanInArea(cont.chain, cont.spec.bounds, m.grid, new Set([a]));
      if (c !== null) tints.set(a, { rgb: tintOf(c, PAR.tintMaxSaturation, PAR.tintLightness), from: cont.spec.uiMapId });
    }
  }

  const maps: SceneMap[] = [...inputs.maps]
    .sort((a, b) => a.mapId - b.mapId)
    .map((m) => {
      const k = keeps.get(m.mapId);
      if (k === undefined) throw new Error(`no land test for map ${String(m.mapId)}`);
      const tints = areaTints.get(m.mapId);
      return {
        mapId: m.mapId,
        eOff: m.eOff,
        sOff: m.sOff,
        rect: m.rect,
        grid: m.grid,
        keep: k.keep,
        dLand: k.dLand,
        tint: tintField(m.grid, (a) => tints?.get(a)?.rgb, neutral),
        gMed: medianGrey(m.grid),
      };
    });

  const whole: WholeBox[] = [];
  for (const l of inputs.labels) {
    if (l.rule !== 'whole') continue;
    const src = sources.find((s) => s.spec.uiMapId === l.uiMapId);
    if (src === undefined) throw new Error(`atlas-labels.json: UiMap ${String(l.uiMapId)} is not a drawn painting`);
    const [x0, y0, x1, y1] = l.box;
    const W = src.spec.E1 - src.spec.E0;
    const H = src.spec.S1 - src.spec.S0;
    const mgn = PAR.wholeMarginPx;
    whole.push({ src, box: l.box, E0: src.spec.E0 + ((x0 - mgn) / ART_W) * W, E1: src.spec.E0 + ((x1 + mgn) / ART_W) * W, S0: src.spec.S0 + ((y0 - mgn) / ART_H) * H, S1: src.spec.S0 + ((y1 + mgn) / ART_H) * H });
  }
  const cards: SceneCard[] = inputs.insets.map((i) => ({ spec: i.spec, chain: mipChain(i.full) }));

  const scene: Scene = {
    seamE: inputs.seamE,
    westMapId: inputs.westMapId,
    eastMapId: inputs.eastMapId,
    extentW: inputs.extentW,
    extentH: inputs.extentH,
    maps,
    zones,
    cities,
    whole,
    cards,
    seaCoast: inputs.seaCoast,
    seaDeep: inputs.seaDeep,
    neutralTint: neutral,
  };
  return {
    scene,
    facts: {
      dropped,
      measuredSeaCoast,
      areaTints,
      inlandWaterCells: new Map(inputs.maps.map((m) => [m.mapId, m.grid.inland])),
    },
  };
}
