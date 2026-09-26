import { describe, expect, it } from 'vitest';
import { bgraBlp, syntheticArtWorld, tileColour } from './art-test-support';
import { planArt, type ArtPlan } from './art-plan';
import { composeArt, edgeTileFileSize } from './compose';

const at = (data: Uint8Array, width: number, x: number, y: number): readonly number[] => [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];

describe('composing a plan', () => {
  const { tables, files } = syntheticArtWorld();
  const plans = planArt(tables.art).plans;
  const durotar = plans.find((p) => p.uiMapId === 1411) as ArtPlan;
  const read = (id: number): Uint8Array => {
    const bytes = files.get(id);
    if (bytes === undefined) throw new Error(`missing ${String(id)}`);
    return bytes;
  };

  it('stitches the base tiles, crops the edges and blends the overlay only inside its rectangle', () => {
    const { image, stats } = composeArt(durotar, read);
    expect([image.width, image.height]).toEqual([10, 6]);
    expect(stats).toEqual({ tiles: 6, overlays: 1, overlayTiles: 2, oversizedEdgeTiles: 0, encodings: { bgra: 8 } });
    const base = (id: number): readonly number[] => tileColour(id);
    // (0, 0) is outside the overlay: the base tile 1000 as it is.
    expect(at(image.data, 10, 0, 0)).toEqual(base(1000));
    // (9, 5): tile 1005 cropped at the canvas edge.
    expect(at(image.data, 10, 9, 5)).toEqual(base(1005));
    // (3, 1) is inside overlay 7 (x 2-6, y 1-3): overlay tile 2000 at half alpha over tile 1000.
    const mix = (o: readonly number[], b: readonly number[]): readonly number[] => [0, 1, 2].map((k) => Math.round(((o[k] ?? 0) * 128 + (b[k] ?? 0) * 127) / 255));
    expect(at(image.data, 10, 3, 1)).toEqual([...mix(tileColour(2000), base(1000)), 255]);
    // (6, 3): overlay tile 2001 (drawn from x 6) over base tile 1001; (7, 1) is past the overlay's width.
    expect(at(image.data, 10, 6, 3)).toEqual([...mix(tileColour(2001), base(1001)), 255]);
    expect(at(image.data, 10, 7, 1)).toEqual(base(1001));
    expect(at(image.data, 10, 3, 4)).toEqual(base(1003));
  });

  it('refuses a base tile of another size and an overlay tile too small for its part', () => {
    const wrong = new Map(files);
    wrong.set(1003, bgraBlp(2, 4, () => [0, 0, 0, 255]));
    expect(() => composeArt(durotar, (id) => wrong.get(id) ?? new Uint8Array())).toThrow(/tile 1003 is 2 × 4, the layer's tiles are 4 × 4/);
    const small = new Map(files);
    small.set(2000, bgraBlp(2, 2, () => [0, 0, 0, 255]));
    expect(() => composeArt(durotar, (id) => small.get(id) ?? new Uint8Array())).toThrow(/overlay 7: tile 2000 \(2 × 2\) does not cover/);
  });

  it('counts edge tiles larger than the client power-of-two rule predicts', () => {
    const big = new Map(files);
    big.set(2001, bgraBlp(32, 4, () => [0, 0, 0, 128]));
    expect(composeArt(durotar, (id) => big.get(id) ?? new Uint8Array()).stats.oversizedEdgeTiles).toBe(1);
    expect([1, 16, 17, 100, 128, 129].map(edgeTileFileSize)).toEqual([16, 16, 32, 128, 128, 256]);
  });
});
