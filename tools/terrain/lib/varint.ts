/**
 * The byte encoding shared by the navigation files (terrain-navigation.md §5): little-endian,
 * unsigned LEB128 varints, zigzag for signed values, no floating point. Arithmetic only (no
 * bitwise operators, D-012), values up to 2^53.
 */

export class ByteWriter {
  private buf = new Uint8Array(1024);
  private n = 0;

  get length(): number {
    return this.n;
  }

  private room(k: number): void {
    if (this.n + k <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.n + k) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.buf.subarray(0, this.n));
    this.buf = grown;
  }

  byte(v: number): void {
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new RangeError(`byte out of range: ${String(v)}`);
    this.room(1);
    this.buf[this.n] = v;
    this.n += 1;
  }

  ascii(text: string): void {
    for (let i = 0; i < text.length; i += 1) this.byte(text.charCodeAt(i));
  }

  /** Unsigned LEB128. */
  u(v: number): void {
    if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`varint out of range: ${String(v)}`);
    this.room(8);
    let x = v;
    while (x >= 128) {
      this.buf[this.n] = (x % 128) + 128;
      this.n += 1;
      x = Math.floor(x / 128);
    }
    this.buf[this.n] = x;
    this.n += 1;
  }

  /** Zigzag then LEB128: 0, −1, 1, −2, … → 0, 1, 2, 3, … */
  z(v: number): void {
    if (!Number.isSafeInteger(v)) throw new RangeError(`signed varint out of range: ${String(v)}`);
    this.u(v >= 0 ? v * 2 : -v * 2 - 1);
  }

  bytes(): Buffer {
    return Buffer.from(this.buf.subarray(0, this.n));
  }
}

export class FormatError extends Error {
  constructor(what: string, message: string) {
    super(`${what}: ${message}`);
    this.name = 'NavFormatError';
  }
}

export class ByteReader {
  pos = 0;
  constructor(
    private readonly b: Uint8Array,
    private readonly what: string,
  ) {}

  get remaining(): number {
    return this.b.length - this.pos;
  }

  fail(message: string): never {
    throw new FormatError(this.what, `${message} at byte ${String(this.pos)}`);
  }

  byte(): number {
    if (this.pos >= this.b.length) this.fail('unexpected end of data');
    const v = this.b[this.pos] ?? 0;
    this.pos += 1;
    return v;
  }

  ascii(length: number): string {
    let s = '';
    for (let i = 0; i < length; i += 1) s += String.fromCharCode(this.byte());
    return s;
  }

  u(): number {
    let v = 0;
    let m = 1;
    for (let i = 0; i < 8; i += 1) {
      const x = this.byte();
      v += (x % 128) * m;
      if (x < 128) {
        if (i > 0 && x === 0) this.fail('non-canonical varint');
        return v;
      }
      m *= 128;
    }
    return this.fail('varint longer than 8 bytes');
  }

  z(): number {
    const v = this.u();
    return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
  }

  /** An unsigned varint no greater than `max`. */
  bounded(max: number, name: string): number {
    const v = this.u();
    if (v > max) this.fail(`${name} ${String(v)} exceeds ${String(max)}`);
    return v;
  }

  end(): void {
    if (this.pos !== this.b.length) this.fail(`${String(this.b.length - this.pos)} trailing bytes`);
  }
}
