import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { AtlasPlacement } from '../../../src/geo/atlas';
import type { MapGeometry } from '../../../src/geo/types';
import { reduce, type Rgb8 } from './atlas-pyramid';
import type { MinimapBuild, MinimapReviewData } from './minimap-build';
import type { NativeCensus, SeamLevelCensus } from './minimap-census';
import type { MinimapMapSource } from './minimap-inputs';
import { NAVY } from './minimap-params';
import type { BlackComponent, SkirtSide } from './minimap-recolour';
import { resampleRect, TAPS, type StitchMap } from './minimap-stitch';
import { ORIGIN_YD, TEX, TEXEL_YD, tileKey } from './minimap-texels';

/**
 * The contact sheets for the owner's sign-off (docs/research/map-atlas.md §18.10; D-049 O18): each
 * place at native pixels, magnified by nearest neighbour (1:1, 2:1, 3:1), with the source drawn
 * through the same stitch and resample beside the build, and the previous signed-off build as a
 * middle panel when one is given (`--previous`, a raw pyramid: `index.json` listing each level's
 * stored keys and `L<z>.bin` holding their RGB tiles in that order, the format of the revision 3.1
 * prototype's builds). No averaging (MM-01).
 *
 * The places: the revision 3.1 sheets (`mm31-*.png`, the same crops as the signed-off
 * `.cache/minimap-addendum/r31/img/`), then this build's census worst (the ten worst long seams, the
 * most amplified wet blocks, the bluest fully dry shore cells), the six capitals at levels −1 and 0,
 * both continents at the fit view, the black components over 256 texels and the edge skirts.
 */

export interface SheetPlace {
  readonly label: string;
  /** Atlas yards of the crop's north-west corner, and its size. */
  readonly e0: number;
  readonly s0: number;
  readonly wYd: number;
  readonly hYd: number;
  readonly z: number;
  readonly mag: number;
}

export interface Sheet {
  readonly name: string;
  readonly places: readonly SheetPlace[];
}

const P = (label: string, e0: number, s0: number, wYd: number, hYd: number, z: number, mag: number): SheetPlace => ({ label, e0, s0, wYd, hYd, z, mag });

/** The revision 3.1 prototype's places (`r31/sheets.sh`), at 1:1 and, around each centre, at 2:1. */
const R31: Readonly<Record<string, readonly SheetPlace[]>> = {
  A: [
    P('1 Kalimdor lake (MM-01)', 6200, 19850, 420, 380, 0, 1),
    P('2 Loch Modan (MM-01, MM-03)', 25700, 13050, 520, 420, 0, 1),
    P('3 Tirisfal coast (MM-01)', 20880, 4700, 520, 400, 0, 1),
    P('4 Tirisfal north coast, ADT corner (MM-03)', 21300, 4450, 700, 450, 0, 1),
  ],
  B: [
    P('5 Stormwind harbour', 21866, 16800, 400, 400, 0, 1),
    P('6 Duskwood river (MM-02)', 24295, 18606, 440, 400, 0, 1),
    P('7 Stranglethorn shore rocks (MM-02)', 20062, 21056, 440, 400, 0, 1),
    P('8 Violet river by Dalaran (MM-02)', 21845, 7215, 400, 300, 0, 1),
  ],
  C: [
    P('9 Zephras Isle lake and beaches (MM-02)', 15900, 2150, 600, 500, 0, 1),
    P('10 Zephras Isle south-east dock (MM-10)', 16650, 3700, 560, 520, 0, 1),
    P('11 North Darkshore, family edge (MM-03)', 5985, 4700, 400, 500, 0, 1),
  ],
  D: [
    P('12 Dustwallow Marsh, kept (MM-08)', 9100, 15700, 600, 560, 0, 1),
    P('13 Swamp of Sorrows, kept (MM-08)', 25950, 17800, 600, 500, 0, 1),
    P('14 Kalimdor ADT 29_31|29_32: one lake in two styles (MM-08)', 5500, 11050, 300, 300, 0, 1),
  ],
};

