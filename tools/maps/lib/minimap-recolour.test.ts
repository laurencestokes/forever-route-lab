/**
 * The sea recolour on synthetic rasters (docs/research/map-atlas.md §19.2, step MM.3): every rule of
 * revision 3.1, each on a raster drawn to exercise it. No client bytes.
 */
import { describe, expect, it } from 'vitest';
import { RECOLOUR } from './minimap-params';
import { colourWeight, edgeSkirts, familyOf, recolourMap, softGate, voidMasks } from './minimap-recolour';
import { navyFloor } from './minimap-seams';
import { DARK_WATER, NAVY_FAMILY_WATER, synthLiquid, synthMap, TEAL_SHALLOW, texel } from './minimap-test-support';
import { isWetTexel, luma, TEX, tileKey, type Rgb } from './minimap-texels';

const NAVY = RECOLOUR.navy;
const allWet = (): boolean => true;
const L = (c: Rgb): number => luma(c[0], c[1], c[2]);
const hue = (c: Rgb): number => {
  const [r, g, b] = c;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return 240 + (60 * (r - g)) / (mx - mn);
};

describe('the colour weight and the families', () => {
  it('weighs water 1 and warm, grey, bright, violet, lava and slime colours 0', () => {
    expect(colourWeight(...DARK_WATER)).toBe(1);
    expect(colourWeight(...NAVY_FAMILY_WATER)).toBe(1);
    for (const c of [
      [180, 160, 120], // sand
      [100, 100, 100], // grey rock
      [79, 74, 20], // swamp water (warm)
      [200, 60, 10], // lava
      [36, 208, 0], // slime
      [120, 220, 230], // a bright cyan pond (luma cap)
      [41, 60, 121], // the violet river by Dalaran (hue window)
    ] as const) {
      expect(colourWeight(c[0], c[1], c[2])).toBe(0);
    }
  });

  it('classes a tile base as the dark or the navy family (§17.1)', () => {
    expect(familyOf([8, 16, 16])).toBe('dark');
    expect(familyOf([8, 21, 24])).toBe('dark');
    expect(familyOf([27, 51, 71])).toBe('navy');
    expect(familyOf([3, 55, 71])).toBe('navy');
    expect(familyOf([79, 74, 20])).toBeNull();
    expect(familyOf(null)).toBeNull();
  });

  it('gates 1 on and within one quad of a wet quad, 0 from two quads', () => {
    const l = synthLiquid([{ row: 0, col: 0 }], (_r, _c, qx) => qx < 64);
    const g = softGate(l, 1, 1);
    expect(g[10 * 128 + 63]).toBe(1);
    expect(g[10 * 128 + 64]).toBe(1);
    expect(g[10 * 128 + 65]).toBe(0);
    expect(g[10 * 128 + 100]).toBe(0);
  });
});

