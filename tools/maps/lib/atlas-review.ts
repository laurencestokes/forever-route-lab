import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { atlasRectOf, placementOf } from '../../../src/geo/atlas';
import { worldMapId } from '../../../src/domain/ids';
import type { AtlasBuild } from './atlas-build';
import { ART_H, ART_W, MIN_LEVEL, SEA_DEEP, TILE } from './atlas-params';
import { shiftDown } from './atlas-pyramid';
import { formatJson } from './json';

/**
 * The atlas contact sheet (docs/research/map-atlas.md §6.7; D-042 O8): the owner signs it off
 * before the tiles are committed, and again after any parameter change. Every view is drawn as the
 * runtime will draw it: stored tiles decoded from their WebP bytes, virtual keys from the nearest
 * stored ancestor (bilinear, clamped at that ancestor tile's edge), sea keys in the deep-sea colour,
 * and a fractional zoom resampled from the level `round(zoom)`.
 *
 * Sheets (JPEG, quality 90, under `.cache/map-build/contact-sheet/` by default, gitignored):
 * - `00-world.jpg`: the fit of the whole extent in a 918 × 700 panel (−5.22), and levels −6 and −5;
 * - `01-continents.jpg`: each continent at level −4, and the Zephras Isle card at −3 and −2;
 * - `NN-<place>.jpg`: each place §6.7 names, at levels −3, −2, −1 and 0;
 * - `50-cities.jpg`: the six capitals at −1 and 0 (the banner rule and the plans);
 * - `60-labels.jpg`: every label of atlas-labels.json at −2 and −1.6;
 * - `70-census.jpg`: every detector candidate the census did not find whole, at −2 and −1;
 * - `index.json`: what each sheet shows.
 */

type View = { readonly label: string; readonly zoom: number; readonly E: number; readonly S: number; readonly w: number; readonly h: number };

interface Place {
  readonly file: string;
  readonly title: string;
  readonly map: number;
  readonly X: number;
  readonly Y: number;
  readonly why: string;
}