export function r31Sheets(): Sheet[] {
  const out: Sheet[] = [];
  for (const mag of [1, 2]) {
    for (const [name, places] of Object.entries(R31)) {
      out.push({
        name: `mm31-${String(mag)}to1-${name}`,
        places: places.map((p) => (mag === 1 ? p : { ...p, e0: Math.round(p.e0 + p.wYd / 4), s0: Math.round(p.s0 + p.hYd / 4), wYd: Math.round(p.wYd / 2), hYd: Math.round(p.hYd / 2), mag: 2 })),
      });
    }
  }
  out.push({
    name: 'mm31-worst-seams',
    places: [
      P('A. EK 33_32|33_33, the worst long seam left at level -1 in b5 (19.6)', 22882, 8793, 300, 300, -1, 3),
      P('B. Kalimdor 45_35|45_36 (20.6 at -1 in b5)', 7635, 19923, 300, 300, -1, 3),
      P('C. EK 49_39|50_39, Swamp of Sorrows coast (23.3 at -2 in b5)', 26306, 17207, 600, 600, -2, 3),
      P('D. EK 56_26|57_26 (12.4 at -2 in b5)', 19525, 21040, 400, 400, -1, 2),
      P('E. EK 29_27|29_28 (10.8 at -1 in b5)', 20166, 6533, 400, 400, -1, 2),
      P('F. Texture: the most amplified 16-px block left in b5, EK (26864, 18032)', 26780, 17950, 200, 150, 0, 3),
    ],
  });
  out.push({ name: 'mm31-stv-corner-3to1', places: [P('Stranglethorn south shore, ADT corner at 3:1 (faint patch left in b5)', 20250, 21150, 250, 180, 0, 3)] });
  return out;
}

/** Atlas position of a map's texel (x, y) of tile (row, col). */
function atlasOfTexel(p: AtlasPlacement, row: number, col: number, x: number, y: number): readonly [number, number] {
  return [p.eOff - ORIGIN_YD + (col * TEX + x) * TEXEL_YD, p.sOff - ORIGIN_YD + (row * TEX + y) * TEXEL_YD];
}

