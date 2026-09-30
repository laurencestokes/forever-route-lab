import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { atlasHash, atlasLayoutProblems, atlasPlacements, type AtlasPlacement } from '../../../src/geo/atlas';
import type { AtlasLayout } from '../../../src/geo/atlas-layout';
import type { MapGeometry } from '../../../src/geo/types';
import { reduce, type Rgb8 } from './atlas-pyramid';
import type { EncoderIdentity, WebpSettings } from './encode';
import { sha256Hex } from './hash';
import { formatJson } from './json';
import {
  censusFailures,
  contrastOf,
  independentSeams,
  landUnderSea,
  liquidWetMask,
  nativeCensus,
  rampAgreement,
  reliefWetMask,
  skirtReliefCells,
  type NativeCensus,
  type RampAgreement,
  type SeamLevelCensus,
  type SeamMap,
} from './minimap-census';
import type { MinimapMapSource, MinimapTileSource, ReliefInput } from './minimap-inputs';
import { classify, emptyLevels, minimapIndexText, type LevelKeys } from './minimap-keys';
import { liquidGridRecord, reliefEquality, reliefRefusal } from './minimap-liquid';
import { buildMinimapManifest, parseMinimapManifest, type MinimapFileEntry, type MinimapLevelSummary } from './minimap-manifest';
import { minimapNoticeText } from './minimap-notice';
import { packFiles, packPointer, tarArchive, tilesTreeHash, type PackPointer } from './minimap-pack';
import { MINIMAP_BUDGET, MINIMAP_MAX_LEVEL, MINIMAP_MIN_LEVEL, MINIMAP_TILE, NAVY, PACK_CONTENTS, RECOLOUR, SEAM_MEASURE, STITCH_BLOCK, type RecolourParams } from './minimap-params';
import { recolourMap, type BlackCensus, type RecolourStats, type SkirtSide } from './minimap-recolour';
import { pixelOwner, stitchBlock, stitchMap, type PixelOwner, type StitchMap } from './minimap-stitch';
import { tileKey, type LiquidGrid, type MapTexels } from './minimap-texels';

/**
 * The whole minimap build in memory (docs/research/map-atlas.md §18.2): per map, decode, recolour
 * and take the census; then stitch and resample per level −4 block, reduce to level −8, classify
 * the keys, encode, measure the pyramid (the independent seams, the contrast, M8's ramp agreement,
 * M9), and write the index, manifest, NOTICE, pack and pointer. `minimap.ts` feeds it from the client;
 * tests feed it synthetic maps. It never touches the file system. A failed §19.5 gate or budget is
 * returned in `failures`, and the tool then writes nothing but the report and the contact sheets.
 */

export interface MinimapMapInput {
  readonly source: MinimapMapSource;
  readonly liquid: LiquidGrid;
  /** The decoded texels of one tile (512 × 512 × 3). */
  readonly texels: (tile: MinimapTileSource) => Uint8Array;
}

export interface MinimapBuildInputs {
  readonly layout: AtlasLayout;
  readonly geometry: MapGeometry;
  /** In the layout's order: placed maps west first, then insets. */
  readonly maps: readonly MinimapMapInput[];
  readonly reliefs: ReadonlyMap<number, ReliefInput>;
  readonly terrainManifestSha256: string;
  readonly tables: readonly { readonly table: string; readonly fileDataId: number; readonly ckey: string; readonly hazardIds?: readonly number[] }[];
}

export interface MinimapBuildOptions {
  readonly client: { readonly product: string; readonly version: string; readonly buildKey: string };
  readonly tool: { readonly hash: string; readonly files: number };
  readonly node: string;
  readonly encoder: EncoderIdentity;
  readonly webp: WebpSettings;
  readonly encodeJobs: number;
  /** Keep the recoloured texels and the coarse levels for the contact sheets. */
  readonly keepForReview?: boolean;
  readonly params?: RecolourParams;
  readonly log?: (line: string) => void;
}