/** The places of §6.7 and the review's list (map-atlas.md §0.1 MA-02, MA-03, MA-07), in world yards of their map. */
export const REVIEW_PLACES: readonly Place[] = [
  { file: '10-stormwind-west', title: 'West of Stormwind (harbour slices, MA-02)', map: 0, X: -8800, Y: 1300, why: 'the harbour decorations must no longer appear as slices' },
  { file: '11-north-of-stormwind', title: 'North of Stormwind (MA-03)', map: 0, X: -7530, Y: 500, why: 'no blurred continent-painting blocks' },
  { file: '12-blackrock-mountain', title: 'Blackrock Mountain (duplicate name, MA-02)', map: 0, X: -7300, Y: -1100, why: 'one BLACKROCK MOUNTAIN name; two painted peaks' },
  { file: '13-ironforge', title: 'Ironforge (banner, card, level-0 seam, MA-02, MA-07)', map: 0, X: -4870, Y: -870, why: 'no "IRO" fragment; the card at −1 and 0' },
  { file: '14-searing-gorge', title: 'Searing Gorge (frame edge against the tint)', map: 0, X: -6900, Y: -1250, why: 'straight frame edges where the painting ends' },
  { file: '15-dun-morogh-west', title: 'Dun Morogh west (frame edge; grey-on-snow names)', map: 0, X: -5500, Y: 900, why: 'frame edge against the tint; Coldridge Valley and Brewnall Village names whole' },
  { file: '16-winterspring-east', title: 'East of Winterspring (the dropped square and strip, MA-03)', map: 1, X: 6442, Y: -6956, why: 'the square and the L-shaped strip are gone' },
  { file: '17-southern-silithus', title: 'Southern Silithus (tint, MA-03)', map: 1, X: -8200, Y: 900, why: 'the tint instead of blurred continent painting' },
  { file: '18-orgrimmar', title: 'Orgrimmar and Durotar (banner rule, city filler)', map: 1, X: 1900, Y: -4400, why: 'the ORGRIMMAR banner whole at −2, hidden at −1 and 0 under the plan' },
  { file: '19-durotar-barrens', title: 'Durotar and The Barrens (zone border)', map: 1, X: 1600, Y: -3000, why: 'palette change across a border, softened by the colour band' },
  { file: '20-elwynn-westfall', title: 'Elwynn Forest and Westfall', map: 0, X: -9300, Y: 200, why: 'zone border and the Stormwind plan' },
  { file: '21-wetlands', title: 'Wetlands (tint share 35 %)', map: 0, X: -3200, Y: -2800, why: 'tint where the painting does not reach' },
  { file: '22-gilneas-silverpine', title: 'Gilneas and Silverpine Forest (tint, dropped islets)', map: 0, X: -700, Y: 1500, why: 'Gilneas is tint; islets west of Gilneas dropped' },
  { file: '23-thousand-needles', title: 'Razorfen Downs (duplicate name across the border)', map: 1, X: -4588, Y: -1876, why: 'one RAZORFEN DOWNS name (The Barrens keeps it)' },
  { file: '24-darkwhisper-gorge', title: 'Darkwhisper Gorge (duplicate name at the frame edge)', map: 1, X: 4589, Y: -3933, why: 'one DARKWHISPER GORGE name (Winterspring keeps it)' },
  { file: '25-skywatcher-plateau', title: 'Skywatcher Plateau (label drawn whole)', map: 1, X: -510, Y: 538, why: 'a label that straddles Mulgore\'s border, drawn whole' },
  { file: '26-undercity', title: 'Undercity (card, banner rule)', map: 0, X: 1700, Y: 300, why: 'the card at −1 and 0; UNDERCITY banner hidden there' },
  { file: '27-thunder-bluff', title: 'Thunder Bluff (plan, banner rule)', map: 1, X: -1200, Y: 50, why: 'the plan at −1 and 0; THUNDER BLUFF banner hidden there' },
  { file: '28-darnassus', title: 'Darnassus (plan, banner rule)', map: 1, X: 9900, Y: 2400, why: 'the plan at −1 and 0; DARNASSUS banner hidden there' },
  { file: '29-vile-reef', title: 'The Vile Reef (a label over the sea)', map: 0, X: -12000, Y: 800, why: 'a label drawn whole over the sea' },
];

const CITIES: readonly { readonly name: string; readonly map: number; readonly X: number; readonly Y: number }[] = [
  { name: 'Stormwind City', map: 0, X: -8900, Y: 700 },
  { name: 'Ironforge', map: 0, X: -4900, Y: -900 },
  { name: 'Undercity', map: 0, X: 1700, Y: 300 },
  { name: 'Orgrimmar', map: 1, X: 1700, Y: -4400 },
  { name: 'Thunder Bluff', map: 1, X: -1250, Y: 70 },
  { name: 'Darnassus', map: 1, X: 9900, Y: 2300 },
];

class TileSource {
  private readonly bytes: ReadonlyMap<string, Buffer>;
  private readonly cache = new Map<string, Uint8Array | null>();

  constructor(build: AtlasBuild) {
    this.bytes = new Map(build.tiles.map((t) => [`${String(t.z)}/${String(t.x)}/${String(t.y)}`, t.bytes]));
  }

