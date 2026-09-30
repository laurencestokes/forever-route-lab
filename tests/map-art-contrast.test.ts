/**
 * Contrast of the map's pins, labels, lines and selection ring over the base maps themselves
 * (docs/research/map-presentation.md §6.4, §25.6; step MP.2): the art-sampling test. It decodes the
 * tiles of both styles and checks every sampled pixel against the tokens in tokens.css:
 *
 * - **Pins** (both styles): whichever of the body (--frl-map-pin) and the keyline
 *   (--frl-map-pin-glyph) is farther from a pixel reaches 4.09:1 against it (the two-tone floor).
 * - **Minimap style**: labels in --frl-map-minimap-ink on --frl-map-minimap-halo painted over the
 *   pixel reach 4.5:1 (MEASURED in the design: 11.57); the route line and the selection ring in
 *   --frl-map-minimap-route on that halo reach 3:1 (5.40); a thin line in the muted ink, or its
 *   halo, reaches 3:1 against the pixel (3.88).
 * - **Painted style**, in both themes: labels in --frl-fg on --frl-map-label-halo over the pixel
 *   reach 4.5:1; the route line and the selection ring in the theme's accent on it reach 3:1.
 *
 * Samples: 400 pixels on a fixed grid from each of the committed painted atlas tiles at level -2
 * (318 tiles, sea included, as the design's 127,200), from every 16th minimap tile at level 0 (the
 * native 1 yd per pixel) when the tile pack is present, and the flat sea colours of both styles.
 * The minimap tiles are not committed (D-049 O14): without them that part is skipped, loudly.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const TOKENS = readFileSync(join(ROOT, 'src', 'ui', 'styles', 'tokens.css'), 'utf8');

interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex?.[1] !== undefined) return { r: parseInt(hex[1].slice(0, 2), 16), g: parseInt(hex[1].slice(2, 4), 16), b: parseInt(hex[1].slice(4, 6), 16), a: 1 };
  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(value.trim());
  if (rgb !== null) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: rgb[4] === undefined ? 1 : Number(rgb[4]) };
  throw new Error(`not a colour: ${value}`);
}

/** A token's value in a theme block of tokens.css (the shared block first, then the theme's own). */
function token(name: string, theme: 'light' | 'dark'): Rgba {
  const blocks = TOKENS.replace(/\/\*[\s\S]*?\*\//g, '').split('}');
  const shared = blocks[0] ?? '';
  const light = blocks.find((block) => block.includes("[data-theme='light']")) ?? '';
  const dark = blocks.find((block) => block.includes("[data-theme='dark']") && !block.includes('@media')) ?? '';
  for (const block of [theme === 'light' ? light : dark, shared]) {
    const match = new RegExp(`--frl-${name}:\\s*([^;]+);`).exec(block);
    if (match?.[1] !== undefined) return parse(match[1]);
  }
  throw new Error(`--frl-${name} is not in tokens.css (${theme})`);
}

const channel = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (c: Rgba): number => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
const over = (fg: Rgba, bg: Rgba): Rgba => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
function contrast(fg: Rgba, bg: Rgba): number {
  const a = luminance(over(fg, bg));
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** 400 pixels of a tile on a fixed 20 × 20 grid, magenta (a missing texture) left out. */
async function sampleTile(file: string): Promise<Rgba[]> {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out: Rgba[] = [];
  const step = info.width / 20;
  for (let j = 0; j < 20; j += 1) {
    for (let i = 0; i < 20; i += 1) {
      const x = Math.floor(i * step + step / 2);
      const y = Math.floor(j * (info.height / 20) + info.height / 40);
      const k = (y * info.width + x) * info.channels;
      const px = { r: data[k] ?? 0, g: data[k + 1] ?? 0, b: data[k + 2] ?? 0, a: 1 };
      if (px.r > 200 && px.b > 200 && px.g < 60) continue;
      out.push(px);
    }
  }
  return out;
}

function tilesAt(dir: string): readonly string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const x of readdirSync(dir).sort((a, b) => Number(a) - Number(b))) {
    for (const y of readdirSync(join(dir, x)).sort((a, b) => Number(a.split('.')[0]) - Number(b.split('.')[0]))) if (y.endsWith('.webp')) out.push(join(dir, x, y));
  }
  return out;
}

