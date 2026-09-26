import { describe, expect, it } from 'vitest';
import { blendOver, createRaster, drawOver, isOpaque, rasterSha256, transparentPixels, type Rgba } from './raster';

const solid = (width: number, height: number, rgba: readonly number[]): Rgba => {
  const image = createRaster(width, height);
  for (let i = 0; i < width * height; i += 1) image.data.set(rgba, i * 4);
  return image;
};

describe('source-over blending', () => {
  const blend = (dst: readonly number[], src: readonly number[]): readonly number[] => {
    const d = new Uint8Array(dst);
    blendOver(d, 0, new Uint8Array(src), 0);
    return [...d];
  };
  it('keeps the destination under a transparent source and replaces it under an opaque one', () => {
    expect(blend([1, 2, 3, 255], [9, 9, 9, 0])).toEqual([1, 2, 3, 255]);
    expect(blend([1, 2, 3, 255], [9, 8, 7, 255])).toEqual([9, 8, 7, 255]);
  });
  it('takes a translucent source unchanged onto a transparent destination', () => {
    expect(blend([0, 0, 0, 0], [200, 100, 50, 128])).toEqual([200, 100, 50, 128]);
  });
  it('mixes straight alpha onto an opaque destination', () => {
    expect(blend([0, 0, 0, 255], [255, 255, 255, 128])).toEqual([128, 128, 128, 255]);
    expect(blend([100, 0, 0, 255], [0, 0, 200, 64])).toEqual([75, 0, 50, 255]);
  });
  it('combines two translucent layers', () => {
    // a = 0.5 + 0.5·0.5 = 0.75 → 191.25; c = (255·128 + 0·(128·127/255)) / a.
    expect(blend([0, 0, 0, 128], [255, 0, 0, 128])).toEqual([170, 0, 0, 192]);
  });
});

describe('drawing', () => {
  it('places a source at an offset, cut to the destination and to a clip rectangle', () => {
    const dst = createRaster(4, 3);
    expect(drawOver(dst, solid(3, 3, [10, 20, 30, 255]), 2, 1)).toBe(4);
    expect(transparentPixels(dst)).toBe(8);
    expect([...dst.data.subarray((1 * 4 + 2) * 4, (1 * 4 + 3) * 4)]).toEqual([10, 20, 30, 255]);
    const clipped = createRaster(4, 3);
    expect(drawOver(clipped, solid(4, 3, [1, 1, 1, 255]), 0, 0, { x0: 1, y0: 1, x1: 3, y1: 2 })).toBe(2);
    expect(transparentPixels(clipped)).toBe(10);
    expect(drawOver(clipped, solid(2, 2, [1, 1, 1, 255]), -5, -5)).toBe(0);
  });

  it('knows opacity and hashes the pixels with their size', () => {
    expect(isOpaque(solid(2, 2, [0, 0, 0, 255]))).toBe(true);
    expect(isOpaque(solid(2, 2, [0, 0, 0, 254]))).toBe(false);
    const a = solid(2, 1, [1, 2, 3, 4]);
    expect(rasterSha256(a)).toBe(rasterSha256(solid(2, 1, [1, 2, 3, 4])));
    expect(rasterSha256(a)).not.toBe(rasterSha256(solid(1, 2, [1, 2, 3, 4])));
    expect(() => createRaster(0, 3)).toThrow(/positive integer size/);
  });
});