describe('recolourMap (§19.2)', () => {
  it('takes both water families to the navy', () => {
    const m = synthMap(1, [
      { row: 0, col: 0, paint: () => DARK_WATER },
      { row: 0, col: 1, paint: () => NAVY_FAMILY_WATER },
    ]);
    const r = recolourMap(m, synthLiquid(m.tiles, allWet));
    for (const k of ['0_0', '0_1']) {
      const t = r.rec.get(k);
      for (const [x, y] of [
        [0, 0],
        [255, 300],
        [511, 511],
      ] as const) {
        expect(texel(t, x, y)).toEqual(NAVY);
      }
    }
    expect(r.stats.full).toBe(2 * TEX * TEX);
  });

  it('moves a lake whose b − g straddles 10 onto the ramp without a contour (the family field, MM-01)', () => {
    // b − g rises from 4 to 16 across the tile: revision 3 split the reference at 10
    const paint = (x: number): Rgb => [20, 40, 44 + Math.round((12 * x) / 511)];
    const m = synthMap(1, [{ row: 0, col: 0, paint }]);
    const r = recolourMap(m, synthLiquid(m.tiles, allWet));
    const t = r.rec.get('0_0');
    let maxStep = 0;
    for (let x = 1; x < TEX; x += 1) maxStep = Math.max(maxStep, Math.abs(L(texel(t, x, 256)) - L(texel(t, x - 1, 256))));
    const span = Math.abs(L(texel(t, 20, 256)) - L(texel(t, 490, 256)));
    expect(span).toBeGreaterThan(3); // the reference does move with the family
    expect(maxStep).toBeLessThan(1.5); // but never in a step
  });

  it('puts shallows on the ramp between the navy and rgb(60, 92, 130)', () => {
    const m = synthMap(1, [{ row: 0, col: 0, paint: (x, y) => (x >= 250 && x < 258 && y >= 250 && y < 258 ? [60, 90, 100] : DARK_WATER) }]);
    const r = recolourMap(m, synthLiquid(m.tiles, allWet));
    const c = texel(r.rec.get('0_0'), 254, 254);
    expect(c).toEqual(RECOLOUR.shallow);
    expect(hue(c)).toBeGreaterThanOrEqual(212);
    expect(hue(c)).toBeLessThanOrEqual(216);
  });

  it('keeps warm and grey ground, swamp water, lava, slime, bright ponds and the violet river as drawn, even on wet quads', () => {
    const patches: readonly Rgb[] = [
      [180, 160, 120],
      [100, 100, 100],
      [79, 74, 20],
      [200, 60, 10],
      [36, 208, 0],
      [120, 220, 230],
      [41, 60, 121],
    ];
    const paint = (x: number, y: number): Rgb => {
      const i = Math.floor(x / 64);
      return y >= 200 && y < 232 && x % 64 < 32 && i < patches.length ? (patches[i] ?? DARK_WATER) : DARK_WATER;
    };
    const m = synthMap(1, [{ row: 0, col: 0, paint }]);
    const r = recolourMap(m, synthLiquid(m.tiles, allWet));
    patches.forEach((c, i) => expect(texel(r.rec.get('0_0'), i * 64 + 16, 216)).toEqual(c));
  });

  it('reaches 4.2 yd fully and ends at 8.3 yd from wet quads (the gate)', () => {
    const m = synthMap(1, [{ row: 0, col: 0, paint: () => DARK_WATER }]);
    const l = synthLiquid(m.tiles, (_r, _c, qx) => qx < 64);
    const r = recolourMap(m, l);
    const t = r.rec.get('0_0');
    expect(texel(t, 100, 100)).toEqual(NAVY);
    for (let x = 264; x < TEX; x += 7) expect(texel(t, x, 100)).toEqual(DARK_WATER);
    // between, the dry texels change hue but never brighten
    let changed = 0;
    for (let x = 256; x < 264; x += 1) {
      const c = texel(t, x, 100);
      expect(L(c)).toBeLessThanOrEqual(L(DARK_WATER) + 0.5);
      if (c.join() !== DARK_WATER.join()) changed += 1;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('never brightens a dry-quad texel, before and after the feathers (MM-02)', () => {
    // a dark lake beside a lighter one: the edge feather lifts the dark side; a dry strip sits inside it
    const tiles = [
      { row: 0, col: 0, paint: (): Rgb => DARK_WATER },
      { row: 0, col: 1, paint: (): Rgb => [60, 100, 120] as Rgb },
    ];
    const m = synthMap(1, tiles);
    const l = synthLiquid(m.tiles, (_r, c, qx) => !(c === 0 && qx >= 122 && qx < 126));
    const r = recolourMap(m, l);
    expect(r.edgeFeathered).toBeGreaterThan(0);
    let dry = 0;
    for (const t of m.tiles) {
      const k = tileKey(t.row, t.col);
      for (let y = 0; y < TEX; y += 3) {
        for (let x = 0; x < TEX; x += 1) {
          if (isWetTexel(l, t.row, t.col, x, y)) continue;
          dry += 1;
          expect(L(texel(r.rec.get(k), x, y)) - L(texel(m.rgb.get(k), x, y))).toBeLessThanOrEqual(0.5);
        }
      }
    }
    expect(dry).toBeGreaterThan(0);
    expect(r.stats.dryClamped + r.stats.dryCapped).toBeGreaterThan(0);
  });

  it('fades the shallows to the navy towards a tile of the other family (the family feather)', () => {
    const m = synthMap(1, [
      { row: 0, col: 0, paint: (x) => (x >= 380 ? TEAL_SHALLOW : DARK_WATER) },
      { row: 0, col: 1, paint: () => NAVY_FAMILY_WATER },
    ]);
    const r = recolourMap(m, synthLiquid(m.tiles, allWet));
    const t = r.rec.get('0_0');
    const far = L(texel(t, 400, 256));
    const near = L(texel(t, 508, 256));
    expect(far).toBeGreaterThan(L(NAVY) + 20);
    expect(near).toBeLessThan(L(NAVY) + 6);
  });

  it('removes a step across an ADT edge, across a narrow river too, and leaves the land beside it alone (the edge feather, MM-03)', () => {
    const river = (y: number): boolean => y >= 200 && y < 212;
    const m = synthMap(1, [
      { row: 0, col: 0, paint: (_x, y) => (river(y) ? TEAL_SHALLOW : [100, 100, 100]) },
      { row: 0, col: 1, paint: (_x, y) => (river(y) ? [30, 60, 60] : [100, 100, 100]) },
    ]);
    const l = synthLiquid(m.tiles, (_r, _c, _qx, qy) => qy >= 50 && qy < 53);
    const off = recolourMap(m, l, { ...RECOLOUR, edgeFeather: 0 });
    const on = recolourMap(m, l);
    const step = (rec: ReadonlyMap<string, Uint8Array>): number => {
      let s = 0;
      for (let y = 200; y < 212; y += 1) s += Math.abs(L(texel(rec.get('0_1'), 0, y)) - L(texel(rec.get('0_0'), 511, y)));
      return s / 12;
    };
    expect(step(off.rec)).toBeGreaterThan(8);
    expect(step(on.rec)).toBeLessThan(0.35 * step(off.rec));
    for (const y of [150, 190, 230, 300]) expect(texel(on.rec.get('0_0'), 500, y)).toEqual([100, 100, 100]);
  });

  it('makes the four tiles at an ADT corner meet (the corner term)', () => {
    const tones: readonly Rgb[] = [
      [50, 80, 80],
      [40, 70, 72],
      [45, 76, 76],
      [55, 86, 84],
    ];
    const tiles = [0, 1, 2, 3].map((i) => ({ row: Math.floor(i / 2), col: i % 2, paint: (): Rgb => tones[i] ?? DARK_WATER }));
    const m = synthMap(1, tiles);
    const l = synthLiquid(m.tiles, allWet);
    const spread = (rec: ReadonlyMap<string, Uint8Array>): number => {
      const means = [
        ['0_0', 507, 507],
        ['0_1', 4, 507],
        ['1_0', 507, 4],
        ['1_1', 4, 4],
      ].map(([k, x, y]) => L(texel(rec.get(String(k)), Number(x), Number(y))));
      return Math.max(...means) - Math.min(...means);
    };
    const without = recolourMap(m, l, { ...RECOLOUR, cornerMinCorrection: 1e9 });
    const withTerm = recolourMap(m, l);
    expect(spread(withTerm.rec)).toBeLessThan(spread(without.rec));
    expect(spread(withTerm.rec)).toBeLessThan(2);
  });

  it('raises fully recoloured texels to the navy, and nothing else (the navy floor)', () => {
    const rec = new Map([['0_0', new Uint8Array(TEX * TEX * 3)]]);
    const w = new Uint8Array(TEX * TEX);
    const t = rec.get('0_0') as Uint8Array;
    t.set([10, 20, 40], 0);
    w[0] = 255;
    t.set([10, 20, 40], 3);
    w[1] = 200;
    t.set([10, 20, 40], 6);
    w[2] = 255;
    const voids = new Map([['0_0', new Uint8Array(TEX * TEX)]]);
    (voids.get('0_0') as Uint8Array)[2] = 1;
    expect(navyFloor(rec, new Map([['0_0', w]]), voids)).toBe(1);
    expect([...t.subarray(0, 9)]).toEqual([13, 27, 48, 10, 20, 40, 10, 20, 40]);
  });
});

describe('the void, the haze and the edge skirts', () => {
  // pure black joined to the missing west tile; a dark haze 200 texels wide; land; a black blob inside the land
  const paint = (x: number, y: number): Rgb => {
    if (x < 100) return [0, 0, 0];
    if (x >= 400 && x < 410 && y >= 400 && y < 410) return [0, 0, 0];
    if (x < 300) {
      const v = 5 + Math.round(((x - 100) * 55) / 200);
      return [v, v, v];
    }
    return [150, 120, 90];
  };
  const m = synthMap(2991, [{ row: 0, col: 0, paint }]);
  const l = synthLiquid(m.tiles, () => false);

  it('fills the void with the navy and composites haze wider than 64 texels over it (MM-10), keeping other black as drawn (O16)', () => {
    const r = recolourMap(m, l);
    const t = r.rec.get('0_0');
    expect(texel(t, 50, 10)).toEqual(NAVY);
    expect(texel(t, 50, 511)).toEqual(NAVY);
    for (const x of [110, 180, 250]) {
      const src = texel(m.rgb.get('0_0'), x, 256);
      const out = texel(t, x, 256);
      const a = Math.min(1, L(src) / 64);
      expect(out[2]).toBe(Math.round(src[2] + (1 - a) * NAVY[2]));
    }
    expect(texel(t, 405, 405)).toEqual([0, 0, 0]);
    expect(r.stats.voidTexels).toBe(100 * TEX);
    const v = voidMasks(m);
    expect(v.black.components).toBe(1);
    expect(v.black.over64[0]?.texels).toBe(100);
  });

  it('treats a flat strip of dry ground with sea behind it, on a side facing no tile, as void (the edge skirts, §18.6)', () => {
    const skirt = synthMap(1, [
      { row: 5, col: 5, paint: (x, y) => (y < 28 ? (x % 7 < 5 ? [77, 74, 46] : [71, 72, 44]) : DARK_WATER) },
      // a textured strip (many colours) on the same kind of side is not a skirt
      { row: 9, col: 9, paint: (x, y) => (y < 28 ? [60 + (x % 40), 70 + (y % 20), 30 + ((x * y) % 17)] : DARK_WATER) },
    ]);
    const wetBelow = synthLiquid(skirt.tiles, (_r, _c, _qx, qy) => qy >= 7);
    const s = edgeSkirts(skirt, wetBelow);
    expect(s.sides.map((x) => `${x.tile} ${x.side}`)).toEqual(['5_5 N']);
    const r = recolourMap(skirt, wetBelow);
    expect(texel(r.rec.get('5_5'), 200, 10)).toEqual(NAVY);
    expect(r.stats.skirtTexels).toBe(32 * TEX);
    expect(texel(r.rec.get('5_5'), 200, 30)).toEqual(NAVY);
    expect(texel(r.rec.get('9_9'), 200, 10)).toEqual(texel(skirt.rgb.get('9_9'), 200, 10));
  });
});