async function samplesOf(files: readonly string[]): Promise<Rgba[]> {
  const all: Rgba[] = [];
  for (const file of files) all.push(...(await sampleTile(file)));
  return all;
}

const PAINTED_TILES = tilesAt(join(ROOT, 'public', 'maps', 'atlas', 't', '-2'));
const MINIMAP_TILES = tilesAt(join(ROOT, 'public', 'maps', 'minimap', 't', '0')).filter((_, i) => i % 16 === 0);

const pin = token('map-pin', 'light');
const pinGlyph = token('map-pin-glyph', 'light');
const navy = token('map-sea-navy', 'light');
const FLATS = { navy, deep: token('map-sea-deep', 'light'), coast: token('map-sea-coast', 'light') };

/** The worst of a measure over the samples. */
const worst = (samples: readonly Rgba[], measure: (px: Rgba) => number): number => samples.reduce((least, px) => Math.min(least, measure(px)), Infinity);

function minimapChecks(samples: readonly Rgba[]): { readonly pin: number; readonly label: number; readonly route: number; readonly line: number } {
  const halo = token('map-minimap-halo', 'light');
  const ink = token('map-minimap-ink', 'light');
  const muted = token('map-minimap-ink-muted', 'light');
  const route = token('map-minimap-route', 'light');
  return {
    pin: worst(samples, (px) => Math.max(contrast(pin, px), contrast(pinGlyph, px))),
    label: worst(samples, (px) => contrast(ink, over(halo, px))),
    route: worst(samples, (px) => contrast(route, over(halo, px))),
    line: worst(samples, (px) => Math.max(contrast(muted, px), contrast(over(halo, px), px))),
  };
}

function paintedChecks(samples: readonly Rgba[], theme: 'light' | 'dark'): { readonly pin: number; readonly label: number; readonly route: number } {
  const halo = token('map-label-halo', theme);
  return {
    pin: worst(samples, (px) => Math.max(contrast(pin, px), contrast(pinGlyph, px))),
    label: worst(samples, (px) => contrast(token('fg', theme), over(halo, px))),
    route: worst(samples, (px) => contrast(token('accent', theme), over(halo, px))),
  };
}

describe('pins, labels, lines and the selection ring over the base maps (map-presentation.md §25.6)', () => {
  it('samples the committed painted atlas tiles at level -2', () => {
    expect(PAINTED_TILES.length).toBe(318);
  });

  it('keeps every check on the painted atlas tiles and the painted sea colours, in both themes', async () => {
    const samples = [...(await samplesOf(PAINTED_TILES)), FLATS.deep, FLATS.coast];
    expect(samples.length).toBeGreaterThan(120_000);
    for (const theme of ['light', 'dark'] as const) {
      const result = paintedChecks(samples, theme);
      expect(result.pin, `${theme} pin`).toBeGreaterThanOrEqual(4.08);
      expect(result.label, `${theme} label`).toBeGreaterThanOrEqual(4.5);
      expect(result.route, `${theme} route and ring`).toBeGreaterThanOrEqual(3);
    }
  }, 60_000);

  it('keeps every check on the minimap style’s navy', () => {
    const result = minimapChecks([navy]);
    expect(result.pin).toBeGreaterThanOrEqual(15);
    expect(result.label).toBeGreaterThanOrEqual(11.5);
    expect(result.route).toBeGreaterThanOrEqual(5.4);
    expect(result.line).toBeGreaterThanOrEqual(3);
  });

  it.skipIf(MINIMAP_TILES.length === 0)('keeps every check on the minimap tiles (skipped without the tile pack: run `pnpm maps:minimap:fetch`)', async () => {
    const samples = [...(await samplesOf(MINIMAP_TILES)), navy];
    expect(samples.length).toBeGreaterThan(100_000);
    const result = minimapChecks(samples);
    expect(result.pin).toBeGreaterThanOrEqual(4.08);
    expect(result.label).toBeGreaterThanOrEqual(4.5);
    expect(result.route).toBeGreaterThanOrEqual(3);
    expect(result.line).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('says loudly when the minimap tiles are absent', () => {
    if (MINIMAP_TILES.length === 0) console.warn('map-art-contrast: the minimap tile pack is not downloaded, so its pixels were not sampled (run `pnpm maps:minimap:fetch`)');
    expect(true).toBe(true);
  });
});