export interface MinimapTile {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly path: string;
  readonly bytes: Buffer;
  readonly gzipBytes: number;
  readonly sha256: string;
  /** SHA-256 of the lossless RGB tile (encoder-independent). */
  readonly rawSha256: string;
}

export interface MinimapMapReport {
  readonly mapId: number;
  readonly tiles: number;
  readonly recolour: RecolourStats;
  readonly familyFeatheredTiles: number;
  readonly edgeFeathered: number;
  readonly skirts: readonly SkirtSide[];
  readonly black: BlackCensus;
  readonly census: NativeCensus;
}

export interface MinimapReviewData {
  readonly placements: readonly AtlasPlacement[];
  readonly owner: PixelOwner;
  readonly extentW: number;
  readonly extentH: number;
  /** The recoloured texels through the stitch (level 0 panels). */
  readonly stitch: readonly StitchMap[];
  /** Raw tiles of levels −1 … −8, keyed `x,y` per level (sea keys absent). */
  readonly levels: ReadonlyMap<number, ReadonlyMap<string, Uint8Array>>;
}

export interface MinimapBuild {
  readonly tiles: readonly MinimapTile[];
  readonly indexText: string;
  readonly manifestText: string;
  readonly noticeText: string;
  readonly pointer: PackPointer;
  readonly pointerText: string;
  readonly pack: Buffer;
  readonly atlasHash: string;
  readonly maps: readonly MinimapMapReport[];
  readonly census: Readonly<Record<string, unknown>>;
  readonly levels: readonly MinimapLevelSummary[];
  /** Every failed gate or budget; the tool writes nothing when this is not empty. */
  readonly failures: readonly string[];
  readonly report: Readonly<Record<string, unknown>>;
  readonly review: MinimapReviewData | null;
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

/** WebP of one RGB tile with the art's settings: one libvips thread per image and no operation cache, so the bytes do not depend on scheduling. */
export async function encodeMinimapTile(rgb: Uint8Array, webp: WebpSettings): Promise<Buffer> {
  sharp.concurrency(1);
  sharp.cache(false);
  return sharp(Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength), { raw: { width: MINIMAP_TILE, height: MINIMAP_TILE, channels: 3 } })
    .webp({ quality: webp.quality, alphaQuality: webp.alphaQuality, effort: webp.effort, smartSubsample: webp.smartSubsample, preset: webp.preset, lossless: false })
    .toBuffer();
}

