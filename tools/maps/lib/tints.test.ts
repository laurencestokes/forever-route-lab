import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../build/lib/fs';
import { ciede2000, fromHex, hslToRgb, rgbToHsl, toHex } from './tint-colour';
import { deriveTints, meanInRings, RESERVED_COLOURS, sharedBorders, TINT_PARAMS, type TintImage, type TintZone } from './tints';

/**
 * The fallback zone tint (map-presentation.md §12.4; step MP.10): the sampling inside the terrain
 * rings, the bounds that keep a tint a picture, the neighbour push, and the §12.4 test on the
 * committed tints: none above 0.30 saturation, none within 15 (CIEDE2000) of a chromatic reserved
 * colour, with the neighbour differences recorded.
 */

const p = (x: number, y: number) => ({ x, y });
const square = (x0: number, y0: number, size: number) => [p(x0, y0), p(x0 + size, y0), p(x0 + size, y0 + size), p(x0, y0 + size), p(x0, y0)];

/** A 10 × 10 px image over world x 0–100 (north) and y 0–100 (west): the left half red, the right half green; a transparent last row. */
function image(): TintImage {
  const rgba = new Uint8Array(10 * 10 * 4);
  for (let py = 0; py < 10; py += 1) {
    for (let px = 0; px < 10; px += 1) {
      const at = (py * 10 + px) * 4;
      const left = px < 5;
      rgba[at] = left ? 200 : 0;
      rgba[at + 1] = left ? 0 : 180;
      rgba[at + 2] = 0;
      rgba[at + 3] = py === 9 ? 0 : 255;
    }
  }
  return { uiMapId: 1, width: 10, height: 10, rgba, bounds: { mapId: 1, xMin: 0, xMax: 100, yMin: 0, yMax: 100 } };
}

describe('meanInRings', () => {
  it('averages the opaque pixels whose centres are inside the rings (east is decreasing y)', () => {
    // World y 50–100 is the image's west (left) half: red.
    expect(meanInRings(image(), [square(0, 50, 100)])).toEqual({ rgb: [200, 0, 0], samples: 45 });
    // An enclave cuts a hole (even-odd), and the transparent row is left out.
    const whole = meanInRings(image(), [square(0, 0, 100), square(0, 0, 50)]);
    // 90 opaque pixels, less the enclave's 20 (its last row is the transparent one).
    expect(whole?.samples).toBe(90 - 20);
    expect(meanInRings(image(), [square(200, 200, 10)])).toBeNull();
  });
});

describe('sharedBorders', () => {
  it('sums the arcs two areas share, whichever side each is on, and ignores the unassigned side', () => {
    const borders = sharedBorders(
      [
        [p(0, 0), p(300, 0)],
        [p(300, 0), p(300, 400)],
        [p(0, 0), p(0, 50)],
      ],
      [
        [2, 1],
        [1, 2],
        [1, 0],
      ],
    );
    expect([...borders]).toEqual([['1:2', 700]]);
  });
});

describe('deriveTints', () => {
  const zone = (areaId: number, rings: TintZone['rings'], city = false): TintZone => ({ mapId: 1, areaId, uiMapId: areaId, name: `Z${String(areaId)}`, city, rings });

  it('bounds a tint as picture: saturation at most 0.29, lightness 0.38–0.72, and never guesses a zone with no paint', () => {
    const result = deriveTints([zone(1, [square(0, 50, 100)]), zone(2, [square(500, 500, 10)])], () => [image()], new Map());
    const [red] = result.tints;
    const [, s, l] = rgbToHsl(red?.tint ?? [0, 0, 0]);
    expect(s).toBeLessThanOrEqual(0.295);
    expect(l).toBeGreaterThanOrEqual(0.37);
    expect(red?.art).toEqual([200, 0, 0]);
    expect(result.unsampled).toEqual(['Z2']);
  });

  it('pushes neighbours that differ by less than 10 apart, moving a city first', () => {
    // Two zones over the same red half: identical tints, sharing 400 yd of border.
    const zones = [zone(1, [square(0, 50, 50)]), zone(2, [square(50, 50, 50)], true)];
    const result = deriveTints(zones, () => [image()], new Map([['1:2', 400]]));
    expect(result.before.min).toBe(0);
    expect(result.after.min).toBeGreaterThan(result.before.min);
    // The city moved; the other kept its colour.
    expect(result.tints[0]?.tint).toEqual(hslToRgb([0, TINT_PARAMS.maxSaturation, rgbToHsl([200, 0, 0])[2]]));
    // A border under 300 yd does not count as neighbours.
    expect(deriveTints(zones, () => [image()], new Map([['1:2', 299]])).after.pairs).toBe(0);
  });

  it('converts colours both ways', () => {
    expect(toHex([136, 111, 75])).toBe('#886f4b');
    expect(fromHex('#886f4b')).toEqual([136, 111, 75]);
    expect(ciede2000([10, 20, 30], [10, 20, 30])).toBe(0);
  });
});

describe('the committed tints (public/maps/tint/tints.json; §12.4)', () => {
  const file = JSON.parse(readFileSync(join(REPO_ROOT, 'public', 'maps', 'tint', 'tints.json'), 'utf8')) as {
    tints: { name: string; tint: string }[];
    neighbours: { after: { pairs: number; min: number; median: number } };
  };

  it('keeps every tint a picture: at most 0.30 saturation, at least 15 from every chromatic reserved colour', () => {
    expect(file.tints.length).toBeGreaterThanOrEqual(50);
    for (const entry of file.tints) {
      const rgb = fromHex(entry.tint);
      expect(rgbToHsl(rgb)[1], entry.name).toBeLessThanOrEqual(TINT_PARAMS.checkMaxSaturation);
      for (const [key, hex] of Object.entries(RESERVED_COLOURS)) expect(ciede2000(rgb, fromHex(hex)), `${entry.name} / ${key}`).toBeGreaterThanOrEqual(TINT_PARAMS.checkMinReserved);
    }
  });

  it('records the neighbour differences after the push', () => {
    expect(file.neighbours.after.pairs).toBeGreaterThan(90);
    expect(file.neighbours.after.median).toBeGreaterThan(TINT_PARAMS.threshold);
  });
});
