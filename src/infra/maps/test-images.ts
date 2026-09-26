/**
 * Test images for the local-art tests (src/infra/maps and tools/maps): tiny, generated, original
 * files, so no test needs real map art (D-018). Not used by the app.
 *
 * - `pngImage` writes a complete, decodable PNG: 8-bit greyscale, filter 0 on every row, stored
 *   (uncompressed) deflate blocks in a zlib stream with its Adler-32, and a CRC-32 on every chunk.
 * - `webpImage` writes a RIFF/WebP container whose headers are valid and whose bitstream after
 *   the header is a placeholder: enough for the header reader (image-header.ts), not for a
 *   decoder. It is labelled so in every test that uses it.
 *
 * Pure and without bitwise operators (D-012): CRC-32 runs on byte tables built with arithmetic.
 */

/** XOR of two bytes, by arithmetic. */
function xorByte(a: number, b: number): number {
  let out = 0;
  for (let bit = 1; bit < 256; bit *= 2) if (Math.floor(a / bit) % 2 !== Math.floor(b / bit) % 2) out += bit;
  return out;
}

let tables: { readonly xor: Uint8Array; readonly crc: readonly (readonly [number, number, number, number])[] } | null = null;

/** A 256 × 256 byte-XOR table and the CRC-32 table (polynomial 0xEDB88320) as little-endian byte quadruples. */
function crcTables(): NonNullable<typeof tables> {
  if (tables !== null) return tables;
  const xor = new Uint8Array(65536);
  for (let a = 0; a < 256; a += 1) for (let b = 0; b < 256; b += 1) xor[a * 256 + b] = xorByte(a, b);
  const x = (a: number, b: number): number => xor[a * 256 + b] ?? 0;
  const poly = [0x20, 0x83, 0xb8, 0xed];
  const crc: (readonly [number, number, number, number])[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c: [number, number, number, number] = [n, 0, 0, 0];
    for (let k = 0; k < 8; k += 1) {
      const odd = c[0] % 2 === 1;
      // c >>> 1, byte by byte (little-endian)
      const shifted: [number, number, number, number] = [
        Math.floor(c[0] / 2) + (c[1] % 2) * 128,
        Math.floor(c[1] / 2) + (c[2] % 2) * 128,
        Math.floor(c[2] / 2) + (c[3] % 2) * 128,
        Math.floor(c[3] / 2),
      ];
      c = odd ? [x(shifted[0], poly[0] ?? 0), x(shifted[1], poly[1] ?? 0), x(shifted[2], poly[2] ?? 0), x(shifted[3], poly[3] ?? 0)] : shifted;
    }
    crc.push(c);
  }
  tables = { xor, crc };
  return tables;
}

/** CRC-32 (ISO-HDLC, as PNG uses) of `bytes`. */
export function crc32(bytes: Uint8Array): number {
  const { xor, crc } = crcTables();
  const x = (a: number, b: number): number => xor[a * 256 + b] ?? 0;
  let c0 = 255;
  let c1 = 255;
  let c2 = 255;
  let c3 = 255;
  for (const byte of bytes) {
    const t = crc[x(c0, byte)] ?? [0, 0, 0, 0];
    c0 = x(t[0], c1);
    c1 = x(t[1], c2);
    c2 = x(t[2], c3);
    c3 = t[3];
  }
  return (255 - c0) + (255 - c1) * 256 + (255 - c2) * 65536 + (255 - c3) * 16777216;
}

class Writer {
  private readonly parts: Uint8Array[] = [];
  private length = 0;

  bytes(data: Uint8Array | readonly number[]): this {
    const part = data instanceof Uint8Array ? data : Uint8Array.from(data);
    this.parts.push(part);
    this.length += part.length;
    return this;
  }

  ascii(text: string): this {
    return this.bytes([...text].map((c) => c.charCodeAt(0)));
  }

  u32be(value: number): this {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value);
    return this.bytes(out);
  }

  u32le(value: number): this {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value, true);
    return this.bytes(out);
  }

  u16le(value: number): this {
    const out = new Uint8Array(2);
    new DataView(out.buffer).setUint16(0, value, true);
    return this.bytes(out);
  }

  done(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

function pngChunk(out: Writer, type: string, data: Uint8Array): void {
  const typed = new Writer().ascii(type).bytes(data).done();
  out.u32be(data.length).bytes(typed).u32be(crc32(typed));
}

/** A zlib stream of stored deflate blocks (RFC 1950, RFC 1951 §3.2.4). */
function zlibStored(raw: Uint8Array): Uint8Array {
  const out = new Writer().bytes([0x78, 0x01]);
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  for (let i = 0; i < blocks; i += 1) {
    const block = raw.subarray(i * 65535, Math.min(raw.length, (i + 1) * 65535));
    out.bytes([i === blocks - 1 ? 1 : 0]).u16le(block.length).u16le(65535 - block.length).bytes(block);
  }
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return out.u32be(b * 65536 + a).done();
}

/** A decodable 8-bit greyscale PNG, `width × height`, with a deterministic pattern seeded by `seed`. */
export function pngImage(width: number, height: number, seed = 0): Uint8Array<ArrayBuffer> {
  const raw = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) raw[row + 1 + x] = (x * 7 + y * 13 + seed) % 256;
  }
  const header = new Writer().u32be(width).u32be(height).bytes([8, 0, 0, 0, 0]).done();
  const out = new Writer().bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  pngChunk(out, 'IHDR', header);
  pngChunk(out, 'IDAT', zlibStored(raw));
  pngChunk(out, 'IEND', new Uint8Array(0));
  return out.done();
}

export type WebpKind = 'lossless' | 'lossy' | 'extended';

/**
 * A RIFF/WebP container with valid headers for a `width × height` image and a placeholder
 * bitstream (not decodable): `lossless` is a simple VP8L file, `lossy` a simple VP8 key frame,
 * `extended` a VP8X canvas holding one VP8L image.
 */
export function webpImage(width: number, height: number, kind: WebpKind = 'lossless'): Uint8Array<ArrayBuffer> {
  const vp8l = (): Uint8Array => new Writer().bytes([0x2f]).u32le((width - 1) + (height - 1) * 16384).bytes([0, 0, 0]).done();
  const vp8 = (): Uint8Array =>
    new Writer()
      .bytes([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a])
      .u16le(width)
      .u16le(height)
      .bytes([0, 0])
      .done();
  const chunks = new Writer();
  const chunk = (type: string, data: Uint8Array): void => {
    chunks.ascii(type).u32le(data.length).bytes(data);
    if (data.length % 2 === 1) chunks.bytes([0]);
  };
  if (kind === 'lossless') chunk('VP8L', vp8l());
  else if (kind === 'lossy') chunk('VP8 ', vp8());
  else {
    const canvas = new Uint8Array(10);
    const w = width - 1;
    const h = height - 1;
    canvas.set([w % 256, Math.floor(w / 256) % 256, Math.floor(w / 65536) % 256], 4);
    canvas.set([h % 256, Math.floor(h / 256) % 256, Math.floor(h / 65536) % 256], 7);
    chunk('VP8X', canvas);
    chunk('VP8L', vp8l());
  }
  const body = chunks.done();
  return new Writer().ascii('RIFF').u32le(body.length + 4).ascii('WEBP').bytes(body).done();
}
