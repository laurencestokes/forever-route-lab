import { utf8Encode } from './text';

/**
 * SHA-256 (FIPS 180-4) in pure TypeScript, synchronous, for RXP group fingerprints and import
 * source hashes (docs/RXP.md §13.2: "no WebCrypto, so src/rxp stays synchronous and pure").
 *
 * No bitwise operators may appear in src/ (D-012, ARCHITECTURE §17), so every 32-bit word is held
 * as four big-endian bytes, and the bit operations are table lookups built arithmetically on first
 * use:
 * - XOR and AND of two bytes (256 × 256 tables);
 * - Σ0, Σ1, σ0 and σ1, which are linear over GF(2): f(x) is the XOR of f applied to each byte of
 *   x on its own, so each function is four 256-entry tables of 4-byte words;
 * - additions of several words at once, byte by byte with an explicit carry.
 */

const K = [
  '428a2f98', '71374491', 'b5c0fbcf', 'e9b5dba5', '3956c25b', '59f111f1', '923f82a4', 'ab1c5ed5',
  'd807aa98', '12835b01', '243185be', '550c7dc3', '72be5d74', '80deb1fe', '9bdc06a7', 'c19bf174',
  'e49b69c1', 'efbe4786', '0fc19dc6', '240ca1cc', '2de92c6f', '4a7484aa', '5cb0a9dc', '76f988da',
  '983e5152', 'a831c66d', 'b00327c8', 'bf597fc7', 'c6e00bf3', 'd5a79147', '06ca6351', '14292967',
  '27b70a85', '2e1b2138', '4d2c6dfc', '53380d13', '650a7354', '766a0abb', '81c2c92e', '92722c85',
  'a2bfe8a1', 'a81a664b', 'c24b8b70', 'c76c51a3', 'd192e819', 'd6990624', 'f40e3585', '106aa070',
  '19a4c116', '1e376c08', '2748774c', '34b0bcb5', '391c0cb3', '4ed8aa4a', '5b9cca4f', '682e6ff3',
  '748f82ee', '78a5636f', '84c87814', '8cc70208', '90befffa', 'a4506ceb', 'bef9a3f7', 'c67178f2',
];
const H0 = ['6a09e667', 'bb67ae85', '3c6ef372', 'a54ff53a', '510e527f', '9b05688c', '1f83d9ab', '5be0cd19'];

const hexBytes = (words: readonly string[]): Uint8Array => {
  const out = new Uint8Array(words.length * 4);
  words.forEach((hex, word) => {
    for (let byte = 0; byte < 4; byte += 1) out[word * 4 + byte] = parseInt(hex.slice(byte * 2, byte * 2 + 2), 16);
  });
  return out;
};

interface Tables {
  readonly xor: Uint8Array;
  readonly and: Uint8Array;
  /** Σ0, Σ1, σ0, σ1: `table[(position · 256 + value) · 4 + outputByte]`. */
  readonly bigSigma0: Uint8Array;
  readonly bigSigma1: Uint8Array;
  readonly smallSigma0: Uint8Array;
  readonly smallSigma1: Uint8Array;
  readonly k: Uint8Array;
  readonly h0: Uint8Array;
}

let tables: Tables | null = null;

/** Rotation (or shift) right of a 4-byte big-endian word, by bytes and bits, for building the tables. */
function rotateWord(word: readonly number[], n: number, shiftOnly: boolean): number[] {
  const q = Math.floor(n / 8);
  const r = n % 8;
  const byteAt = (index: number): number => (shiftOnly ? (index >= 0 ? (word[index] ?? 0) : 0) : (word[(index + 8) % 4] ?? 0));
  const out: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const hi = byteAt(i - q);
    const lo = byteAt(i - q - 1);
    out.push(Math.floor(hi / 2 ** r) + (lo % 2 ** r) * 2 ** (8 - r));
  }
  return out;
}

function buildTables(): Tables {
  const xor = new Uint8Array(65536);
  const and = new Uint8Array(65536);
  for (let a = 0; a < 256; a += 1) {
    for (let b = 0; b < 256; b += 1) {
      const index = a * 256 + b;
      if (a === 0) {
        xor[index] = b;
        continue;
      }
      const half = Math.floor(a / 2) * 256 + Math.floor(b / 2);
      const bitA = a % 2;
      const bitB = b % 2;
      xor[index] = 2 * (xor[half] ?? 0) + (bitA === bitB ? 0 : 1);
      and[index] = 2 * (and[half] ?? 0) + (bitA === 1 && bitB === 1 ? 1 : 0);
    }
  }
  const sigma = (rotations: readonly number[], shift: number | null): Uint8Array => {
    const table = new Uint8Array(4 * 256 * 4);
    for (let position = 0; position < 4; position += 1) {
      for (let value = 0; value < 256; value += 1) {
        const word = [0, 0, 0, 0];
        word[position] = value;
        const parts = [...rotations.map((n) => rotateWord(word, n, false)), ...(shift === null ? [] : [rotateWord(word, shift, true)])];
        for (let i = 0; i < 4; i += 1) {
          let acc = 0;
          for (const part of parts) acc = xor[acc * 256 + (part[i] ?? 0)] ?? 0;
          table[(position * 256 + value) * 4 + i] = acc;
        }
      }
    }
    return table;
  };
  return {
    xor,
    and,
    bigSigma0: sigma([2, 13, 22], null),
    bigSigma1: sigma([6, 11, 25], null),
    smallSigma0: sigma([7, 18], 3),
    smallSigma1: sigma([17, 19], 10),
    k: hexBytes(K),
    h0: hexBytes(H0),
  };
}

