import sharp from 'sharp';
import { atlasHash, atlasLayoutProblems, atlasPlacements, type AtlasPlacement } from '../../../src/geo/atlas';
import type { AtlasLayout } from '../../../src/geo/atlas-layout';
import type { MapGeometry } from '../../../src/geo/types';
import { gzipSize } from '../../build/lib/audit';
import type { ArtSourceEntry } from './art-manifest';
import { composeWindow, emptyCounts, inWorld, placedMapAt, seaDistance, type CoverageCensus, type Scene } from './atlas-blend';
import { detectLabels, DETECTOR, type Candidate } from './atlas-detect';
import { ATLAS_INDEX_FILE, ATLAS_TILE_TEMPLATE, levelBitmaps, type AtlasIndex } from './atlas-index';
import { letteringCensus, type AtlasLabelList, type CensusPainting, type LetteringCensus } from './atlas-labels';
import { buildAtlasManifest, parseAtlasManifest, type AtlasFileEntry, type AtlasLevelSummary, type AtlasSourceRecord } from './atlas-manifest';
import { boundaryOf, cellOf, CLASS_LAND, reliefGrid, type ReliefGrid, type ZoneArc } from './atlas-mask';
import { atlasNoticeText } from './atlas-notice';
import { ART_H, ART_W, ATLAS_PARAMS, BASE_LEVEL, CONTRAST_MIN, MAX_LEVEL, MIN_LEVEL, SEA_COAST, SEA_DEEP, SEA_DEEP_LIGHTNESS, TILE } from './atlas-params';
import { baseGrid, gridAt, planAtlas, type AtlasPlan, type AtlasSourceSpec, type PlanAssignment, type PlanUiMap } from './atlas-plan';
import { ancestorSampler, classifyTile, extractTile, nearestAncestor, reductions, tilesOfRect, tileTopLevel, type Rgb8 } from './atlas-pyramid';
import { luminance, type Rgba8 } from './atlas-raster';
import { buildScene, type SceneFacts } from './atlas-scene';
import type { EncoderIdentity, WebpSettings } from './encode';
import { sha256Hex } from './hash';
import { formatJson } from './json';
import type { Rgba } from './raster';
import type { ToolTrees } from './tool-tree';

/**
 * The whole atlas build in memory (docs/research/map-atlas.md §6, §7; D-042): check the inputs,
 * prepare the scene, compose level −2, reduce, choose the sparse set, recompose the fine levels,
 * encode, and write the index, manifest and NOTICE texts with the censuses. `atlas.ts` feeds it from
 * the client and the committed files; tests feed it synthetic inputs. It never touches the file
 * system.
 */

export interface AtlasRasterInput {
  readonly full: Rgba;
  readonly overlays: Rgba | null;
  /** The `sources` record `composeSourceRasters` made for these rasters. */
  readonly record: ArtSourceEntry;
}

export interface TerrainMapInput {
  readonly mapId: number;
  readonly reliefPath: string;
  readonly reliefPng: Uint8Array;
  readonly reliefSha256: string;
  readonly zonesPath: string;
  readonly zonesBytes: Uint8Array;
  readonly zonesSha256: string;
  readonly rect: { readonly xMin: number; readonly xMax: number; readonly yMin: number; readonly yMax: number };
  readonly pixelYd: number;
}

export interface AtlasBuildInputs {
  readonly layout: AtlasLayout;
  /** The committed geometry (the 947 rows and the inset's row). */
  readonly geometry: MapGeometry;
  readonly uiMaps: readonly PlanUiMap[];
  readonly assignments: readonly PlanAssignment[];
  readonly artSize: ReadonlyMap<number, { readonly width: number; readonly height: number }>;
  readonly rasters: ReadonlyMap<number, AtlasRasterInput>;
  /** The committed art manifest's `sources` records (check T5 at build time). */
  readonly artSources: readonly ArtSourceEntry[];
  readonly terrain: readonly TerrainMapInput[];
  readonly labels: AtlasLabelList;
  readonly labelsFile: { readonly path: string; readonly sha256: string };
}

export interface AtlasBuildOptions {
  readonly client: { readonly product: string; readonly version: string; readonly buildKey: string };
  readonly toolTrees: ToolTrees;
  readonly encoder: EncoderIdentity;
  readonly webp: WebpSettings;
  readonly encodeJobs: number;
  readonly log?: (line: string) => void;
}

export interface AtlasTile {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly path: string;
  readonly bytes: Buffer;
  readonly gzipBytes: number;
}

export interface AtlasBuild {
  readonly tiles: readonly AtlasTile[];
  readonly indexText: string;
  readonly manifestText: string;
  readonly noticeText: string;
  readonly placements: readonly AtlasPlacement[];
  readonly atlasHash: string;
  readonly plan: AtlasPlan;
  readonly lettering: LetteringCensus;
  /** Measurements for the report and the contact sheet. */
  readonly report: Readonly<Record<string, unknown>>;
}

