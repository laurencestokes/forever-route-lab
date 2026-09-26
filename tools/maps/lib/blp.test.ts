import { describe, expect, it } from 'vitest';
import { blpFile, bgraBlp, dxt5AlphaBlock, dxtColourBlock, rgb565 } from './art-test-support';
import { BlpError, blpInfo, decodeBlp } from './blp';

const pixel = (image: { readonly width: number; readonly data: Uint8Array }, x: number, y: number): readonly number[] => {
  const p = (y * image.width + x) * 4;
  return [...image.data.subarray(p, p + 4)];
};

const RED = rgb565(255, 0, 0);
const BLUE = rgb565(0, 0, 255);
const INDICES = Array.from({ length: 16 }, (_, i) => i % 4);

describe('BLP2 DXT decoding', () => {
  it('decodes a DXT1 four-colour block with the 2/3 and 1/3 blends', () => {
    const image = decodeBlp(blpFile({ colourEncoding: 2, alphaBits: 0, width: 4, height: 4, mip0: dxtColourBlock(RED, BLUE, INDICES) })).image;
    expect(pixel(image, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(image, 1, 0)).toEqual([0, 0, 255, 255]);
    expect(pixel(image, 2, 0)).toEqual([170, 0, 85, 255]);
    expect(pixel(image, 3, 0)).toEqual([85, 0, 170, 255]);
    expect(pixel(image, 3, 3)).toEqual([85, 0, 170, 255]);
  });

  it('decodes DXT1 three-colour blocks: index 3 is transparent only with 1-bit alpha', () => {
    const block = dxtColourBlock(BLUE, RED, INDICES); // c0 <= c1: three-colour mode
    const withAlpha = decodeBlp(blpFile({ colourEncoding: 2, alphaBits: 1, width: 4, height: 4, mip0: block }));
    expect(withAlpha.info.encoding).toBe('dxt1');
    expect(pixel(withAlpha.image, 2, 0)).toEqual([128, 0, 128, 255]);
    expect(pixel(withAlpha.image, 3, 0)).toEqual([0, 0, 0, 0]);
    const opaque = decodeBlp(blpFile({ colourEncoding: 2, alphaBits: 0, width: 4, height: 4, mip0: block })).image;
    expect(pixel(opaque, 3, 0)).toEqual([0, 0, 0, 255]);
  });

  it('expands 5-6-5 by bit replication', () => {
    const grey = decodeBlp(blpFile({ colourEncoding: 2, alphaBits: 0, width: 4, height: 4, mip0: dxtColourBlock(rgb565(132, 130, 132), 0, [0]) })).image;
    // r5 = 16 → 16·8 + 4 = 132; g6 = 32 → 32·4 + 2 = 130.
    expect(pixel(grey, 0, 0)).toEqual([132, 130, 132, 255]);
  });

  it('decodes DXT3 explicit 4-bit alpha and DXT5 interpolated alpha (both modes)', () => {
    const alpha3 = new Uint8Array(8);
    for (let i = 0; i < 8; i += 1) alpha3[i] = 0x10 * ((2 * i + 1) % 16) + ((2 * i) % 16);
    const dxt3 = decodeBlp(blpFile({ colourEncoding: 2, alphaBits: 8, preferredFormat: 1, width: 4, height: 4, mip0: new Uint8Array([...alpha3, ...dxtColourBlock(RED, BLUE, INDICES)]) }));
    expect(dxt3.info.encoding).toBe('dxt3');
    expect([0, 1, 2, 15].map((i) => pixel(dxt3.image, i % 4, Math.floor(i / 4))[3])).toEqual([0, 17, 34, 255]);
    const eight = dxt5AlphaBlock(255, 0, [0, 1, 2, 3, 4, 5, 6, 7, 0, 0, 0, 0, 0, 0, 0, 7]);
    const dxt5 = decodeBlp(blpFile({ colourEncoding: 2, alphaBits: 8, preferredFormat: 7, width: 4, height: 4, mip0: new Uint8Array([...eight, ...dxtColourBlock(RED, BLUE, INDICES)]) }));
    expect(dxt5.info.encoding).toBe('dxt5');
    expect(Array.from({ length: 8 }, (_, i) => pixel(dxt5.image, i % 4, Math.floor(i / 4))[3])).toEqual([255, 0, 219, 182, 146, 109, 73, 36]);
    expect(pixel(dxt5.image, 3, 3)[3]).toBe(36);
    const six = dxt5AlphaBlock(0, 250, [0, 1, 2, 3, 4, 5, 6, 7]);
    const dxt5b = decodeBlp(blpFile({ colourEncoding: 2, alphaBits: 8, preferredFormat: 7, width: 4, height: 4, mip0: new Uint8Array([...six, ...dxtColourBlock(RED, BLUE, INDICES)]) })).image;
    expect(Array.from({ length: 8 }, (_, i) => pixel(dxt5b, i % 4, Math.floor(i / 4))[3])).toEqual([0, 250, 50, 100, 150, 200, 0, 255]);
  });

  it('crops blocks at sizes that are not a multiple of 4', () => {
    const blocks = new Uint8Array([...dxtColourBlock(RED, RED, [0]), ...dxtColourBlock(BLUE, BLUE, [0])]);
    const image = decodeBlp(blpFile({ colourEncoding: 2, alphaBits: 0, width: 6, height: 2, mip0: blocks })).image;
    expect([image.width, image.height, image.data.length]).toEqual([6, 2, 48]);
    expect(pixel(image, 3, 1)).toEqual([255, 0, 0, 255]);
    expect(pixel(image, 4, 0)).toEqual([0, 0, 255, 255]);
    expect(pixel(image, 5, 1)).toEqual([0, 0, 255, 255]);
  });
});

describe('BLP2 palette and B8G8R8A8 decoding', () => {
  const palette: readonly (readonly [number, number, number])[] = [
    [10, 20, 30],
    [200, 100, 50],
  ];
  it('reads indices through the B, G, R palette with 0, 1, 4 and 8 alpha bits', () => {
    const indices = [0, 1, 1, 0, 1, 0, 0, 1];
    const none = decodeBlp(blpFile({ colourEncoding: 1, alphaBits: 0, width: 4, height: 2, palette, mip0: new Uint8Array(indices) })).image;
    expect(pixel(none, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(pixel(none, 1, 0)).toEqual([200, 100, 50, 255]);
    const one = decodeBlp(blpFile({ colourEncoding: 1, alphaBits: 1, width: 4, height: 2, palette, mip0: new Uint8Array([...indices, 0b10100101]) })).image;
    expect(Array.from({ length: 8 }, (_, i) => pixel(one, i % 4, Math.floor(i / 4))[3])).toEqual([255, 0, 255, 0, 0, 255, 0, 255]);
    const four = decodeBlp(blpFile({ colourEncoding: 1, alphaBits: 4, width: 4, height: 2, palette, mip0: new Uint8Array([...indices, 0x21, 0xf0, 0, 0]) })).image;
    expect([0, 1, 2, 3].map((i) => pixel(four, i, 0)[3])).toEqual([17, 34, 0, 255]);
    const eight = decodeBlp(blpFile({ colourEncoding: 1, alphaBits: 8, width: 4, height: 2, palette, mip0: new Uint8Array([...indices, 1, 2, 3, 4, 5, 6, 7, 8]) })).image;
    expect(pixel(eight, 3, 1)).toEqual([200, 100, 50, 8]);
  });

  it('reads B8G8R8A8 pixels, opaque when the alpha size is 0', () => {
    const image = decodeBlp(bgraBlp(2, 1, (x) => (x === 0 ? [1, 2, 3, 4] : [250, 251, 252, 253]))).image;
    expect([pixel(image, 0, 0), pixel(image, 1, 0)]).toEqual([
      [1, 2, 3, 4],
      [250, 251, 252, 253],
    ]);
    const opaque = decodeBlp(blpFile({ colourEncoding: 3, alphaBits: 0, width: 1, height: 1, mip0: new Uint8Array([3, 2, 1, 0]) })).image;
    expect(pixel(opaque, 0, 0)).toEqual([1, 2, 3, 255]);
  });
});

describe('BLP2 header checks (fail closed)', () => {
  const ok = { colourEncoding: 2, alphaBits: 0, width: 4, height: 4, mip0: dxtColourBlock(RED, BLUE, INDICES) } as const;
  it('reports the header of a valid file', () => {
    expect(blpInfo(blpFile(ok))).toEqual({ encoding: 'dxt1', alphaBits: 0, preferredFormat: 0, width: 4, height: 4, mip0: { offset: 1172, size: 8 } });
  });

  it.each([
    ['a truncated header', new Uint8Array(100), /shorter than the header/],
    ['BLP1', blpFile({ ...ok, magic: 'BLP1' }), /BLP1 files are not supported/],
    ['another magic', blpFile({ ...ok, magic: 'PNG ' }), /not a BLP2 file/],
    ['JPEG content', blpFile({ ...ok, colourEncoding: 0 }), /JPEG-in-BLP is refused/],
    ['an alpha size of 2', blpFile({ ...ok, alphaBits: 2 }), /alpha size 2/],
    ['a zero size', blpFile({ ...ok, width: 0 }), /out of range/],
    ['a mip too small for its size', blpFile({ ...ok, width: 8 }), /does not fit/],
    ['a recorded mip size too small', blpFile({ ...ok, mip0Size: 4 }), /needs 8/],
  ])('refuses %s', (_, bytes, message) => {
    expect(() => decodeBlp(bytes)).toThrow(BlpError);
    expect(() => decodeBlp(bytes)).toThrow(message);
  });
});
