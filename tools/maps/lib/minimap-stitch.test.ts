/**
 * Stitching and resampling onto the atlas grid (docs/research/map-atlas.md §18.2 step 6, §18.3;
 * step MM.4): the Lanczos-3 taps, their period of 25 pixels per 24 texels, the partition at the
 * seam and the card's edges, and blocks drawn from synthetic texels.
 */
import { describe, expect, it } from 'vitest';
import { atlasPlacements, partition } from '../../../src/geo/atlas';
import { SYNTH_LAYOUT, synthGeometry } from './atlas-test-support';
import { NAVY } from './minimap-params';
import { axisTaps, lanczos3, pixelOwner, resampleRect, stitchBlock, stitchMap, TAPS } from './minimap-stitch';
import { paintTile } from './minimap-test-support';
import { ORIGIN_YD, TEX, TEXEL_YD, tileKey } from './minimap-texels';

const placements = atlasPlacements(synthGeometry(), SYNTH_LAYOUT);
if (placements === null) throw new Error('synthetic layout does not place');
const W = SYNTH_LAYOUT.extent.eMax;
const H = SYNTH_LAYOUT.extent.sMax;

describe('the Lanczos-3 taps', () => {
  it('is 1 at 0 and 0 at the other integers and beyond 3', () => {
    expect(lanczos3(0)).toBe(1);
    for (const x of [1, 2, -1, -2]) expect(Math.abs(lanczos3(x))).toBeLessThan(1e-15);
    expect(lanczos3(3)).toBe(0);
    expect(lanczos3(-3.5)).toBe(0);
  });

  it('sums each pixel\'s six weights to 1 and repeats every 25 pixels, 24 texels on (the periodic weights equal the direct ones)', () => {
    const off = 5652 - ORIGIN_YD;
    const t = axisTaps(2000, off);
    for (let i = 0; i < 2000; i += 1) {
      let s = 0;
      for (let j = 0; j < TAPS; j += 1) s += t.w[i * TAPS + j] ?? 0;
      expect(Math.abs(s - 1)).toBeLessThan(1e-12);
    }
    for (let i = 0; i + 25 < 2000; i += 1) {
      expect((t.first[i + 25] ?? 0) - (t.first[i] ?? 0)).toBe(24);
      for (let j = 0; j < TAPS; j += 1) expect(Math.abs((t.w[(i + 25) * TAPS + j] ?? 0) - (t.w[i * TAPS + j] ?? 0))).toBeLessThan(1e-9);
    }
    // the direct definition: pixel centre i + 0.5 is texel coordinate (i + 0.5 − off) / K − 0.5
    const c = (777 + 0.5 - off) / TEXEL_YD - 0.5;
    expect(t.first[777]).toBe(Math.floor(c) - 2);
  });
});

describe('ownership (partition)', () => {
  const owner = pixelOwner(placements, SYNTH_LAYOUT);
  it('gives every point the map src/geo partition gives it, at the seam and on the card\'s edges too', () => {
    const card = placements.find((p) => p.kind === 'inset');
    if (card === undefined) throw new Error('no card');
    const eMin = card.eOff - card.rect.yMax;
    const eMax = card.eOff - card.rect.yMin;
    const sMin = card.sOff - card.rect.xMax;
    const sMax = card.sOff - card.rect.xMin;
    const es = [0, 100.5, SYNTH_LAYOUT.seamE - 0.5, SYNTH_LAYOUT.seamE, SYNTH_LAYOUT.seamE + 0.5, eMin - 0.5, eMin, eMin + 0.5, eMax - 0.5, eMax, eMax + 0.5, W - 0.5];
    const ss = [0.5, sMin - 0.5, sMin, sMin + 0.5, sMax - 0.5, sMax, sMax + 0.5, H - 0.5];
    for (const e of es) for (const s of ss) expect(owner(e, s)).toBe(Number(partition(placements, SYNTH_LAYOUT, e, s)));
  });
});

describe('stitchBlock', () => {
  // map 1 has one tile of a flat colour at the ADT that holds its placement's origin
  const p1 = placements.find((p) => Number(p.mapId) === 1);
  if (p1 === undefined) throw new Error('no map 1');
  const row = 32;
  const col = 32;
  const flat = paintTile(() => [120, 60, 30]);
  const tiles = new Map([[tileKey(row, col), flat]]);
  const m1 = stitchMap(1, tiles, p1, W, H, { eMin: 0, eMax: SYNTH_LAYOUT.seamE, sMin: 0, sMax: H });
  const owner = pixelOwner(placements, SYNTH_LAYOUT);
  const block = stitchBlock(0, 0, [m1], owner, W, H);
  // the tile's atlas rectangle: E from eOff − origin + col · ADT
  const e0 = p1.eOff - ORIGIN_YD + col * TEX * TEXEL_YD;
  const s0 = p1.sOff - ORIGIN_YD + row * TEX * TEXEL_YD;
  const at = (e: number, s: number): number[] => {
    const q = (s * 4096 + e) * 3;
    return [block[q] ?? 0, block[q + 1] ?? 0, block[q + 2] ?? 0];
  };

  it('draws a flat tile as its colour, far from its edges', () => {
    expect(at(Math.round(e0 + 100), Math.round(s0 + 100))).toEqual([120, 60, 30]);
  });

  it('draws the navy where no tile is, and beyond the extent', () => {
    expect(at(Math.round(e0 - 50), Math.round(s0 + 100))).toEqual([...NAVY]);
    expect(at(10, 10)).toEqual([...NAVY]);
    const outside = stitchBlock(2, 0, [m1], owner, W, H);
    // block 2 starts at E 8,192; the extent ends at 10,240: its last column is navy
    expect([outside[(10 * 4096 + 4095) * 3], outside[(10 * 4096 + 4095) * 3 + 1], outside[(10 * 4096 + 4095) * 3 + 2]]).toEqual([...NAVY]);
  });

  it('gives the same pixels as the single-rectangle resampler the contact sheets use', () => {
    const x0 = Math.round(e0 - 20);
    const y0 = Math.round(s0 - 20);
    const r = resampleRect(x0, y0, 64, 48, [m1], owner, W, H);
    for (let y = 0; y < 48; y += 1) for (let x = 0; x < 64; x += 1) expect([r[(y * 64 + x) * 3], r[(y * 64 + x) * 3 + 1], r[(y * 64 + x) * 3 + 2]]).toEqual(at(x0 + x, y0 + y));
  });
});