const toRgba8 = (r: Rgba): Rgba8 => ({ w: r.width, h: r.height, d: r.data });
const round = (v: number, places: number): number => Math.round(v * 10 ** places) / 10 ** places;

async function decodePng(bytes: Uint8Array): Promise<{ w: number; h: number; d: Uint8Array }> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, d: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

/** The painting blurred by a Gaussian of `sigmaPx` (sharp, as the prototype did). */
async function lowPass(img: Rgba, sigmaPx: number): Promise<Rgba8> {
  const { data, info } = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: 4 } })
    .blur(sigmaPx)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, d: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

async function pool<T, R>(items: readonly T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, n) }, async () => {
      for (;;) {
        const i = next;
        next += 1;
        if (i >= items.length) return;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

/** WebP of one RGB tile with the art's settings (encode.ts), one libvips thread, no cache. */
export async function encodeTile(rgb: Uint8Array, webp: WebpSettings): Promise<Buffer> {
  sharp.concurrency(1);
  sharp.cache(false);
  return sharp(Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength), { raw: { width: TILE, height: TILE, channels: 3 } })
    .webp({ quality: webp.quality, alphaQuality: webp.alphaQuality, effort: webp.effort, smartSubsample: webp.smartSubsample, preset: webp.preset, lossless: false })
    .toBuffer();
}

/** City-block distance to terrain land (relief class 2) in yards: the lettering census's coastal band. */
function landDistanceField(g: ReliefGrid): Float32Array {
  const { w, h } = g;
  const d = new Float32Array(w * h).fill(1e9);
  for (let i = 0; i < w * h; i += 1) if (g.cls[i] === CLASS_LAND) d[i] = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (x > 0) d[i] = Math.min(d[i] ?? 0, (d[i - 1] ?? 0) + 1);
      if (y > 0) d[i] = Math.min(d[i] ?? 0, (d[i - w] ?? 0) + 1);
    }
  }
  for (let y = h - 1; y >= 0; y -= 1) {
    for (let x = w - 1; x >= 0; x -= 1) {
      const i = y * w + x;
      if (x < w - 1) d[i] = Math.min(d[i] ?? 0, (d[i + 1] ?? 0) + 1);
      if (y < h - 1) d[i] = Math.min(d[i] ?? 0, (d[i + w] ?? 0) + 1);
    }
  }
  return d;
}

/**
 * The lettering census of §6.5 over every zone painting: the detector's candidates, tested against
 * the level −2 rules and the city plans at levels −1 and 0, with the reviewed list's rules.
 */
export function runLetteringCensus(
  sources: readonly { readonly spec: AtlasSourceSpec; readonly full: Rgba8; readonly overlays: Rgba8 | null }[],
  grids: ReadonlyMap<number, ReliefGrid>,
  zoneArcs: ReadonlyMap<number, readonly ZoneArc[]>,
  labels: AtlasLabelList,
): LetteringCensus {
  const candidates = new Map<number, readonly Candidate[]>();
  for (const s of sources) if (s.spec.cls === 'zone' && s.overlays !== null) candidates.set(s.spec.uiMapId, detectLabels(s.full, s.overlays, DETECTOR));
  const paintings: CensusPainting[] = sources
    .filter((s) => s.spec.cls === 'zone' || s.spec.cls === 'city')
    .map((s) => {
      const arcs = zoneArcs.get(s.spec.mapId) ?? [];
      const alpha = s.overlays === null ? null : new Uint8Array(ART_W * ART_H).map((_, i) => s.overlays?.d[i * 4 + 3] ?? 0);
      return {
        uiMapId: s.spec.uiMapId,
        name: s.spec.name,
        cls: s.spec.cls === 'city' ? 'city' : 'zone',
        mapId: s.spec.mapId,
        bounds: s.spec.bounds,
        segs: s.spec.areas === null ? [] : boundaryOf(arcs, new Set(s.spec.areas)),
        overlayAlpha: s.spec.cls === 'zone' ? alpha : null,
        card: s.spec.areas === null,
      };
    });
  paintings.sort((a, b) => a.uiMapId - b.uiMapId);
  const landFields = new Map([...grids].map(([m, g]) => [m, landDistanceField(g)]));
  return letteringCensus(candidates, paintings, labels.labels, (mapId, X, Y) => {
    const g = grids.get(mapId);
    const f = landFields.get(mapId);
    if (g === undefined || f === undefined) return 1e9;
    const k = cellOf(g, X, Y);
    return k < 0 ? 1e9 : (f[k] ?? 1e9) * g.s;
  });
}