// Scratch layout: byte offsets, four bytes per word.
const W = 0; // 64 schedule words
const H = 256; // 8 hash words
const V = 288; // working variables a..h
const T1 = 320;
const S = 324;
const S2 = 328;
const NEW_E = 332;
const SCRATCH_SIZE = 336;

// Module-level scratch and helpers: the hash is synchronous and never re-entered, and keeping the
// helpers monomorphic lets the engine optimise them once.
const m = new Uint8Array(SCRATCH_SIZE);
let XOR: Uint8Array = new Uint8Array(0);
let AND: Uint8Array = new Uint8Array(0);

const at = (index: number): number => m[index] ?? 0;
const xo = (a: number, b: number): number => XOR[a * 256 + b] ?? 0;
const an = (a: number, b: number): number => AND[a * 256 + b] ?? 0;

/** m[dst..dst+3] = f(m[src..src+3]) for a table-driven Σ/σ. */
function sigmaTo(table: Uint8Array, dst: number, src: number): void {
  const b0 = at(src) * 4;
  const b1 = (256 + at(src + 1)) * 4;
  const b2 = (512 + at(src + 2)) * 4;
  const b3 = (768 + at(src + 3)) * 4;
  for (let i = 0; i < 4; i += 1) m[dst + i] = xo(xo(xo(table[b0 + i] ?? 0, table[b1 + i] ?? 0), table[b2 + i] ?? 0), table[b3 + i] ?? 0);
}

/** SHA-256 of `bytes`; lowercase hex. */
export function sha256Bytes(bytes: Uint8Array): string {
  const t = (tables ??= buildTables());
  XOR = t.xor;
  AND = t.and;
  const k = t.k;
  m.fill(0);
  // Padding: 0x80, zeros, then the bit length as a 64-bit big-endian integer.
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  let remaining = bytes.length * 8;
  for (let i = padded.length - 1; i >= padded.length - 8; i -= 1) {
    padded[i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  m.set(t.h0, H);

  for (let block = 0; block < padded.length; block += 64) {
    m.set(padded.subarray(block, block + 64), W);
    for (let word = 16; word < 64; word += 1) {
      // W[t] = σ1(W[t-2]) + W[t-7] + σ0(W[t-15]) + W[t-16]
      sigmaTo(t.smallSigma1, S, W + (word - 2) * 4);
      sigmaTo(t.smallSigma0, S2, W + (word - 15) * 4);
      const dst = W + word * 4;
      const w7 = W + (word - 7) * 4;
      const w16 = W + (word - 16) * 4;
      let carry = 0;
      for (let i = 3; i >= 0; i -= 1) {
        const sum = at(S + i) + at(S2 + i) + at(w7 + i) + at(w16 + i) + carry;
        carry = Math.floor(sum / 256);
        m[dst + i] = sum - carry * 256;
      }
    }
    m.copyWithin(V, H, H + 32);
    for (let word = 0; word < 64; word += 1) {
      // T1 = h + Σ1(e) + Ch(e, f, g) + K[t] + W[t]; Ch = g ^ (e & (f ^ g))
      sigmaTo(t.bigSigma1, S, V + 16);
      let carry = 0;
      for (let i = 3; i >= 0; i -= 1) {
        const e = at(V + 16 + i);
        const f = at(V + 20 + i);
        const g = at(V + 24 + i);
        const ch = xo(g, an(e, xo(f, g)));
        const sum = at(V + 28 + i) + at(S + i) + ch + (k[word * 4 + i] ?? 0) + at(W + word * 4 + i) + carry;
        carry = Math.floor(sum / 256);
        m[T1 + i] = sum - carry * 256;
      }
      // new e = d + T1
      carry = 0;
      for (let i = 3; i >= 0; i -= 1) {
        const sum = at(V + 12 + i) + at(T1 + i) + carry;
        carry = sum >= 256 ? 1 : 0;
        m[NEW_E + i] = sum - carry * 256;
      }
      // new a = T1 + Σ0(a) + Maj(a, b, c); Maj = (a & b) ^ (c & (a ^ b))
      sigmaTo(t.bigSigma0, S, V);
      carry = 0;
      for (let i = 3; i >= 0; i -= 1) {
        const a = at(V + i);
        const b = at(V + 4 + i);
        const c = at(V + 8 + i);
        const maj = xo(an(a, b), an(c, xo(a, b)));
        const sum = at(T1 + i) + at(S + i) + maj + carry;
        carry = Math.floor(sum / 256);
        m[S2 + i] = sum - carry * 256;
      }
      m.copyWithin(V + 4, V, V + 28); // h = g, g = f, f = e, e = d, d = c, c = b, b = a
      m.copyWithin(V, S2, S2 + 4);
      m.copyWithin(V + 16, NEW_E, NEW_E + 4);
    }
    for (let word = 0; word < 8; word += 1) {
      let carry = 0;
      for (let i = 3; i >= 0; i -= 1) {
        const index = H + word * 4 + i;
        const sum = at(index) + at(V + word * 4 + i) + carry;
        carry = sum >= 256 ? 1 : 0;
        m[index] = sum - carry * 256;
      }
    }
  }

  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i += 1) {
    const byte = at(H + i);
    out += (hex[Math.floor(byte / 16)] ?? '') + (hex[byte % 16] ?? '');
  }
  return out;
}

/** Lowercase hex SHA-256 of the UTF-8 bytes of `text`. */
export function sha256Hex(text: string): string {
  return sha256Bytes(utf8Encode(text));
}
