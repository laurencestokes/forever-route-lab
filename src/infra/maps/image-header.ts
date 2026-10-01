/**
 * PNG and WebP header reading for local map art (docs/MAPS.md §5.3, §5.5 L3, §5.6), with no
 * dependency and no decoding. `tools/maps validate` reads each art file's size and type with it
 * before activation; `infra/maps` reads the verified bytes again at first draw, so a manifest
 * whose recorded size disagrees with its (hash-matching) file is refused.
 *
 * It checks the container structure, not the pixels: every PNG chunk and every RIFF chunk must fit
 * the file exactly, the first chunk must be the image header, and animated images are refused
 * (map art is one still image). Chunk CRCs are not checked (they need bitwise arithmetic, which
 * src/ never uses, D-012): the SHA-256 the manifest records is the integrity check. Whether the
 * image data decodes is the browser's business; a file that does not decode draws nothing.
 *
 * Pure (no DOM, no Node, no bitwise operators), so tools and the app share it.
 */

import type { ImageContentType } from './image-types';

export { contentTypeOfName, type ImageContentType } from './image-types';

export interface ImageHeader {
  readonly contentType: ImageContentType;
  readonly width: number;
  readonly height: number;
}

export type ImageHeaderResult = { readonly ok: true; readonly header: ImageHeader } | { readonly ok: false; readonly error: string };

const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** PNG caps chunk lengths and image dimensions at 2^31 − 1. */
const PNG_MAX = 2_147_483_647;
/** Allowed bit depths per PNG colour type (PNG spec, IHDR). */
const PNG_BIT_DEPTHS: Readonly<Record<number, readonly number[]>> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

const fail = (error: string): ImageHeaderResult => ({ ok: false, error });
const found = (contentType: ImageContentType, width: number, height: number): ImageHeaderResult => ({ ok: true, header: { contentType, width, height } });

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0): boolean => prefix.every((byte, i) => bytes[at + i] === byte);

/** Four bytes as ASCII, or null when any is not a printable ASCII character. */
function fourCc(bytes: Uint8Array, at: number): string | null {
  let out = '';
  for (let i = at; i < at + 4; i += 1) {
    const byte = bytes[i];
    if (byte === undefined || byte < 0x20 || byte > 0x7e) return null;
    out += String.fromCharCode(byte);
  }
  return out;
}

const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const u24le = (bytes: Uint8Array, at: number): number => (bytes[at] ?? 0) + (bytes[at + 1] ?? 0) * 256 + (bytes[at + 2] ?? 0) * 65536;

function readPng(bytes: Uint8Array): ImageHeaderResult {
  const data = view(bytes);
  let offset = PNG_SIGNATURE.length;
  let header: { width: number; height: number; colorType: number } | null = null;
  let sawPalette = false;
  let sawData = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) return fail(`PNG: truncated chunk header at byte ${String(offset)}`);
    const length = data.getUint32(offset);
    const type = fourCc(bytes, offset + 4);
    if (type === null || !/^[A-Za-z]{4}$/.test(type)) return fail(`PNG: invalid chunk type at byte ${String(offset + 4)}`);
    if (length > PNG_MAX) return fail(`PNG: ${type} chunk length ${String(length)} is over 2^31 − 1`);
    const body = offset + 8;
    const end = body + length + 4;
    if (end > bytes.length) return fail(`PNG: ${type} chunk runs past the end of the file`);
    if (header === null && type !== 'IHDR') return fail(`PNG: the first chunk is ${type}, not IHDR`);
    switch (type) {
      case 'IHDR': {
        if (header !== null) return fail('PNG: more than one IHDR chunk');
        if (length !== 13) return fail(`PNG: IHDR has length ${String(length)}, not 13`);
        const width = data.getUint32(body);
        const height = data.getUint32(body + 4);
        const bitDepth = bytes[body + 8] ?? -1;
        const colorType = bytes[body + 9] ?? -1;
        if (width < 1 || width > PNG_MAX || height < 1 || height > PNG_MAX) return fail(`PNG: invalid size ${String(width)} × ${String(height)}`);
        const depths = PNG_BIT_DEPTHS[colorType];
        if (depths === undefined) return fail(`PNG: unknown colour type ${String(colorType)}`);
        if (!depths.includes(bitDepth)) return fail(`PNG: bit depth ${String(bitDepth)} is not allowed for colour type ${String(colorType)}`);
        if (bytes[body + 10] !== 0 || bytes[body + 11] !== 0) return fail('PNG: unknown compression or filter method');
        if (bytes[body + 12] !== 0 && bytes[body + 12] !== 1) return fail('PNG: unknown interlace method');
        header = { width, height, colorType };
        break;
      }
      case 'PLTE':
        sawPalette = true;
        break;
      case 'IDAT':
        if (header?.colorType === 3 && !sawPalette) return fail('PNG: a palette image has no PLTE before its image data');
        sawData = true;
        break;
      case 'acTL':
        return fail('PNG: animated PNG (acTL); map art is one still image');
      case 'IEND':
        if (length !== 0) return fail('PNG: IEND is not empty');
        if (end !== bytes.length) return fail(`PNG: ${String(bytes.length - end)} byte(s) after IEND`);
        if (!sawData || header === null) return fail('PNG: no image data (IDAT)');
        return found('image/png', header.width, header.height);
      default:
        break;
    }
    offset = end;
  }
  return fail('PNG: no IEND chunk (truncated file)');
}