function checkInputs(inputs: AtlasBuildInputs, plan: AtlasPlan): void {
  const problems: string[] = [];
  const committed = new Map(inputs.artSources.map((s) => [s.uiMapId, s]));
  const needed = [...plan.sources.map((s) => s.uiMapId), ...plan.insets.map((i) => i.uiMapId)];
  for (const id of needed) {
    const raster = inputs.rasters.get(id);
    const record = committed.get(id);
    if (raster === undefined) problems.push(`UiMap ${String(id)}: no raster`);
    else if (record === undefined) problems.push(`UiMap ${String(id)}: the art manifest has no sources record; run convert.ts`);
    else if (record.pixelsSha256 !== raster.record.pixelsSha256 || record.overlaysSha256 !== raster.record.overlaysSha256 || record.inputHash !== raster.record.inputHash) {
      problems.push(`UiMap ${String(id)}: the client's raster differs from the art manifest's sources record (T5); run convert.ts first`);
    }
  }
  const zones = new Set(plan.sources.filter((s) => s.cls === 'zone').map((s) => s.uiMapId));
  for (const [i, e] of inputs.labels.labels.entries()) {
    if (!zones.has(e.uiMapId)) problems.push(`atlas-labels.json labels[${String(i)}]: UiMap ${String(e.uiMapId)} is not a drawn zone painting`);
    const raster = inputs.rasters.get(e.uiMapId);
    if (raster !== undefined && raster.record.pixelsSha256 !== e.pixelsSha256) {
      problems.push(`atlas-labels.json labels[${String(i)}] (${e.label}): the painting's pixels changed; review the entry on the contact sheet and record the new pixelsSha256 (T9)`);
    }
  }
  if (problems.length > 0) throw new Error(`the atlas inputs are not the reviewed ones:\n  ${problems.join('\n  ')}`);
}

