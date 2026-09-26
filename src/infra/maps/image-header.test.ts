import { describe, expect, it } from 'vitest';
import { contentTypeOfName, readImageHeader } from './image-header';
import { crc32, pngImage, webpImage } from './test-images';

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

/** A copy of `bytes` with `patch` written at `at`. */
function patched(bytes: Uint8Array, at: number, patch: readonly number[]): Uint8Array {
  const out = bytes.slice();
  out.set(patch, at);
  return out;
}

describe('the test images', () => {
  it('computes the standard CRC-32 check value', () => {
    // The CRC-32/ISO-HDLC check value of "123456789".
    expect(crc32(Uint8Array.from(ascii('123456789')))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('writes a PNG with the IHDR, IDAT and IEND chunks and a correct CRC on each', () => {
    const png = pngImage(3, 2);
    const data = new DataView(png.buffer);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let offset = 8;
    const types: string[] = [];
    while (offset < png.length) {
      const length = data.getUint32(offset);
      types.push(String.fromCharCode(...png.subarray(offset + 4, offset + 8)));
      expect(data.getUint32(offset + 8 + length)).toBe(crc32(png.subarray(offset + 4, offset + 8 + length)));
      offset += 12 + length;
    }
    expect(types).toEqual(['IHDR', 'IDAT', 'IEND']);
  });
});

describe('readImageHeader: PNG', () => {
  it('reads the size of a PNG', () => {
    expect(readImageHeader(pngImage(6, 4))).toEqual({ ok: true, header: { contentType: 'image/png', width: 6, height: 4 } });
    expect(readImageHeader(pngImage(1002, 668))).toEqual({ ok: true, header: { contentType: 'image/png', width: 1002, height: 668 } });
  });

  it('refuses a truncated file, trailing bytes, a missing IEND and a first chunk that is not IHDR', () => {
    const png = pngImage(6, 4);
    expect(readImageHeader(png.subarray(0, png.length - 5))).toMatchObject({ ok: false, error: expect.stringMatching(/^PNG: (IEND chunk runs past|truncated)/) as unknown });
    expect(readImageHeader(Uint8Array.from([...png, 0]))).toMatchObject({ ok: false, error: 'PNG: 1 byte(s) after IEND' });
    expect(readImageHeader(png.subarray(0, png.length - 12))).toMatchObject({ ok: false, error: 'PNG: no IEND chunk (truncated file)' });
    expect(readImageHeader(patched(png, 12, ascii('IDAT')))).toMatchObject({ ok: false, error: 'PNG: the first chunk is IDAT, not IHDR' });
  });

  it('refuses an impossible header: zero size, a bit depth the colour type forbids, an unknown method', () => {
    const png = pngImage(6, 4);
    expect(readImageHeader(patched(png, 16, [0, 0, 0, 0]))).toMatchObject({ ok: false, error: 'PNG: invalid size 0 × 4' });
    expect(readImageHeader(patched(png, 24, [3]))).toMatchObject({ ok: false, error: 'PNG: bit depth 3 is not allowed for colour type 0' });
    expect(readImageHeader(patched(png, 25, [5]))).toMatchObject({ ok: false, error: 'PNG: unknown colour type 5' });
    expect(readImageHeader(patched(png, 26, [1]))).toMatchObject({ ok: false, error: 'PNG: unknown compression or filter method' });
  });

  it('refuses an animated PNG', () => {
    const png = pngImage(2, 2);
    // An acTL chunk right after IHDR (8 + 25 bytes); its CRC is not checked.
    const actl = [0, 0, 0, 8, ...ascii('acTL'), 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0];
    const animated = Uint8Array.from([...png.subarray(0, 33), ...actl, ...png.subarray(33)]);
    expect(readImageHeader(animated)).toMatchObject({ ok: false, error: 'PNG: animated PNG (acTL); map art is one still image' });
  });
});

describe('readImageHeader: WebP (header-valid containers; the bitstreams are placeholders)', () => {
  it.each(['lossless', 'lossy', 'extended'] as const)('reads the size of a %s WebP', (kind) => {
    expect(readImageHeader(webpImage(1002, 668, kind))).toEqual({ ok: true, header: { contentType: 'image/webp', width: 1002, height: 668 } });
    expect(readImageHeader(webpImage(1, 1, kind))).toEqual({ ok: true, header: { contentType: 'image/webp', width: 1, height: 1 } });
  });

  it('refuses a RIFF size that differs from the file, a chunk past the end, and an unknown first chunk', () => {
    const webp = webpImage(6, 4);
    expect(readImageHeader(Uint8Array.from([...webp, 0, 0]))).toMatchObject({ ok: false, error: 'WebP: the RIFF header says 28 bytes, the file has 30' });
    expect(readImageHeader(patched(webp, 16, [200, 0, 0, 0]))).toMatchObject({ ok: false, error: 'WebP: VP8L chunk runs past the end of the file' });
    expect(readImageHeader(patched(webp, 12, ascii('ALPH')))).toMatchObject({ ok: false, error: 'WebP: the first chunk is ALPH, not VP8, VP8L or VP8X' });
  });

  it('refuses a broken bitstream header and an extended file whose image disagrees with its canvas', () => {
    expect(readImageHeader(patched(webpImage(6, 4), 20, [0x2e]))).toMatchObject({ ok: false, error: 'WebP: VP8L signature missing' });
    expect(readImageHeader(patched(webpImage(6, 4, 'lossy'), 23, [0]))).toMatchObject({ ok: false, error: 'WebP: VP8 key frame start code missing' });
    // The VP8X canvas width (bytes 24-26) says 7, the VP8L image 6.
    expect(readImageHeader(patched(webpImage(6, 4, 'extended'), 24, [6]))).toMatchObject({ ok: false, error: 'WebP: the canvas is 7 × 4, its image 6 × 4' });
    // Animation flag (bit 1) set in the VP8X flags byte.
    expect(readImageHeader(patched(webpImage(6, 4, 'extended'), 20, [2]))).toMatchObject({ ok: false, error: 'WebP: animated WebP; map art is one still image' });
  });

  it('refuses anything else', () => {
    expect(readImageHeader(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ ok: false, error: 'not a PNG or WebP file' });
    expect(readImageHeader(Uint8Array.from(ascii('not really an image')))).toEqual({ ok: false, error: 'not a PNG or WebP file' });
    expect(readImageHeader(new Uint8Array(0))).toEqual({ ok: false, error: 'not a PNG or WebP file' });
  });

  it('maps file extensions to the content type they promise', () => {
    expect([contentTypeOfName('art/1411.png'), contentTypeOfName('1411.webp'), contentTypeOfName('1411.PNG'), contentTypeOfName('1411.jpg')]).toEqual([
      'image/png',
      'image/webp',
      null,
      null,
    ]);
  });
});