type WebpImage = { readonly width: number; readonly height: number } | string;

/** A `VP8 ` (lossy) key frame's size, or why it is not one (RFC 6386 §9.1, §19.1). */
function vp8Size(bytes: Uint8Array, body: number, size: number): WebpImage {
  if (size < 10) return 'WebP: VP8 chunk too short';
  const tag = bytes[body] ?? 1;
  if (tag % 2 !== 0) return 'WebP: VP8 data does not start with a key frame';
  if (!startsWith(bytes, [0x9d, 0x01, 0x2a], body + 3)) return 'WebP: VP8 key frame start code missing';
  const data = view(bytes);
  // 14 bits of size; the top two bits are the upscaling hint, which does not change the size.
  const width = data.getUint16(body + 6, true) % 16384;
  const height = data.getUint16(body + 8, true) % 16384;
  if (width === 0 || height === 0) return 'WebP: VP8 frame has a zero size';
  return { width, height };
}

/** A `VP8L` (lossless) image's size, or why it is not one (WebP lossless bitstream §3). */
function vp8lSize(bytes: Uint8Array, body: number, size: number): WebpImage {
  if (size < 5) return 'WebP: VP8L chunk too short';
  if (bytes[body] !== 0x2f) return 'WebP: VP8L signature missing';
  const bits = view(bytes).getUint32(body + 1, true);
  // width − 1 in bits 0-13, height − 1 in bits 14-27, alpha hint in bit 28, version in bits 29-31.
  const width = (bits % 16384) + 1;
  const height = (Math.floor(bits / 16384) % 16384) + 1;
  if (Math.floor(bits / 536_870_912) !== 0) return 'WebP: unknown VP8L version';
  return { width, height };
}

function readWebp(bytes: Uint8Array): ImageHeaderResult {
  const data = view(bytes);
  const riffSize = data.getUint32(4, true);
  if (riffSize + 8 !== bytes.length) return fail(`WebP: the RIFF header says ${String(riffSize + 8)} bytes, the file has ${String(bytes.length)}`);
  const chunks: { readonly type: string; readonly body: number; readonly size: number }[] = [];
  let offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return fail(`WebP: truncated chunk header at byte ${String(offset)}`);
    const type = fourCc(bytes, offset);
    if (type === null) return fail(`WebP: invalid chunk type at byte ${String(offset)}`);
    const size = data.getUint32(offset + 4, true);
    const end = offset + 8 + size + (size % 2);
    if (end > bytes.length) return fail(`WebP: ${type} chunk runs past the end of the file`);
    chunks.push({ type, body: offset + 8, size });
    offset = end;
  }
  const [first] = chunks;
  if (first === undefined) return fail('WebP: no chunks');
  const image = (chunk: { readonly type: string; readonly body: number; readonly size: number }): WebpImage =>
    chunk.type === 'VP8 ' ? vp8Size(bytes, chunk.body, chunk.size) : vp8lSize(bytes, chunk.body, chunk.size);
  if (first.type === 'VP8 ' || first.type === 'VP8L') {
    if (chunks.length !== 1) return fail(`WebP: a simple ${first.type.trim()} file has ${String(chunks.length - 1)} extra chunk(s)`);
    const size = image(first);
    return typeof size === 'string' ? fail(size) : found('image/webp', size.width, size.height);
  }
  if (first.type !== 'VP8X') return fail(`WebP: the first chunk is ${first.type}, not VP8, VP8L or VP8X`);
  if (first.size < 10) return fail('WebP: VP8X chunk too short');
  const flags = bytes[first.body] ?? 0;
  // Bit 1 of the VP8X flags is the animation flag.
  if (Math.floor(flags / 2) % 2 === 1 || chunks.some((c) => c.type === 'ANIM' || c.type === 'ANMF')) {
    return fail('WebP: animated WebP; map art is one still image');
  }
  const width = u24le(bytes, first.body + 4) + 1;
  const height = u24le(bytes, first.body + 7) + 1;
  const frames = chunks.filter((c) => c.type === 'VP8 ' || c.type === 'VP8L');
  const [frame] = frames;
  if (frame === undefined || frames.length !== 1) return fail(`WebP: an extended file must hold exactly one VP8 or VP8L image, it holds ${String(frames.length)}`);
  const size = image(frame);
  if (typeof size === 'string') return fail(size);
  if (size.width !== width || size.height !== height) {
    return fail(`WebP: the canvas is ${String(width)} × ${String(height)}, its image ${String(size.width)} × ${String(size.height)}`);
  }
  return found('image/webp', width, height);
}

/** The type and pixel size of a PNG or WebP file, from its headers alone. */
export function readImageHeader(bytes: Uint8Array): ImageHeaderResult {
  if (startsWith(bytes, PNG_SIGNATURE)) return readPng(bytes);
  if (bytes.length >= 12 && fourCc(bytes, 0) === 'RIFF' && fourCc(bytes, 8) === 'WEBP') return readWebp(bytes);
  return fail('not a PNG or WebP file');
}