export async function buildAtlas(inputs: AtlasBuildInputs, options: AtlasBuildOptions): Promise<AtlasBuild> {
  const log = options.log ?? ((): void => undefined);
  const timings: Record<string, number> = {};
  let t0 = performance.now();
  const lap = (key: string): void => {
    timings[key] = Math.round(performance.now() - t0);
    t0 = performance.now();
  };
  const { layout } = inputs;
  const placements = atlasPlacements(inputs.geometry, layout);
  if (placements === null) throw new Error(`the ${layout.name} layout cannot be placed: ${atlasLayoutProblems(inputs.geometry, layout).join('; ')}`);
  const hash = atlasHash(placements, layout);
  const terrainZones = new Map<number, readonly number[]>();
  const zoneArcs = new Map<number, readonly ZoneArc[]>();
  for (const t of inputs.terrain) {
    if (sha256Hex(t.reliefPng) !== t.reliefSha256) throw new Error(`${t.reliefPath}: SHA-256 differs from the terrain manifest`);
    if (sha256Hex(t.zonesBytes) !== t.zonesSha256) throw new Error(`${t.zonesPath}: SHA-256 differs from the terrain manifest`);
    const zones = JSON.parse(Buffer.from(t.zonesBytes).toString('utf8')) as { zones: number[]; arcs: number[][] };
    terrainZones.set(t.mapId, zones.zones);
    zoneArcs.set(t.mapId, zones.arcs);
  }
  const plan = planAtlas({ uiMaps: inputs.uiMaps, assignments: inputs.assignments, artSize: inputs.artSize, terrainZones, placements, roundUp: ATLAS_PARAMS.roundUp });
  checkInputs(inputs, plan);
  lap('checks');

  // ---- scene
  const grids = new Map<number, ReliefGrid>();
  for (const t of inputs.terrain) {
    const img = await decodePng(t.reliefPng);
    grids.set(t.mapId, reliefGrid(t.mapId, img.d, img.w, img.h, t.pixelYd, t.rect, zoneArcs.get(t.mapId) ?? []));
  }
  const rasterOf = (id: number): AtlasRasterInput => {
    const r = inputs.rasters.get(id);
    if (r === undefined) throw new Error(`UiMap ${String(id)}: no raster`);
    return r;
  };
  const sourceInputs = await Promise.all(
    plan.sources.map(async (spec) => {
      const r = rasterOf(spec.uiMapId);
      return {
        spec,
        full: toRgba8(r.full),
        lowPass: spec.cls === 'continent' ? null : await lowPass(r.full, ATLAS_PARAMS.lowPassSigmaYd / spec.ydpx),
        overlays: r.overlays === null ? null : toRgba8(r.overlays),
      };
    }),
  );
  const mapPlacements = placements.filter((p) => p.kind === 'placed');
  const side = (s: 'west' | 'east'): number => Number(layout.placed.find((p) => p.side === s)?.mapId ?? -1);
  const { scene, facts } = buildScene({
    seamE: layout.seamE,
    westMapId: side('west'),
    eastMapId: side('east'),
    extentW: layout.extent.eMax - layout.extent.eMin,
    extentH: layout.extent.sMax - layout.extent.sMin,
    maps: mapPlacements.map((p) => {
      const grid = grids.get(Number(p.mapId));
      if (grid === undefined) throw new Error(`no terrain relief for world map ${String(p.mapId)}`);
      return { mapId: Number(p.mapId), eOff: p.eOff, sOff: p.sOff, rect: p.rect, grid, arcs: zoneArcs.get(Number(p.mapId)) ?? [], zoneIds: terrainZones.get(Number(p.mapId)) ?? [] };
    }),
    sources: sourceInputs,
    insets: plan.insets.map((spec) => ({ spec, full: toRgba8(rasterOf(spec.uiMapId).full) })),
    labels: inputs.labels.labels,
    seaCoast: SEA_COAST,
    seaDeep: SEA_DEEP,
  });
  lap('scene');
  log(`scene: ${String(scene.zones.length)} zones, ${String(scene.cities.length)} cities, ${String(scene.cards.length)} card(s), measured coastal water rgb(${facts.measuredSeaCoast.join(', ')})`);

  // ---- level −2
  const { tw, th } = baseGrid(layout);
  const CW = tw * TILE;
  const CH = th * TILE;
  const canvas = new Uint8Array(CW * CH * 3);
  for (let i = 0; i < CW * CH; i += 1) {
    canvas[i * 3] = SEA_DEEP[0];
    canvas[i * 3 + 1] = SEA_DEEP[1];
    canvas[i * 3 + 2] = SEA_DEEP[2];
  }
  const tileMax = new Int8Array(tw * th).fill(-99);
  const census: CoverageCensus = { byMap: new Map(), byArea: new Map() };
  const cand = candidateTiles(scene, plan, tw, th);
  let windows = 0;
  for (let ty = 0; ty < th; ty += 1) {
    for (let tx0 = 0; tx0 < tw; tx0 += 4) {
      const nx = Math.min(4, tw - tx0);
      let any = false;
      for (let k = 0; k < nx; k += 1) if (cand[ty * tw + tx0 + k] === 1) any = true;
      if (!any) continue;
      const { out, domT } = composeWindow(scene, BASE_LEVEL, tx0 * TILE, ty * TILE, nx * TILE, TILE, census, null);
      windows += 1;
      for (let j = 0; j < TILE; j += 1) canvas.set(out.subarray(j * nx * TILE * 3, (j + 1) * nx * TILE * 3), ((ty * TILE + j) * CW + tx0 * TILE) * 3);
      for (let q = 0; q < domT.length; q += 1) {
        const tq = ty * tw + tx0 + Math.floor((q % (nx * TILE)) / TILE);
        if ((tileMax[tq] ?? -99) < (domT[q] ?? -99)) tileMax[tq] = domT[q] ?? -99;
      }
    }
    log(`level −2: row ${String(ty + 1)}/${String(th)}`);
  }
  lap('composeBase');

  // ---- coarser levels and the sparse rule
  const levels = reductions({ w: CW, h: CH, d: canvas });
  lap('reduce');
  const stored: { z: number; x: number; y: number; d: Uint8Array }[] = [];
  const seaKeys = new Map<number, [number, number][]>();
  const levelStats = new Map<number, { grid: string; stored: number; virtual: number; sea: number }>();
  for (let z = MIN_LEVEL; z <= BASE_LEVEL; z += 1) {
    const L = levels.get(z) as Rgb8;
    const nx = Math.ceil(L.w / TILE);
    const ny = Math.ceil(L.h / TILE);
    const stat = { grid: `${String(nx)}x${String(ny)}`, stored: 0, virtual: 0, sea: 0 };
    const sea: [number, number][] = [];
    for (let ty = 0; ty < ny; ty += 1) {
      for (let tx = 0; tx < nx; tx += 1) {
        const d = extractTile(L, tx, ty, SEA_DEEP);
        const kind = classifyTile(d, SEA_DEEP, tileTopLevel(tileMax, tw, th, z, tx, ty), z);
        if (kind === 'sea') {
          stat.sea += 1;
          sea.push([tx, ty]);
        } else if (kind === 'virtual') stat.virtual += 1;
        else {
          stat.stored += 1;
          stored.push({ z, x: tx, y: ty, d });
        }
      }
    }
    seaKeys.set(z, sea);
    levelStats.set(z, stat);
  }
  const storedSet = new Set(stored.map((t) => `${String(t.z)},${String(t.x)},${String(t.y)}`));

  // ---- fine levels
  const fine = new Map<number, Map<string, Uint8Array>>([
    [-1, new Map()],
    [0, new Map()],
  ]);
  const fineAncestors = new Map<number, Map<string, number>>([
    [-1, new Map()],
    [0, new Map()],
  ]);
  const zones = plan.sources.filter((s) => s.cls === 'zone');
  const cities = plan.sources.filter((s) => s.cls === 'city');
  for (const z of [-1, 0]) {
    const tiles = new Set<string>();
    for (const s of [...zones, ...cities]) if (s.t >= z) tilesOfRect(z, s.E0, s.E1, s.S0, s.S1, tiles);
    if (z === -1) {
      for (const l of inputs.labels.labels) {
        if (l.rule !== 'hide' || l.levels !== 'fine') continue;
        const s = zones.find((x) => x.uiMapId === l.uiMapId);
        if (s === undefined) continue;
        const [x0, y0, x1, y1] = l.box;
        const W = s.E1 - s.E0;
        const H = s.S1 - s.S0;
        const m = ATLAS_PARAMS.bannerTileMarginYd;
        tilesOfRect(z, s.E0 + (x0 / ART_W) * W - m, s.E0 + (x1 / ART_W) * W + m, s.S0 + (y0 / ART_H) * H - m, s.S0 + (y1 / ART_H) * H + m, tiles);
      }
    }
    const fineMinus1 = fine.get(-1) as Map<string, Uint8Array>;
    const into = fine.get(z) as Map<string, Uint8Array>;
    const ancestors = fineAncestors.get(z) as Map<string, number>;
    for (const key of [...tiles].sort()) {
      const [tx, ty] = key.split(',').map(Number) as [number, number];
      const anc = nearestAncestor(z, tx, ty, fineMinus1, (a, x, y) => storedSet.has(`${String(a)},${String(x)},${String(y)}`), levels);
      if (anc !== null) ancestors.set(key, anc.z);
      const up = anc === null ? null : ancestorSampler(anc, z, tx, ty, SEA_DEEP);
      const { out, domT } = composeWindow(scene, z, tx * TILE, ty * TILE, TILE, TILE, null, up);
      let mx = -99;
      for (const t of domT) if (t > mx) mx = t;
      if (mx >= z) into.set(key, out);
    }
    log(`level ${String(z)}: ${String(into.size)} of ${String(tiles.size)} tiles recomposed and stored`);
  }
  for (const z of [-1, 0]) {
    for (const [key, d] of [...(fine.get(z) as Map<string, Uint8Array>)].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      stored.push({ z, x, y, d });
    }
  }
  lap('composeFine');

  // ---- encode
  const encoded = await pool(stored, options.encodeJobs, (t) => encodeTile(t.d, options.webp));
  const tiles: AtlasTile[] = stored.map((t, i) => {
    const bytes = encoded[i] as Buffer;
    return { z: t.z, x: t.x, y: t.y, path: `t/${String(t.z)}/${String(t.x)}/${String(t.y)}.webp`, bytes, gzipBytes: gzipSize(bytes) };
  });
  tiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  lap('encode');

  // ---- index
  const byLevel = new Map<number, AtlasTile[]>();
  for (const t of tiles) {
    const list = byLevel.get(t.z);
    if (list === undefined) byLevel.set(t.z, [t]);
    else list.push(t);
  }
  const index: AtlasIndex = {
    schema: 1,
    kind: 'map-atlas-index',
    layout: layout.name,
    atlasHash: hash,
    tileSize: TILE,
    minLevel: MIN_LEVEL,
    maxLevel: MAX_LEVEL,
    baseLevel: BASE_LEVEL,
    underlayLevel: -5,
    template: ATLAS_TILE_TEMPLATE,
    seaColour: SEA_DEEP,
    coastColour: SEA_COAST,
    extent: layout.extent,
    seamE: layout.seamE,
    placements: placements.map((p) => ({ mapId: Number(p.mapId), kind: p.kind, eOff: p.eOff, sOff: p.sOff, rect: { xMin: p.rect.xMin, xMax: p.rect.xMax, yMin: p.rect.yMin, yMax: p.rect.yMax } })),
    insets: plan.insets.map((i) => ({ mapId: i.mapId, uiMapId: i.uiMapId, eMin: i.e0, eMax: i.e0 + i.w, sMin: i.s0, sMax: i.s0 + i.h })),
    uiMaps: Object.fromEntries(
      [...plan.sources.filter((s) => s.cls !== 'continent').map((s) => [s.uiMapId, s.t, s.ydpx] as const), ...plan.insets.map((i) => [i.uiMapId, i.top, i.ydpx] as const)]
        .sort((a, b) => a[0] - b[0])
        .map(([id, t, ydpx]) => [String(id), [t, round(ydpx, 3)] as const]),
    ),
    levels: Array.from({ length: MAX_LEVEL - MIN_LEVEL + 1 }, (_, i) => {
      const z = MIN_LEVEL + i;
      const { nx, ny } = gridAt(z, tw, th);
      return levelBitmaps({ z, nx, ny, stored: (byLevel.get(z) ?? []).map((t) => [t.x, t.y] as const), sea: z <= BASE_LEVEL ? (seaKeys.get(z) ?? []) : null });
    }),
  };
  const indexText = `${JSON.stringify(index)}\n`;

  // ---- lettering census
  const lettering = runLetteringCensus(sourceInputs, grids, zoneArcs, inputs.labels);
  lap('letteringCensus');

  // ---- measurements
  const contrast = [-6, -5].map((z) => contrastAt(scene, levels.get(z) as Rgb8, z, plan));
  const fits = [
    [918, 700],
    [1366, 768],
    [700, 500],
  ].map(([w, h]) => fitOf(w ?? 0, h ?? 0, layout.extent.eMax - layout.extent.eMin, layout.extent.sMax - layout.extent.sMin, tiles));
  const sizes = tiles.map((t) => t.gzipBytes).sort((a, b) => a - b);
  const levelSummaries: AtlasLevelSummary[] = Array.from({ length: MAX_LEVEL - MIN_LEVEL + 1 }, (_, i) => {
    const z = MIN_LEVEL + i;
    const list = byLevel.get(z) ?? [];
    const stat = levelStats.get(z);
    const { nx, ny } = gridAt(z, tw, th);
    return {
      z,
      ydPerPx: 2 ** -z,
      grid: `${String(nx)}x${String(ny)}`,
      stored: list.length,
      virtual: stat === undefined ? null : stat.virtual,
      sea: stat === undefined ? null : stat.sea,
      bytes: list.reduce((s, t) => s + t.bytes.length, 0),
      gzipBytes: list.reduce((s, t) => s + t.gzipBytes, 0),
      largestGzipBytes: list.reduce((s, t) => Math.max(s, t.gzipBytes), 0),
    };
  });
  const coverage = coverageCensus(census, facts, grids);
  const sourceRecords: AtlasSourceRecord[] = [
    ...[...plan.sources].sort((a, b) => a.uiMapId - b.uiMapId).map((s): AtlasSourceRecord => {
      const r = rasterOf(s.uiMapId).record;
      return {
        uiMapId: s.uiMapId,
        name: s.name,
        role: s.cls === 'continent' ? 'read' : s.areas === null ? 'card' : 'polygon',
        cls: s.cls,
        mapId: s.mapId,
        assignment: s.assignment,
        ydPerPx: round(s.ydpx, 6),
        nearestLevel: s.tNearest,
        topLevel: s.t,
        loss: round(s.loss, 3),
        areas: s.areas,
        atlasRect: { eMin: round(s.E0, 3), eMax: round(s.E1, 3), sMin: round(s.S0, 3), sMax: round(s.S1, 3) },
        pixelsSha256: r.pixelsSha256,
        overlaysSha256: r.overlaysSha256,
        inputHash: r.inputHash,
      };
    }),
    ...plan.insets.map((i): AtlasSourceRecord => {
      const r = rasterOf(i.uiMapId).record;
      return { uiMapId: i.uiMapId, name: i.name, role: 'inset', cls: 'zone', mapId: i.mapId, assignment: i.assignment, ydPerPx: round(i.ydpx, 6), nearestLevel: i.top, topLevel: i.top, loss: round(2 ** -i.top / i.ydpx, 3), areas: null, atlasRect: { eMin: round(i.e0, 3), eMax: round(i.e0 + i.w, 3), sMin: round(i.s0, 3), sMax: round(i.s0 + i.h, 3) }, pixelsSha256: r.pixelsSha256, overlaysSha256: r.overlaysSha256, inputHash: r.inputHash };
    }),
  ];
  const files: AtlasFileEntry[] = [{ path: ATLAS_INDEX_FILE, bytes: Buffer.byteLength(indexText), sha256: sha256Hex(indexText) }, ...tiles.map((t) => ({ path: t.path, bytes: t.bytes.length, sha256: sha256Hex(t.bytes) }))];
  const hidden = inputs.labels.labels
    .filter((l) => l.rule === 'hide')
    .map((l) => ({ uiMapId: l.uiMapId, name: l.name, label: l.label, levels: l.levels, box: [...l.box], reason: l.reason }));
  const letteringRecord = {
    detector: DETECTOR,
    paintings: lettering.paintings,
    candidates: lettering.candidates,
    atBaseLevel: lettering.counts,
    atFineLevels: lettering.fineCounts,
    entries: lettering.entries.map((e) => ({ ...e, label: inputs.labels.labels[e.index]?.label ?? '' })),
    notWhole: lettering.labels.filter((l) => l.state !== 'whole' || l.fineState !== 'whole').map((l) => ({ uiMapId: l.uiMapId, box: l.box, state: l.state, fineState: l.fineState, keepMin: l.keepMin, keepMax: l.keepMax, underCity: l.underCity })),
  };
  const censusRecord = {
    coverage,
    lettering: letteringRecord,
    contrast,
    contrastMinimum: CONTRAST_MIN,
    fits,
    underlay: { level: -5, tiles: byLevel.get(-5)?.length ?? 0, gzipBytes: (byLevel.get(-5) ?? []).reduce((s, t) => s + t.gzipBytes, 0) },
    tileGzip: { median: sizes[Math.floor(sizes.length / 2)] ?? 0, p95: sizes[Math.floor(sizes.length * 0.95)] ?? 0, max: sizes[sizes.length - 1] ?? 0 },
    fineAncestors: Object.fromEntries([...fineAncestors].map(([z, m]) => [String(z), countBy([...m.values()])])),
    windowsBaseLevel: windows,
  };
  const manifestValue = buildAtlasManifest({
    client: options.client,
    toolTrees: options.toolTrees,
    encoder: options.encoder,
    webp: options.webp,
    layout: { name: layout.name, seamE: layout.seamE, extent: { ...layout.extent }, basis: layout.basis },
    atlasHash: hash,
    placements: index.placements.map((p) => {
      const src = placements.find((x) => Number(x.mapId) === p.mapId)?.source;
      return { ...p, source: src };
    }),
    sources: sourceRecords,
    terrain: inputs.terrain.flatMap((t) => [
      { path: `public/maps/terrain/${t.reliefPath}`, sha256: t.reliefSha256 },
      { path: `public/maps/terrain/${t.zonesPath}`, sha256: t.zonesSha256 },
    ]),
    labels: { file: inputs.labelsFile.path, sha256: inputs.labelsFile.sha256, whole: inputs.labels.labels.filter((l) => l.rule === 'whole').length, hidden },
    parameters: { tile: TILE, levels: [MIN_LEVEL, MAX_LEVEL], baseLevel: BASE_LEVEL, ...ATLAS_PARAMS, seaDeepLightness: SEA_DEEP_LIGHTNESS },
    sea: { coast: SEA_COAST, deep: SEA_DEEP, measuredCoast: facts.measuredSeaCoast },
    levels: levelSummaries,
    seaKeys: Object.fromEntries([...seaKeys].sort((a, b) => a[0] - b[0]).map(([z, keys]) => [String(z), keys])),
    census: censusRecord,
    files,
  });
  const manifestText = formatJson(manifestValue);
  const parsed = parseAtlasManifest(JSON.parse(manifestText) as unknown);
  if (parsed.manifest === null) throw new Error(`the atlas manifest does not parse: ${parsed.errors.join('; ')}`);
  const noticeText = atlasNoticeText(parsed.manifest);
  lap('write');
  const report = {
    timingsMs: timings,
    tiles: tiles.length,
    bytes: tiles.reduce((s, t) => s + t.bytes.length, 0),
    gzipBytes: tiles.reduce((s, t) => s + t.gzipBytes, 0),
    folderGzipBytes: tiles.reduce((s, t) => s + t.gzipBytes, 0) + gzipSize(Buffer.from(indexText)) + gzipSize(Buffer.from(manifestText)) + gzipSize(Buffer.from(noticeText)),
    index: { bytes: Buffer.byteLength(indexText), gzipBytes: gzipSize(Buffer.from(indexText)) },
    manifestGzipBytes: gzipSize(Buffer.from(manifestText)),
    levels: levelSummaries,
    census: censusRecord,
    measuredSeaCoast: facts.measuredSeaCoast,
    inlandWaterCells: Object.fromEntries(facts.inlandWaterCells),
    treeHash: sha256Hex(
      tiles
        .map((t) => `${String(t.z)}/${String(t.x)}/${String(t.y)} ${sha256Hex(t.bytes)} ${String(t.bytes.length)}`)
        .sort()
        .join('\n'),
    ),
  };
  if (options.log !== undefined) log(`built ${String(tiles.length)} tiles in ${JSON.stringify(timings)}`);
  return { tiles, indexText, manifestText, noticeText, placements, atlasHash: hash, plan, lettering, report };
}