/** An encoded tile's RGB, decoded. */
export async function decodeMinimapTile(bytes: Uint8Array): Promise<Uint8Array> {
  const { data } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Tile (tx, ty) of a raster, padded with the navy beyond its edge. */
function sliceTile(img: Rgb8, tx: number, ty: number): Uint8Array {
  const out = new Uint8Array(MINIMAP_TILE * MINIMAP_TILE * 3);
  const T = MINIMAP_TILE;
  for (let y = 0; y < T; y += 1) {
    const sy = ty * T + y;
    for (let x = 0; x < T; x += 1) {
      const sx = tx * T + x;
      const q = (y * T + x) * 3;
      if (sx < img.w && sy < img.h) {
        const p = (sy * img.w + sx) * 3;
        out[q] = img.d[p] ?? 0;
        out[q + 1] = img.d[p + 1] ?? 0;
        out[q + 2] = img.d[p + 2] ?? 0;
      } else {
        out[q] = NAVY[0];
        out[q + 1] = NAVY[1];
        out[q + 2] = NAVY[2];
      }
    }
  }
  return out;
}

const round = (v: number, places: number): number => Math.round(v * 10 ** places) / 10 ** places;

export async function buildMinimap(inputs: MinimapBuildInputs, options: MinimapBuildOptions): Promise<MinimapBuild> {
  const log = options.log ?? ((): void => undefined);
  const params = options.params ?? RECOLOUR;
  const timings: Record<string, number> = {};
  let t0 = performance.now();
  const lap = (key: string): void => {
    timings[key] = (timings[key] ?? 0) + Math.round(performance.now() - t0);
    t0 = performance.now();
  };
  const { layout } = inputs;
  const placements = atlasPlacements(inputs.geometry, layout);
  if (placements === null) throw new Error(`the ${layout.name} layout cannot be placed: ${atlasLayoutProblems(inputs.geometry, layout).join('; ')}`);
  const hash = atlasHash(placements, layout);
  const extentW = layout.extent.eMax - layout.extent.eMin;
  const extentH = layout.extent.sMax - layout.extent.sMin;
  if (layout.extent.eMin !== 0 || layout.extent.sMin !== 0) throw new Error('the atlas extent must start at the origin');
  const owner = pixelOwner(placements, layout);
  /** A map's name: its inset's UiMap, or the continent UiMap (type 2) of the committed geometry on that map; else the client's folder name. */
  const mapName = (mapId: number, fallback: string): string => {
    const inset = layout.insets.find((i) => Number(i.mapId) === mapId);
    const all = [...inputs.geometry.maps.values()];
    const u = inset === undefined ? all.find((g) => g.type === 2 && g.assignments.some((a) => Number(a.mapId) === mapId)) : all.find((g) => Number(g.uiMapId) === Number(inset.uiMapId));
    return u?.name ?? fallback;
  };
  const placementOf = (mapId: number): AtlasPlacement => {
    const p = placements.find((x) => Number(x.mapId) === mapId);
    if (p === undefined) throw new Error(`map ${String(mapId)} has no placement in the ${layout.name} layout`);
    return p;
  };

  // ---- 1. the liquid grids against the committed relief (A16)
  const reliefChecks = new Map<number, { compared: number; same: number }>();
  for (const m of inputs.maps) {
    const relief = inputs.reliefs.get(m.source.mapId);
    if (relief === undefined) continue;
    const eq = reliefEquality(m.liquid, relief);
    const refusal = reliefRefusal(m.source.mapId, eq);
    if (refusal !== null) throw new Error(refusal);
    reliefChecks.set(m.source.mapId, { compared: eq.compared, same: eq.same });
  }
  lap('reliefCheck');

  // ---- 2. per map: decode, recolour, census
  const recs = new Map<number, ReadonlyMap<string, Uint8Array>>();
  const mapReports: MinimapMapReport[] = [];
  for (const m of inputs.maps) {
    const mapId = m.source.mapId;
    const rgb = new Map<string, Uint8Array>();
    for (const t of m.source.tiles) rgb.set(tileKey(t.row, t.col), m.texels(t));
    lap('decode');
    const texels: MapTexels = { mapId, tiles: m.source.tiles, rgb };
    const r = recolourMap(texels, m.liquid, params);
    lap('recolour');
    const census = nativeCensus(texels, r.rec, r.weight, m.liquid, inputs.reliefs.get(mapId) ?? null, r.voidMasks, r.haze);
    lap('census');
    recs.set(mapId, r.rec);
    mapReports.push({ mapId, tiles: m.source.tiles.length, recolour: r.stats, familyFeatheredTiles: r.familyFeatheredTiles, edgeFeathered: r.edgeFeathered, skirts: r.skirts, black: r.black, census });
    log(`map ${String(mapId)}: ${String(m.source.tiles.length)} tiles recoloured (${String(r.stats.full)} texels fully, ${String(r.stats.partial)} partly; ${String(r.skirts.length)} edge skirt(s); ${String(r.edgeFeathered)} edges feathered)`);
  }

  // ---- 3. stitch and resample per level −4 block; levels 0 … −4; encode
  const card = (p: AtlasPlacement): StitchMap['owns'] => ({ eMin: p.eOff - p.rect.yMax, eMax: p.eOff - p.rect.yMin, sMin: p.sOff - p.rect.xMax, sMax: p.sOff - p.rect.xMin });
  const stitch: StitchMap[] = inputs.maps.map((m) => {
    const id = m.source.mapId;
    const p = placementOf(id);
    const side = layout.placed.find((x) => Number(x.mapId) === id)?.side;
    const owns = p.kind === 'inset' ? card(p) : side === 'west' ? { eMin: 0, eMax: layout.seamE, sMin: 0, sMax: extentH } : { eMin: layout.seamE, eMax: extentW, sMin: 0, sMax: extentH };
    return stitchMap(id, recs.get(id) ?? new Map(), p, extentW, extentH, owns);
  });
  lap('taps');
  const levels = emptyLevels(extentW, extentH);
  const kept = new Map<number, Map<string, Uint8Array>>();
  for (let z = -1; z >= MINIMAP_MIN_LEVEL; z -= 1) kept.set(z, new Map());
  const stored: { z: number; x: number; y: number; d: Uint8Array }[] = [];
  const tiles: MinimapTile[] = [];
  const encodeStored = async (): Promise<void> => {
    const batch = stored.splice(0, stored.length);
    const encoded = await pool(batch, options.encodeJobs, (t) => encodeMinimapTile(t.d, options.webp));
    batch.forEach((t, i) => {
      const bytes = encoded[i] as Buffer;
      tiles.push({ z: t.z, x: t.x, y: t.y, path: `t/${String(t.z)}/${String(t.x)}/${String(t.y)}.webp`, bytes, gzipBytes: gzipSync(bytes, { level: 6 }).length, sha256: sha256Hex(bytes), rawSha256: sha256Hex(t.d) });
    });
  };
  const emit = (z: number, x: number, y: number, d: Uint8Array): void => {
    const L = levels.get(z);
    if (L === undefined || x >= L.nx || y >= L.ny) return;
    if (!classify(levels, z, x, y, d)) return;
    stored.push({ z, x, y, d });
    kept.get(z)?.set(`${String(x)},${String(y)}`, d);
  };
  const NBX = Math.ceil(extentW / STITCH_BLOCK);
  const NBY = Math.ceil(extentH / STITCH_BLOCK);
  const perBlock = STITCH_BLOCK / MINIMAP_TILE;
  for (let by = 0; by < NBY; by += 1) {
    for (let bx = 0; bx < NBX; bx += 1) {
      const raster = stitchBlock(bx, by, stitch, owner, extentW, extentH);
      lap('stitch');
      let img: Rgb8 = { w: STITCH_BLOCK, h: STITCH_BLOCK, d: raster };
      for (let z = 0; z >= -4; z -= 1) {
        const n = Math.max(1, perBlock / 2 ** -z);
        for (let ty = 0; ty < n; ty += 1) for (let tx = 0; tx < n; tx += 1) emit(z, bx * n + tx, by * n + ty, sliceTile(img, tx, ty));
        if (z > -4) img = reduce(img);
      }
      lap('pyramid');
      await encodeStored();
      lap('encode');
    }
    log(`stitched block row ${String(by + 1)}/${String(NBY)}`);
  }
  // levels −5 … −8 from level −4 (padded with the navy)
  {
    const L4 = levels.get(-4) as LevelKeys;
    const k4 = kept.get(-4) as Map<string, Uint8Array>;
    const side = 2 ** Math.ceil(Math.log2(Math.max(L4.nx, L4.ny)));
    let img: Rgb8 = { w: side * MINIMAP_TILE, h: side * MINIMAP_TILE, d: new Uint8Array(side * side * MINIMAP_TILE * MINIMAP_TILE * 3) };
    for (let i = 0; i < img.w * img.h; i += 1) {
      img.d[i * 3] = NAVY[0];
      img.d[i * 3 + 1] = NAVY[1];
      img.d[i * 3 + 2] = NAVY[2];
    }
    for (const [key, t] of k4) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      for (let yy = 0; yy < MINIMAP_TILE; yy += 1) img.d.set(t.subarray(yy * MINIMAP_TILE * 3, (yy + 1) * MINIMAP_TILE * 3), ((y * MINIMAP_TILE + yy) * img.w + x * MINIMAP_TILE) * 3);
    }
    for (let z = -5; z >= MINIMAP_MIN_LEVEL; z -= 1) {
      img = reduce(img);
      const L = levels.get(z) as LevelKeys;
      for (let ty = 0; ty < L.ny; ty += 1) for (let tx = 0; tx < L.nx; tx += 1) emit(z, tx, ty, sliceTile(img, tx, ty));
    }
    await encodeStored();
    lap('encode');
  }
  tiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  log(`${String(tiles.length)} tiles stored`);

  // ---- 4. the pyramid's census: independent seams (both masks), contrast, M8, M9
  const seamMaps: SeamMap[] = inputs.maps.map((m) => {
    const p = placementOf(m.source.mapId);
    return { mapId: m.source.mapId, eOff: p.eOff, sOff: p.sOff, tiles: m.source.tiles };
  });
  const levelTiles = (z: number) => {
    const k = kept.get(z);
    return (x: number, y: number): Uint8Array | undefined => k?.get(`${String(x)},${String(y)}`);
  };
  const grids = new Map(inputs.maps.map((m) => [m.source.mapId, m.liquid] as const));
  const liquidMask = liquidWetMask(seamMaps, grids, owner);
  const reliefMask = reliefWetMask(seamMaps, inputs.reliefs, owner);
  const reliefMaps = seamMaps.filter((m) => inputs.reliefs.has(m.mapId));
  // The gate's seam census reads the lossless pyramid (as the prototype measured it). The copies the
  // offline checks re-derive (M8, M11) read the encoded tiles, decoded, so a check without the client
  // compares like with like.
  const decoded = new Map<number, Map<string, Uint8Array>>();
  for (const z of [...SEAM_MEASURE.levels]) {
    const list = tiles.filter((t) => t.z === z);
    const px = await pool(list, options.encodeJobs, (t) => decodeMinimapTile(t.bytes));
    decoded.set(z, new Map(list.map((t, i) => [`${String(t.x)},${String(t.y)}`, px[i] as Uint8Array])));
  }
  const decodedTiles = (z: number) => {
    const k = decoded.get(z);
    return (x: number, y: number): Uint8Array | undefined => k?.get(`${String(x)},${String(y)}`);
  };
  const seams: Record<string, SeamLevelCensus> = {};
  const seamsReliefMask: Record<string, SeamLevelCensus> = {};
  for (const z of SEAM_MEASURE.levels) {
    seams[String(z)] = independentSeams(z, levelTiles(z), seamMaps, liquidMask);
    seamsReliefMask[String(z)] = independentSeams(z, decodedTiles(z), reliefMaps, reliefMask);
  }
  const contrast = contrastOf(-5, [...(kept.get(-5) ?? new Map<string, Uint8Array>()).values()]);
  const L2 = levels.get(-2) as LevelKeys;
  const ramp: Record<string, RampAgreement> = rampAgreement(-2, decodedTiles(-2), L2.nx, L2.ny, reliefMaps, inputs.reliefs, owner);
  decoded.clear();
  const seaSets = new Map([...levels].map(([z, L]) => [z, { nx: L.nx, keys: new Set(L.sea.map(([x, y]) => y * L.nx + x)) }] as const));
  const skirtExempt = new Map<number, ReadonlySet<number>>();
  for (const m of mapReports) {
    const R = inputs.reliefs.get(m.mapId);
    if (R !== undefined) skirtExempt.set(m.mapId, skirtReliefCells(m.skirts, R));
  }
  const m9 = landUnderSea(inputs.reliefs, seamMaps, owner, seaSets, skirtExempt);
  lap('pyramidCensus');

  // ---- 5. gates and budgets
  const failures = censusFailures({ maps: Object.fromEntries(mapReports.map((m) => [String(m.mapId), m.census])), seams, contrast, landUnderSea: m9 });
  const levelSummaries: MinimapLevelSummary[] = [];
  for (let z = MINIMAP_MIN_LEVEL; z <= MINIMAP_MAX_LEVEL; z += 1) {
    const L = levels.get(z) as LevelKeys;
    const list = tiles.filter((t) => t.z === z);
    levelSummaries.push({
      z,
      ydPerPx: 2 ** -z,
      grid: `${String(L.nx)}x${String(L.ny)}`,
      stored: L.stored.length,
      sea: L.sea.length,
      flatNonSea: L.flatNonSea,
      bytes: list.reduce((s, t) => s + t.bytes.length, 0),
      gzipBytes: list.reduce((s, t) => s + t.gzipBytes, 0),
      largestGzipBytes: list.reduce((s, t) => Math.max(s, t.gzipBytes), 0),
    });
  }
  for (const l of levelSummaries) {
    const base = MINIMAP_BUDGET.levelBaselines[String(l.z)];
    if (base !== undefined && l.gzipBytes > base * (1 + MINIMAP_BUDGET.tolerance)) failures.push(`level ${String(l.z)}: ${String(l.gzipBytes)} B gzip-6, over its baseline ${String(base)} B + 10 %`);
  }
  const largest = tiles.reduce((s, t) => Math.max(s, t.gzipBytes), 0);
  if (largest > MINIMAP_BUDGET.perTileGzipBytes) failures.push(`a tile is ${String(largest)} B gzip-6, over the ${String(MINIMAP_BUDGET.perTileGzipBytes)} B cap`);

  // ---- 6. outputs
  const indexText = minimapIndexText(layout, hash, placements, levels);
  const files: MinimapFileEntry[] = [{ path: 'index.json', bytes: Buffer.byteLength(indexText), sha256: sha256Hex(indexText) }, ...tiles.map((t) => ({ path: t.path, bytes: t.bytes.length, sha256: t.sha256 }))];
  const treeHash = tilesTreeHash(tiles);
  const pixelsSha256 = sha256Hex(tiles.map((t) => `${t.path} ${t.rawSha256}\n`).join(''));
  const census = {
    maps: Object.fromEntries(
      mapReports.map((m) => [
        String(m.mapId),
        { recolour: m.recolour, familyFeatheredTiles: m.familyFeatheredTiles, edgeFeathered: m.edgeFeathered, skirts: m.skirts, black: m.black, ...m.census },
      ]),
    ),
    seams,
    seamsReliefMask,
    contrast,
    rampAgreement: ramp,
    landUnderSea: m9,
    gates: failures.length === 0 ? 'pass' : failures,
    basis: {
      maps: 'native texels: the source against the recoloured texels, before the resample',
      seams: 'the lossless pyramid (levels −1 to −3), the liquid grid as the wet mask: the gate',
      seamsReliefMask: 'the encoded tiles, decoded, the committed relief as the wet mask (M11 re-derives it)',
      rampAgreement: 'the encoded level −2 tiles, decoded (M8 re-derives it)',
      contrast: 'the lossless level −5 tiles',
    },
    pixelsSha256,
  };
  const manifestValue = buildMinimapManifest({
    client: options.client,
    tool: options.tool,
    node: options.node,
    encoder: options.encoder,
    webp: options.webp,
    layout: { name: layout.name, seamE: layout.seamE, extent: { ...layout.extent } },
    atlasHash: hash,
    placements: placements.map((p) => ({ mapId: Number(p.mapId), kind: p.kind, eOff: p.eOff, sOff: p.sOff, rect: { xMin: p.rect.xMin, xMax: p.rect.xMax, yMin: p.rect.yMin, yMax: p.rect.yMax } })),
    maps: inputs.maps.map((m) => ({ mapId: m.source.mapId, name: mapName(m.source.mapId, m.source.directory), directory: m.source.directory, wdt: m.source.wdt, tiles: m.source.tiles.length })),
    minimaps: inputs.maps.flatMap((m) => m.source.tiles.map((t) => [m.source.mapId, t.row, t.col, t.minimap.fileDataId, t.minimap.ckey] as const)),
    rootAdts: inputs.maps.flatMap((m) => m.source.tiles.map((t) => [m.source.mapId, t.row, t.col, t.rootAdt.fileDataId, t.rootAdt.ckey] as const)),
    tables: inputs.tables,
    terrain: { manifestSha256: inputs.terrainManifestSha256, reliefs: [...inputs.reliefs.values()].sort((a, b) => a.mapId - b.mapId).map((r) => ({ mapId: r.mapId, path: r.path, sha256: r.sha256 })) },
    liquidGrids: inputs.maps.map((m) => ({ mapId: m.source.mapId, ...liquidGridRecord(m.liquid), relief: reliefChecks.get(m.source.mapId) ?? null })),
    census,
    levels: levelSummaries,
    seaKeys: Object.fromEntries([...levels].sort((a, b) => a[0] - b[0]).map(([z, L]) => [String(z), [...L.sea].sort((a, b) => a[1] - b[1] || a[0] - b[0])])),
    pack: { treeHash, contents: PACK_CONTENTS },
    files,
  });
  const manifestText = formatJson(manifestValue);
  const parsed = parseMinimapManifest(JSON.parse(manifestText) as unknown);
  if (parsed.manifest === null) throw new Error(`the minimap manifest does not parse: ${parsed.errors.join('; ')}`);
  const noticeText = minimapNoticeText(parsed.manifest);
  const pack = tarArchive(packFiles(noticeText, manifestText, tiles.map((t) => ({ path: t.path, bytes: t.bytes }))));
  const pointer = packPointer(pack, treeHash, options.client.version);
  const pointerText = formatJson(pointer);
  lap('outputs');
  const gz = (text: string): number => gzipSync(Buffer.from(text), { level: 6 }).length;
  const tileGzip = tiles.map((t) => t.gzipBytes).sort((a, b) => a - b);
  const folderGzip = tileGzip.reduce((s, v) => s + v, 0) + gz(indexText) + gz(manifestText) + gz(noticeText) + gz(pointerText);
  if (folderGzip > MINIMAP_BUDGET.totalGzipBytes) failures.push(`the minimap folder is ${String(folderGzip)} B gzip-6, over the ${String(MINIMAP_BUDGET.totalGzipBytes)} B budget`);
  const fit = (w: number, h: number): Readonly<Record<string, number | string>> => {
    const zoom = Math.log2(Math.min(w / extentW, h / extentH));
    const level = Math.max(MINIMAP_MIN_LEVEL, Math.min(MINIMAP_MAX_LEVEL, Math.round(zoom)));
    const at = tiles.filter((t) => t.z === level);
    return { panel: `${String(w)}x${String(h)}`, zoom: round(zoom, 3), tileLevel: level, tiles: at.length, gzipBytes: at.reduce((s, t) => s + t.gzipBytes, 0) };
  };
  const report = {
    timingsMs: timings,
    tiles: tiles.length,
    bytes: tiles.reduce((s, t) => s + t.bytes.length, 0),
    gzipBytes: tileGzip.reduce((s, v) => s + v, 0),
    folderGzipBytes: folderGzip,
    tileGzip: { median: tileGzip[Math.floor(tileGzip.length / 2)] ?? 0, p95: tileGzip[Math.floor(tileGzip.length * 0.95)] ?? 0, max: tileGzip[tileGzip.length - 1] ?? 0 },
    index: { bytes: Buffer.byteLength(indexText), gzipBytes: gz(indexText) },
    manifest: { bytes: Buffer.byteLength(manifestText), gzipBytes: gz(manifestText) },
    notice: { bytes: Buffer.byteLength(noticeText), gzipBytes: gz(noticeText) },
    pack: { bytes: pack.length, sha256: pointer.sha256, asset: pointer.asset, tag: pointer.tag },
    treeHash,
    pixelsSha256,
    fits: [fit(918, 700), fit(1366, 768), fit(700, 500)],
    levels: levelSummaries,
    failures,
    rawTiles: Object.fromEntries(tiles.map((t) => [t.path, t.rawSha256])),
  };
  log(`built ${String(tiles.length)} tiles; ${JSON.stringify(timings)}`);
  const review: MinimapReviewData | null = options.keepForReview === true ? { placements, owner, extentW, extentH, stitch, levels: kept } : null;
  return { tiles, indexText, manifestText, noticeText, pointer, pointerText, pack, atlasHash: hash, maps: mapReports, census, levels: levelSummaries, failures, report, review };
}