/** This build's worst places (§18.10): long seams, amplified blocks, bluest dry shore cells, black components, skirts. */
export function censusSheets(build: MinimapBuild, review: MinimapReviewData, geometry: MapGeometry): Sheet[] {
  const placement = (id: number): AtlasPlacement | undefined => review.placements.find((p) => Number(p.mapId) === id);
  const out: Sheet[] = [];
  const seams = build.census['seams'] as Readonly<Record<string, SeamLevelCensus>>;
  const worst = Object.entries(seams)
    .flatMap(([z, c]) => c.worstEdges.filter((e) => e.rows >= 16).map((e) => ({ ...e, z: Number(z) })))
    .sort((a, b) => b.seam - a.seam)
    .slice(0, 10);
  out.push({
    name: 'census-worst-seams',
    places: worst.map((e, i) => {
      const yd = 128 * 2 ** -e.z;
      return P(`${String(i + 1)}. map ${String(e.mapId)} ${e.a}|${e.b}: seam ${String(e.seam)} levels over ${String(e.rows)} rows at level ${String(e.z)}`, Math.round(e.e - yd / 2), Math.round(e.s - yd / 2), yd, yd, e.z, 2);
    }),
  });
  const amplified: SheetPlace[] = [];
  const bluest: SheetPlace[] = [];
  for (const m of build.maps) {
    const p = placement(m.mapId);
    if (p === undefined) continue;
    const c: NativeCensus = m.census;
    for (const w of c.texture.worst.slice(0, 4)) {
      const [delta, row, col, bx, by] = w as [number, number, number, number, number];
      const [E, S] = atlasOfTexel(p, row, col, bx + 8, by + 8);
      amplified.push(P(`map ${String(m.mapId)} ${String(row)}_${String(col)} block (${String(bx)}, ${String(by)}): luma SD +${String(delta)}`, Math.round(E - 64), Math.round(S - 64), 128, 128, 0, 3));
    }
    const rel = c.relief;
    const R = rel === null ? undefined : rel;
    if (R !== undefined) {
      for (const b of R.bluestDryShore.slice(0, 5)) {
        const [blue, x, y] = b as [number, number, number];
        // relief cell (x, y): 16 texels of the map's tile rectangle
        const [row0, col0] = reliefOrigin(m.mapId, build);
        const [E, S] = atlasOfTexel(p, row0, col0, x * 16 + 8, y * 16 + 8);
        bluest.push(P(`map ${String(m.mapId)} dry shore cell (${String(x)}, ${String(y)}): ${String(blue)} levels bluer`, Math.round(E - 48), Math.round(S - 48), 96, 96, 0, 3));
      }
    }
  }
  out.push({ name: 'census-amplified-blocks', places: amplified }, { name: 'census-bluest-dry-shore', places: bluest });
  // the six capitals at levels 0 and −1 (UiMap city frames 1453-1458)
  const capitals: SheetPlace[] = [];
  for (const id of [1453, 1454, 1455, 1456, 1457, 1458]) {
    const g = [...geometry.maps.values()].find((u) => Number(u.uiMapId) === id);
    const a = g?.assignments[0];
    const p = a === undefined ? undefined : placement(Number(a.mapId));
    if (g === undefined || a === undefined || p === undefined) continue;
    const E = p.eOff - (a.yMin + a.yMax) / 2;
    const S = p.sOff - (a.xMin + a.xMax) / 2;
    capitals.push(P(`${g.name} (UiMap ${String(id)}) at level 0`, Math.round(E - 256), Math.round(S - 192), 512, 384, 0, 1));
    capitals.push(P(`${g.name} (UiMap ${String(id)}) at level −1`, Math.round(E - 512), Math.round(S - 384), 1024, 768, -1, 1));
  }
  out.push({ name: 'capitals', places: capitals });
  out.push({ name: 'fit-view', places: [P('Both continents and the Zephras Isle card at the world band (level −5, 32 yd/px)', 0, 0, review.extentW, review.extentH, -5, 1)] });
  const black: SheetPlace[] = [];
  const skirts: SheetPlace[] = [];
  for (const m of build.maps) {
    const p = placement(m.mapId);
    if (p === undefined) continue;
    for (const c of m.black.over64.filter((x: BlackComponent) => x.texels > 256)) {
      const [row, col] = c.tile.split('_').map(Number) as [number, number];
      const [E, S] = atlasOfTexel(p, row, col, (c.box[0] + c.box[2]) / 2, (c.box[1] + c.box[3]) / 2);
      black.push(P(`map ${String(m.mapId)} ${c.tile}: ${String(c.texels)} black texels kept (O16)`, Math.round(E - 48), Math.round(S - 48), 96, 96, 0, 3));
    }
    for (const s of m.skirts) {
      const [row, col] = s.tile.split('_').map(Number) as [number, number];
      const mid = sideMiddle(s);
      const [E, S] = atlasOfTexel(p, row, col, mid[0], mid[1]);
      skirts.push(P(`map ${String(m.mapId)} ${s.tile} ${s.side}: edge skirt made void (the 32-texel strip; ${String(s.dryTexels)} of its texels on dry quads)`, Math.round(E - 200), Math.round(S - 150), 400, 300, 0, 1));
    }
  }
  out.push({ name: 'black-texels', places: black }, { name: 'edge-skirts', places: skirts });
  return out.filter((s) => s.places.length > 0);
}

function sideMiddle(s: SkirtSide): readonly [number, number] {
  if (s.side === 'N') return [TEX / 2, 0];
  if (s.side === 'S') return [TEX / 2, TEX];
  if (s.side === 'W') return [0, TEX / 2];
  return [TEX, TEX / 2];
}

function reliefOrigin(mapId: number, build: MinimapBuild): readonly [number, number] {
  const grids = (JSON.parse(build.manifestText) as { sources: { liquidGrids: { mapId: number; row0: number; col0: number }[] } }).sources.liquidGrids;
  const g = grids.find((x) => x.mapId === mapId);
  return [g?.row0 ?? 0, g?.col0 ?? 0];
}

// ---------------------------------------------------------------------------------------------
// Pixel providers

/** A region of level `z` (`w × h` pixels from pixel (X0, Y0)), RGB. */
export type RegionReader = (z: number, X0: number, Y0: number, w: number, h: number) => Uint8Array | null;