function countBy(values: readonly number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of [...values].sort((a, b) => b - a)) out[String(v)] = (out[String(v)] ?? 0) + 1;
  return out;
}

/** Level −2 tiles worth composing: near a zone painting's frame, the card, land, or the coastal water gradient (§7.1). */
function candidateTiles(scene: Scene, plan: AtlasPlan, tw: number, th: number): Uint8Array {
  const P2 = 2 ** -BASE_LEVEL;
  const cand = new Uint8Array(tw * th);
  const markRect = (E0: number, E1: number, S0: number, S1: number): void => {
    for (let ty = Math.max(0, Math.floor(S0 / P2 / TILE)); ty <= Math.min(th - 1, Math.floor(S1 / P2 / TILE)); ty += 1) {
      for (let tx = Math.max(0, Math.floor(E0 / P2 / TILE)); tx <= Math.min(tw - 1, Math.floor(E1 / P2 / TILE)); tx += 1) cand[ty * tw + tx] = 1;
    }
  };
  const band = ATLAS_PARAMS.coastYd[1];
  for (const s of plan.sources) if (s.cls === 'zone') markRect(s.E0 - band, s.E1 + band, s.S0 - band, s.S1 + band);
  for (const i of plan.insets) markRect(i.e0, i.e0 + i.w, i.s0, i.s0 + i.h);
  for (let ty = 0; ty < th; ty += 1) {
    for (let tx = 0; tx < tw; tx += 1) {
      if (cand[ty * tw + tx] === 1) continue;
      for (let j = 0; j < TILE && cand[ty * tw + tx] !== 1; j += 8) {
        for (let i = 0; i < TILE; i += 8) {
          const E = (tx * TILE + i) * P2;
          const S = (ty * TILE + j) * P2;
          let hit = seaDistance(scene, E, S) < ATLAS_PARAMS.deepSeaYd[1] + 64;
          if (!hit && inWorld(scene, E, S)) {
            const m = placedMapAt(scene, E);
            const k = cellOf(m.grid, m.sOff - S, m.eOff - E);
            hit = k >= 0 && (m.grid.cls[k] ?? 0) >= CLASS_LAND;
          }
          if (hit) {
            cand[ty * tw + tx] = 1;
            break;
          }
        }
      }
    }
  }
  return cand;
}

