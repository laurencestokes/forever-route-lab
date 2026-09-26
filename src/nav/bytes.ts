/**
 * The byte encoding shared by the navigation files (terrain-navigation.md §5): little-endian,
 * unsigned LEB128 varints, zigzag for signed values, no floating point. Arithmetic only (no
 * bitwise operators, D-012), values up to 2^53. The runtime side of
 * `tools/terrain/lib/varint.ts`: the same canonical-varint rule, so a file either build-side
 * reader accepts is accepted here and nothing else is.
 */

export class NavFormatError extends Error {
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
    throw new NavFormatError(this.what, `${message} at byte ${String(this.pos)}`);
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

  /** Unsigned LEB128, canonical (no trailing zero groups), at most 8 bytes. */
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

  /** Zigzag then LEB128: 0, 1, 2, 3, … → 0, −1, 1, −2, … */
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