function fromTiles(get: (z: number, x: number, y: number) => Uint8Array | undefined): RegionReader {
  return (z, X0, Y0, w, h) => {
    const img = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const X = X0 + x;
        const Y = Y0 + y;
        const o = (y * w + x) * 3;
        const t = X < 0 || Y < 0 ? undefined : get(z, Math.floor(X / 256), Math.floor(Y / 256));
        if (t === undefined) {
          img[o] = NAVY[0];
          img[o + 1] = NAVY[1];
          img[o + 2] = NAVY[2];
          continue;
        }
        const q = ((Y % 256) * 256 + (X % 256)) * 3;
        img[o] = t[q] ?? 0;
        img[o + 1] = t[q + 1] ?? 0;
        img[o + 2] = t[q + 2] ?? 0;
      }
    }
    return img;
  };
}

/** Level 0 from a resampler, coarser levels as exact 2 × 2 reductions of an aligned level-0 region (up to `maxSide` level-0 pixels a side). */
function fromLevel0(level0: (X0: number, Y0: number, w: number, h: number) => Uint8Array, maxSide = 4096): RegionReader {
  return (z, X0, Y0, w, h) => {
    const k = 2 ** -z;
    if (w * k > maxSide || h * k > maxSide) return null;
    let img: Rgb8 = { w: w * k, h: h * k, d: level0(X0 * k, Y0 * k, w * k, h * k) };
    for (let i = 0; i < -z; i += 1) img = reduce(img);
    return img.d;
  };
}

/** The build's pixels: level 0 through the stitch of the recoloured texels, coarser levels from the kept raw tiles. */
export function buildReader(review: MinimapReviewData): RegionReader {
  const tiles = fromTiles((z, x, y) => review.levels.get(z)?.get(`${String(x)},${String(y)}`));
  return (z, X0, Y0, w, h) => (z === 0 ? resampleRect(X0, Y0, w, h, review.stitch, review.owner, review.extentW, review.extentH) : tiles(z, X0, Y0, w, h));
}

/** The source texels (no recolour) through the same stitch, decoding the tiles a region needs on demand. */
export function sourceReader(review: MinimapReviewData, maps: readonly MinimapMapSource[], decode: (mapId: number, row: number, col: number) => Uint8Array): RegionReader {
  const cache = new Map<string, Uint8Array>();
  const level0 = (X0: number, Y0: number, w: number, h: number): Uint8Array => {
    const stitch: StitchMap[] = review.stitch.map((s) => {
      const src = maps.find((m) => m.mapId === s.mapId);
      const present = new Set(src?.tiles.map((t) => tileKey(t.row, t.col)) ?? []);
      const tiles = new Map<string, Uint8Array>();
      const eA = Math.max(0, X0);
      const eB = Math.min(review.extentW - 1, X0 + w - 1);
      const sA = Math.max(0, Y0);
      const sB = Math.min(review.extentH - 1, Y0 + h - 1);
      if (eA <= eB && sA <= sB) {
        const u0 = s.tapsE.first[eA] ?? 0;
        const u1 = (s.tapsE.first[eB] ?? 0) + TAPS;
        const v0 = s.tapsS.first[sA] ?? 0;
        const v1 = (s.tapsS.first[sB] ?? 0) + TAPS;
        for (let r = Math.floor(v0 / TEX); r <= Math.floor(v1 / TEX); r += 1) {
          for (let c = Math.floor(u0 / TEX); c <= Math.floor(u1 / TEX); c += 1) {
            const k = tileKey(r, c);
            if (!present.has(k)) continue;
            const ck = `${String(s.mapId)}:${k}`;
            let t = cache.get(ck);
            if (t === undefined) {
              t = decode(s.mapId, r, c);
              cache.set(ck, t);
            }
            tiles.set(k, t);
          }
        }
      }
      return { ...s, tiles };
    });
    return resampleRect(X0, Y0, w, h, stitch, review.owner, review.extentW, review.extentH);
  };
  return fromLevel0(level0);
}