/** Land against open sea at a level (§9.2, MA-05): median land luminance against the mean of sea over 2,000 yd from land, card excluded. */
function contrastAt(scene: Scene, L: Rgb8, z: number, plan: AtlasPlan): Readonly<Record<string, number>> {
  const p = 2 ** -z;
  const lv: number[] = [];
  let seaN = 0;
  let seaL = 0;
  for (let y = 0; y < L.h; y += 1) {
    for (let x = 0; x < L.w; x += 1) {
      const E = (x + 0.5) * p;
      const S = (y + 0.5) * p;
      if (E >= scene.extentW || S >= scene.extentH) continue;
      const q = (y * L.w + x) * 3;
      const l = luminance(L.d[q] ?? 0, L.d[q + 1] ?? 0, L.d[q + 2] ?? 0);
      if (plan.insets.some((i) => E >= i.e0 && E <= i.e0 + i.w && S >= i.s0 && S <= i.s0 + i.h)) continue;
      const m = placedMapAt(scene, E);
      const k = cellOf(m.grid, m.sOff - S, m.eOff - E);
      if (k >= 0 && inWorld(scene, E, S) && m.grid.cls[k] === CLASS_LAND && m.keep[k] === 1) lv.push(l);
      else if (seaDistance(scene, E, S) > 2000) {
        seaN += 1;
        seaL += l;
      }
    }
  }
  lv.sort((a, b) => a - b);
  const land = lv[Math.floor(lv.length / 2)] ?? 0;
  const sea = seaN > 0 ? seaL / seaN : 0;
  const ratio = (Math.max(land, sea) + 0.05) / (Math.min(land, sea) + 0.05);
  return { level: z, landMedianLuminance: round(land, 4), openSeaLuminance: round(sea, 4), ratio: round(ratio, 2) };
}

