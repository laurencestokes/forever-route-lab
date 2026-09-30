import { describe, expect, it } from 'vitest';
import { detectLabels, DETECTOR } from './atlas-detect';
import type { Rgba8 } from './atlas-raster';

/**
 * The lettering detector (docs/research/map-atlas.md §6.5) on synthetic "letters": rows of
 * vertical strokes with an outline, which have the stroke rhythm of capitals.
 */

const W = 1002;
const H = 668;

function canvas(bg: readonly number[]): Uint8Array {
  const d = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i += 1) d.set([bg[0] ?? 0, bg[1] ?? 0, bg[2] ?? 0, 255], i * 4);
  return d;
}

/** Strokes 2 px wide every 6 px, `height` tall, in `ink`, each outlined 1 px in `outline`. */
function letters(d: Uint8Array, x0: number, y0: number, count: number, height: number, ink: readonly number[], outline: readonly number[]): void {
  const put = (x: number, y: number, c: readonly number[]): void => d.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 255], (y * W + x) * 4);
  for (let k = 0; k < count; k += 1) {
    const x = x0 + k * 6;
    for (let y = y0 - 1; y <= y0 + height; y += 1) for (let dx = -1; dx <= 2; dx += 1) put(x + dx, y, outline);
    for (let y = y0; y < y0 + height; y += 1) for (let dx = 0; dx <= 1; dx += 1) put(x + dx, y, ink);
  }
}

const painted = (): Rgba8 => ({ w: W, h: H, d: new Uint8Array(W * H * 4).map((_, i) => (i % 4 === 3 ? 255 : 0)) });

describe('the lettering detector', () => {
  it('finds cream letters with a dark outline on painted ground, and nothing on parchment', () => {
    const d = canvas([120, 110, 80]);
    letters(d, 100, 100, 8, 12, [230, 220, 180], [40, 30, 20]);
    const found = detectLabels({ w: W, h: H, d }, painted());
    expect(found).toHaveLength(1);
    expect(['light', 'mixed']).toContain(found[0]?.polarity);
    expect(found[0]?.box[0]).toBeLessThanOrEqual(100);
    expect(found[0]?.box[2]).toBeGreaterThanOrEqual(100 + 7 * 6 + 1);
    // the same letters where the overlays paint nothing are not candidates
    const bare: Rgba8 = { w: W, h: H, d: new Uint8Array(W * H * 4) };
    expect(detectLabels({ w: W, h: H, d }, bare)).toHaveLength(0);
  });

  it('rejects shapes that are not a line of letters (one tall stroke)', () => {
    const d = canvas([120, 110, 80]);
    letters(d, 100, 100, 1, 60, [230, 220, 180], [40, 30, 20]);
    expect(detectLabels({ w: W, h: H, d }, painted())).toHaveLength(0);
  });

  it('finds Dun Morogh\'s near-white letters with a mid-grey outline on snow only with the snow pass (ATL.6)', () => {
    const d = canvas([190, 188, 182]);
    letters(d, 300, 200, 8, 12, [225, 224, 220], [110, 105, 100]);
    expect(detectLabels({ w: W, h: H, d }, painted(), { ...DETECTOR, snow: null })).toHaveLength(0);
    const found = detectLabels({ w: W, h: H, d }, painted());
    expect(found).toHaveLength(1);
    expect(found[0]?.polarity).toBe('snow');
  });
});