/** A raw pyramid on disk (`index.json` with `levels: { z: [[x, y, …], …] }` and `L<z>.bin`), or null when the folder has none. */
export function rawPyramidReader(dir: string): RegionReader | null {
  const indexPath = join(dir, 'index.json');
  if (!existsSync(indexPath)) return null;
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { levels: Record<string, [number, number, string][]> };
  const pos = new Map<string, number>();
  for (const [z, list] of Object.entries(index.levels)) list.forEach(([x, y], i) => pos.set(`${z}:${String(x)},${String(y)}`, i));
  const fds = new Map<number, number>();
  const cache = new Map<string, Uint8Array>();
  const TB = 256 * 256 * 3;
  const get = (z: number, x: number, y: number): Uint8Array | undefined => {
    const key = `${String(z)}:${String(x)},${String(y)}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const i = pos.get(key);
    if (i === undefined) return undefined;
    let fd = fds.get(z);
    if (fd === undefined) {
      fd = openSync(join(dir, `L${String(z)}.bin`), 'r');
      fds.set(z, fd);
    }
    const b = Buffer.alloc(TB);
    readSync(fd, b, 0, TB, i * TB);
    const t = new Uint8Array(b.buffer, b.byteOffset, TB);
    if (cache.size > 512) cache.clear();
    cache.set(key, t);
    return t;
  };
  const reader = fromTiles(get);
  process.once('exit', () => {
    for (const fd of fds.values()) closeSync(fd);
  });
  return reader;
}

// ---------------------------------------------------------------------------------------------
// Drawing

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export interface Panel {
  readonly caption: string;
  readonly read: RegionReader;
}

/** One sheet: per place a captioned row of panels, magnified by nearest neighbour. */
export async function drawSheet(sheet: Sheet, panels: readonly Panel[]): Promise<Buffer> {
  const rows: Buffer[] = [];
  for (const place of sheet.places) {
    const f = 2 ** place.z;
    const X0 = Math.floor(place.e0 * f);
    const Y0 = Math.floor(place.s0 * f);
    const w = Math.max(1, Math.round(place.wYd * f));
    const h = Math.max(1, Math.round(place.hYd * f));
    const W = w * place.mag;
    const H = h * place.mag;
    const images: { input: Buffer; caption: string }[] = [];
    for (const p of panels) {
      const px = p.read(place.z, X0, Y0, w, h);
      if (px === null) continue;
      images.push({ input: await sharp(Buffer.from(px.buffer, px.byteOffset, px.byteLength), { raw: { width: w, height: h, channels: 3 } }).resize(W, H, { kernel: 'nearest' }).png().toBuffer(), caption: p.caption });
    }
    const total = Math.max(600, images.length * (W + 8) - 8);
    const yd = 2 ** -place.z;
    const cap = Buffer.from(
      `<svg width="${String(total)}" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/>` +
        `<text x="4" y="16" font-family="Arial" font-size="14" font-weight="bold">${esc(place.label)}</text>` +
        `<text x="4" y="34" font-family="Arial" font-size="12">${esc(`E ${String(place.e0)}, S ${String(place.s0)}, ${String(place.wYd)} x ${String(place.hYd)} yd; level ${String(place.z)} (${String(yd)} yd/px) at ${String(place.mag)}:1 - ${images.map((i) => i.caption).join(' | ')}`)}</text></svg>`,
    );
    rows.push(
      await sharp({ create: { width: total, height: H + 40, channels: 3, background: { r: 255, g: 255, b: 255 } } })
        .composite([{ input: cap, left: 0, top: 0 }, ...images.map((im, i) => ({ input: im.input, left: i * (W + 8), top: 40 }))])
        .png()
        .toBuffer(),
    );
  }
  const metas = await Promise.all(rows.map((b) => sharp(b).metadata()));
  const WW = Math.max(...metas.map((m) => m.width));
  const HH = metas.reduce((s, m) => s + m.height + 12, 0);
  let top = 0;
  const comps = rows.map((input, i) => {
    const c = { input, left: 0, top };
    top += (metas[i]?.height ?? 0) + 12;
    return c;
  });
  return sharp({ create: { width: WW, height: HH, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite(comps)
    .png()
    .toBuffer();
}

/** Writes every sheet into `dir` with an `index.json`; returns the file names. */
export async function writeMinimapSheets(dir: string, sheets: readonly Sheet[], panels: readonly Panel[]): Promise<string[]> {
  mkdirSync(dir, { recursive: true });
  const names: string[] = [];
  for (const sheet of sheets) {
    const png = await drawSheet(sheet, panels);
    writeFileSync(join(dir, `${sheet.name}.png`), png);
    names.push(`${sheet.name}.png`);
  }
  writeFileSync(
    join(dir, 'index.json'),
    `${JSON.stringify({ panels: panels.map((p) => p.caption), sheets: sheets.map((s) => ({ file: `${s.name}.png`, places: s.places })) }, null, 1)}\n`,
  );
  return names;
}