function fitOf(w: number, h: number, extentW: number, extentH: number, tiles: readonly AtlasTile[]): Readonly<Record<string, unknown>> {
  const zoom = Math.log2(Math.min(w / extentW, h / extentH));
  const level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(zoom)));
  const at = tiles.filter((t) => t.z === level);
  return { panel: `${String(w)}x${String(h)}`, zoom: round(zoom, 3), tileLevel: level, tiles: at.length, gzipBytes: at.reduce((s, t) => s + t.gzipBytes, 0) };
}

function coverageCensus(census: CoverageCensus, facts: SceneFacts, grids: ReadonlyMap<number, ReliefGrid>): Readonly<Record<string, unknown>> {
  const pct = (a: number, b: number): number => (b > 0 ? round((100 * a) / b, 2) : 0);
  const byMap = Object.fromEntries(
    [...census.byMap].sort((a, b) => a[0] - b[0]).map(([m, c]) => [String(m), { land: c.land, ownPct: pct(c.own, c.land), neighbourPct: pct(c.neighbour, c.land), tintPct: pct(c.tint, c.land), droppedPct: pct(c.dropped, c.land) }]),
  );
  const worst = [...census.byArea]
    .filter(([, c]) => c.land >= 200)
    .map(([k, c]) => ({ area: k, land: c.land, ownPct: pct(c.own, c.land), neighbourPct: pct(c.neighbour, c.land), tintPct: pct(c.tint, c.land), droppedPct: pct(c.dropped, c.land) }))
    .sort((a, b) => b.tintPct + b.droppedPct - (a.tintPct + a.droppedPct) || (a.area < b.area ? -1 : 1))
    .slice(0, 18);
  const dropped = Object.fromEntries(
    [...facts.dropped].sort((a, b) => a[0] - b[0]).map(([m, list]) => {
      const s = grids.get(m)?.s ?? 0;
      return [String(m), Object.fromEntries([...list].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([area, n]) => [String(area), { cells: n, yd2: Math.round(n * s * s) }]))];
    }),
  );
  const empty = emptyCounts();
  return {
    lattice: '16 yd at level −2: terrain land (relief class land, not water) inside each map\'s UiMap 947 row rectangle, split at the seam; own: own-polygon detail weight ≥ 0.5; neighbour: coverage ≥ 0.5 from other paintings\' painted ground or a city plan; tint: the backdrop; dropped: land the land test removes',
    categories: Object.keys(empty),
    byMap,
    worstAreas: worst,
    droppedByArea: dropped,
  };
}