  async tile(z: number, x: number, y: number): Promise<Uint8Array | null> {
    const key = `${String(z)}/${String(x)}/${String(y)}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const b = this.bytes.get(key);
    const d = b === undefined ? null : new Uint8Array((await sharp(b).removeAlpha().raw().toBuffer()).buffer);
    this.cache.set(key, d);
    return d;
  }
}

/** An atlas window of `w × h` screen pixels centred on (E, S) at `zoom`, as the runtime draws it (PNG buffer). */
async function drawView(src: TileSource, v: View): Promise<Buffer> {
  const level = Math.max(MIN_LEVEL, Math.min(0, Math.round(v.zoom)));
  const scale = 2 ** (v.zoom - level);
  const ydpx = 2 ** -level;
  const cx = v.E / ydpx;
  const cy = v.S / ydpx;
  const lw = v.w / scale;
  const lh = v.h / scale;
  const x0 = Math.floor(cx - lw / 2) - 1;
  const y0 = Math.floor(cy - lh / 2) - 1;
  const x1 = Math.ceil(cx + lw / 2) + 1;
  const y1 = Math.ceil(cy + lh / 2) + 1;
  const RW = x1 - x0;
  const RH = y1 - y0;
  const buf = new Uint8Array(RW * RH * 3);
  for (let i = 0; i < RW * RH; i += 1) {
    buf[i * 3] = SEA_DEEP[0];
    buf[i * 3 + 1] = SEA_DEEP[1];
    buf[i * 3 + 2] = SEA_DEEP[2];
  }
  const cl = (n: number): number => Math.max(0, Math.min(TILE - 1, n));
  for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y1 - 1) / TILE); ty += 1) {
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x1 - 1) / TILE); tx += 1) {
      if (tx < 0 || ty < 0) continue;
      const d = await src.tile(level, tx, ty);
      let anc: Uint8Array | null = null;
      let k = 0;
      if (d === null) {
        for (k = 1; level - k >= MIN_LEVEL; k += 1) {
          anc = await src.tile(level - k, shiftDown(tx, k), shiftDown(ty, k));
          if (anc !== null) break;
        }
      }
      const f = 2 ** k;
      const ax = (tx - shiftDown(tx, k) * 2 ** k) * (TILE / f);
      const ay = (ty - shiftDown(ty, k) * 2 ** k) * (TILE / f);
      for (let j = 0; j < TILE; j += 1) {
        for (let i = 0; i < TILE; i += 1) {
          const X = tx * TILE + i;
          const Y = ty * TILE + j;
          if (X < x0 || X >= x1 || Y < y0 || Y >= y1) continue;
          const o = ((Y - y0) * RW + (X - x0)) * 3;
          if (d !== null) {
            const q = (j * TILE + i) * 3;
            buf[o] = d[q] ?? 0;
            buf[o + 1] = d[q + 1] ?? 0;
            buf[o + 2] = d[q + 2] ?? 0;
            continue;
          }
          if (anc === null) continue;
          const a = anc;
          const fu = ax + (i + 0.5) / f - 0.5;
          const fv = ay + (j + 0.5) / f - 0.5;
          const u0 = Math.floor(fu);
          const v0 = Math.floor(fv);
          const au = fu - u0;
          const av = fv - v0;
          for (let c = 0; c < 3; c += 1) {
            const g = (u: number, vv: number): number => a[(cl(vv) * TILE + cl(u)) * 3 + c] ?? 0;
            buf[o + c] = Math.round((g(u0, v0) * (1 - au) + g(u0 + 1, v0) * au) * (1 - av) + (g(u0, v0 + 1) * (1 - au) + g(u0 + 1, v0 + 1) * au) * av);
          }
        }
      }
    }
  }
  const left = Math.round((cx - lw / 2 - x0) * scale);
  const top = Math.round((cy - lh / 2 - y0) * scale);
  return sharp(Buffer.from(buf), { raw: { width: RW, height: RH, channels: 3 } })
    .resize(Math.max(1, Math.round(RW * scale)), Math.max(1, Math.round(RH * scale)), { kernel: 'linear' })
    .extract({ left: Math.max(0, left), top: Math.max(0, top), width: v.w, height: v.h })
    .png()
    .toBuffer();
}

const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function caption(text: string, width: number): Buffer {
  return Buffer.from(`<svg width="${String(width)}" height="22" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/><text x="4" y="16" font-family="Arial" font-size="13">${escapeXml(text)}</text></svg>`);
}

/** Lays views out in rows of `cols`, each with a caption, and writes one JPEG. */
async function sheet(src: TileSource, file: string, title: string, views: readonly View[], cols: number): Promise<void> {
  const cellW = Math.max(...views.map((v) => v.w));
  const cellH = Math.max(...views.map((v) => v.h)) + 22;
  const rows = Math.ceil(views.length / cols);
  const width = cols * (cellW + 8);
  const pieces: OverlayOptions[] = [{ input: caption(title, width), left: 0, top: 0 }];
  for (const [i, v] of views.entries()) {
    const left = (i % cols) * (cellW + 8);
    const top = 26 + Math.floor(i / cols) * (cellH + 8);
    pieces.push({ input: caption(v.label, cellW), left, top }, { input: await drawView(src, v), left, top: top + 22 });
  }
  await sharp({ create: { width, height: 26 + rows * (cellH + 8), channels: 3, background: '#ffffff' } })
    .composite(pieces)
    .jpeg({ quality: 90 })
    .toFile(file);
}

/** Writes the contact sheet into `dir`; returns the files written. */
export async function writeContactSheet(build: AtlasBuild, dir: string): Promise<readonly string[]> {
  mkdirSync(dir, { recursive: true });
  const src = new TileSource(build);
  const written: string[] = [];
  const at = (map: number, X: number, Y: number): { E: number; S: number } => {
    const p = placementOf(build.placements, worldMapId(map));
    if (p === null) throw new Error(`world map ${String(map)} is not placed`);
    return { E: p.eOff - Y, S: p.sOff - X };
  };
  const ext = JSON.parse(build.indexText) as { extent: { eMax: number; sMax: number }; insets: { eMin: number; eMax: number; sMin: number; sMax: number }[] };
  const W = ext.extent.eMax;
  const H = ext.extent.sMax;
  const out = (name: string): string => {
    const f = join(dir, name);
    written.push(f);
    return f;
  };
  await sheet(
    src,
    out('00-world.jpg'),
    'The whole atlas: the fit of a 918 x 700 panel (zoom -5.22), then levels -6 and -5 at 1:1',
    [
      { label: 'fit, zoom -5.221 (918 x 700 panel)', zoom: Math.log2(Math.min(918 / W, 700 / H)), E: W / 2, S: H / 2, w: 918, h: 700 },
      { label: 'level -6 (64 yd/px)', zoom: -6, E: W / 2, S: H / 2, w: Math.ceil(W / 64), h: Math.ceil(H / 64) },
      { label: 'level -5 (32 yd/px)', zoom: -5, E: W / 2, S: H / 2, w: Math.ceil(W / 32), h: Math.ceil(H / 32) },
    ],
    3,
  );
  const card = ext.insets[0];
  // each continent's UiMap 947 row rectangle, within the extent, at 16 yd/px
  const continent = (map: number, name: string): View => {
    const p = placementOf(build.placements, worldMapId(map));
    if (p === null) throw new Error(`world map ${String(map)} is not placed`);
    const r = atlasRectOf(p);
    const e0 = Math.max(0, r.eMin);
    const e1 = Math.min(W, r.eMax);
    const s0 = Math.max(0, r.sMin);
    const s1 = Math.min(H, r.sMax);
    return { label: `${name}, level -4 (its UiMap 947 rectangle)`, zoom: -4, E: (e0 + e1) / 2, S: (s0 + s1) / 2, w: Math.ceil((e1 - e0) / 16), h: Math.ceil((s1 - s0) / 16) };
  };
  const views: View[] = [continent(1, 'Kalimdor'), continent(0, 'Eastern Kingdoms')];
  if (card !== undefined) {
    const cE = (card.eMin + card.eMax) / 2;
    const cS = (card.sMin + card.sMax) / 2;
    views.push({ label: 'Zephras Isle card, level -3', zoom: -3, E: cE, S: cS, w: 760, h: 520 }, { label: 'Zephras Isle card, level -2', zoom: -2, E: cE, S: cS, w: 900, h: 700 });
  }
  await sheet(src, out('01-continents-and-card.jpg'), 'Both continents at level -4 (16 yd/px) and the Zephras Isle card', views, 2);
  for (const p of REVIEW_PLACES) {
    const { E, S } = at(p.map, p.X, p.Y);
    await sheet(
      src,
      out(`${p.file}.jpg`),
      `${p.title}: ${p.why} (map ${String(p.map)}, X ${String(p.X)}, Y ${String(p.Y)})`,
      [-3, -2, -1, 0].map((z) => ({ label: `level ${String(z)} (${String(2 ** -z)} yd/px)`, zoom: z, E, S, w: 640, h: 440 })),
      2,
    );
  }
  await sheet(
    src,
    out('50-cities.jpg'),
    'The six capitals at levels -2, -1 and 0: plans and cards, and the banners hidden where the plan is drawn',
    CITIES.flatMap((c) => {
      const { E, S } = at(c.map, c.X, c.Y);
      return [-2, -1, 0].map((z) => ({ label: `${c.name}, level ${String(z)}`, zoom: z, E, S, w: 440, h: 330 }));
    }),
    3,
  );
  const centreOf = (id: number, box: readonly number[]): { E: number; S: number } | null => {
    const s = build.plan.sources.find((x) => x.uiMapId === id);
    if (s === undefined) return null;
    const u = ((box[0] ?? 0) + (box[2] ?? 0)) / 2;
    const v = ((box[1] ?? 0) + (box[3] ?? 0)) / 2;
    const Y = s.bounds.yMax - (u / ART_W) * (s.bounds.yMax - s.bounds.yMin);
    const X = s.bounds.xMax - (v / ART_H) * (s.bounds.xMax - s.bounds.xMin);
    return at(s.mapId, X, Y);
  };
  const labelViews: View[] = [];
  for (const l of build.lettering.labels.filter((x) => x.entries.length > 0)) {
    const c = centreOf(l.uiMapId, l.box);
    if (c === null) continue;
    labelViews.push({ label: `${l.name} [${l.box.join(',')}] -2: ${l.state}`, zoom: -2, E: c.E, S: c.S, w: 300, h: 150 }, { label: `-1.6: ${l.fineState}`, zoom: -1.6, E: c.E, S: c.S, w: 300, h: 150 });
  }
  if (labelViews.length > 0) await sheet(src, out('60-labels.jpg'), 'Every detector candidate a rule of atlas-labels.json applies to, at -2 and -1.6 (the state the census gives it)', labelViews, 4);
  const censusViews: View[] = [];
  for (const l of build.lettering.labels.filter((x) => x.state !== 'whole' || x.fineState !== 'whole')) {
    const c = centreOf(l.uiMapId, l.box);
    if (c === null) continue;
    censusViews.push({ label: `${l.name} [${l.box.join(',')}] -2: ${l.state} ${String(l.keepMin)}-${String(l.keepMax)}`, zoom: -2, E: c.E, S: c.S, w: 300, h: 150 }, { label: `-1: ${l.fineState}${l.underCity.length > 0 ? ` under ${l.underCity.join(', ')}` : ''}`, zoom: -1, E: c.E, S: c.S, w: 300, h: 150 });
  }
  if (censusViews.length > 0) await sheet(src, out('70-census.jpg'), 'Every detector candidate not found whole at every level, at -2 and -1', censusViews, 4);
  const indexFile = join(dir, 'index.json');
  writeFileSync(
    indexFile,
    formatJson({
      about: 'The atlas contact sheet (docs/research/map-atlas.md §6.7; D-042 O8), drawn as the runtime draws the tiles. The owner signs it off before the tiles are committed.',
      atlasHash: build.atlasHash,
      tiles: build.tiles.length,
      sheets: written.map((f) => f.split(/[\\/]/).pop()),
      places: REVIEW_PLACES,
    }),
  );
  return written;
}
